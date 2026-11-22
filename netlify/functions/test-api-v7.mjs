import crypto from 'node:crypto';
import previousHandler from './test-api-v6.mjs';
import {getJson, setJson, json, asaas, ensureSandbox, publicPayment} from '../shared/everclean-asaas.mjs';
import {allowedMethodsFor, changePaymentMethod} from '../shared/change-payment-method.mjs';
import {repairLegacyCheckout} from '../shared/repair-checkout.mjs';
import {enforceEmailOnlyNotifications,summarizeNotificationChannels} from '../shared/everclean-asaas-notifications.mjs';

const now = () => new Date().toISOString();
const digits = value => String(value || '').replace(/\D/g, '');
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0,10);
};

async function getAsaasCustomer(customer) {
  const cpfCnpj = digits(customer.document || customer.cpf_cnpj || customer.cpfCnpj);
  const cached = String(customer.asaas_sandbox_customer_id || '');
  if (cached.startsWith('cus_')) {
    await enforceEmailOnlyNotifications(cached,asaas);
    return cached;
  }

  if (cpfCnpj.length === 11 || cpfCnpj.length === 14) {
    const existing = await asaas('/customers?cpfCnpj=' +
      encodeURIComponent(cpfCnpj)+'&limit=100');
    const matches=Array.isArray(existing?.data)?existing.data.filter(item=>
      digits(item?.cpfCnpj)===cpfCnpj&&
      /^cus_[a-zA-Z0-9_-]{5,100}$/.test(String(item?.id||''))):[];
    if(existing?.hasMore===true||matches.length>1)
      throw Error('Asaas Sandbox: mais de um cadastro correspondente. '+
        'Vincule o ID correto do cliente antes de gerar cobrança.');
    if(matches.length===1){
      const id=String(matches[0].id);
      // Política de e-mail: revalidar inclusive clientes cadastrados no passado.
      await enforceEmailOnlyNotifications(id,asaas);
      return id;
    }
  }

  const customerData = {
    name: String(customer.trade_name || customer.legal_name || customer.name || 'Cliente Ever Clean').slice(0,200),
    ...(cpfCnpj.length === 11 || cpfCnpj.length === 14 ? {cpfCnpj} : {}),
    ...(validEmail(customer.email) ? {email: customer.email} : {}),
    ...(digits(customer.phone).length >= 10 ? {mobilePhone: digits(customer.phone)} : {})
  };
  const created = await asaas('/customers', customerData);
  if (!created.id) throw new Error('O Asaas não retornou o identificador do cliente.');
  await enforceEmailOnlyNotifications(String(created.id),asaas);
  return created.id;
}

function validateCart(lines, allProducts) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) {
    throw new Error('Escolha entre 1 e 100 produtos por pedido.');
  }
  const seen = new Set();
  return lines.map(line => {
    const id = String(line.product_id || '');
    const quantity = Number(line.quantity);
    if (seen.has(id) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) {
      throw new Error('Quantidade inválida ou produto repetido.');
    }
    seen.add(id);
    const product = allProducts.find(p => String(p.id) === id && p.active !== false && p.catalog_visible !== false);
    const price = Number(product?.base_price);
    if (!product || product.base_price == null || !Number.isFinite(price) || price <= 0) {
      throw new Error('Um dos produtos está indisponível para compra.');
    }
    if (product.catalog_allow_backorder === false && Number(product.stock_quantity || 0) < quantity) {
      throw new Error('Um produto não está disponível na quantidade selecionada.');
    }
    const unitCents = Math.round(price * 100);
    if (unitCents < 1) throw new Error('Preço do produto inválido.');
    return {
      product_id: product.id,
      product_sku: product.sku || '',
      product_name: String(product.name || ''),
      quantity,
      unit: product.unit || '',
      unit_price_snapshot: unitCents / 100,
      subtotal: unitCents * quantity / 100,
      stock_snapshot: Number(product.stock_quantity || 0),
      fulfillment_status:Number(product.stock_quantity || 0)>=quantity
        ?'pronta_entrega':'sob_encomenda',
      fulfillment_requires_review:Number(product.stock_quantity || 0)<quantity
    };
  });
}

export default async function handler(request,context) {
  if (request.method !== 'POST') return previousHandler(request,context);
  let body;
  try { body = await request.clone().json(); }
  catch { return json({ok:false,message:'Requisição inválida.'},400); }
  const action = String(body?.action || '');

  if (action === 'submit_order') {
    return json({ok:false,message:'Use a finalização com pagamento integrado ao Asaas.'},409);
  }
  if (action === 'change_payment_method') return changePaymentMethod(body);
  if (action === 'repair_checkout') return repairLegacyCheckout(body);

  if(action==='sandbox_customer_candidates'||action==='sandbox_customer_bind'){
    // Diagnóstico/vínculo somente na administração autenticada.
    // Não cria/cancela/consulta cobranças de checkout em andamento.
    const headers=new Headers(request.headers);
    headers.delete('content-length');
    const authRequest=new Request(request.url,{
      method:'POST',headers,body:JSON.stringify({action:'session'})
    });
    const authResponse=await previousHandler(authRequest,context);
    const auth=await authResponse.clone().json().catch(()=>null);
    if(!authResponse.ok||auth?.ok!==true||!auth?.user?.email)
      return json({ok:false,message:'Acesso administrativo necessário.'},401);
    const number=String(body?.request_number||'').trim().replace(/^EC-/i,'');
    if(!/^[0-9]{1,6}$/.test(number))
      return json({ok:false,message:'Informe um pedido de testes válido.'},400);
    const order=number.padStart(6,'0'),write=action==='sandbox_customer_bind';
    if(write&&(body?.confirm!==true||
      body?.confirm_phrase!=='VINCULAR CLIENTE EC-'+order))
      return json({ok:false,message:'Confirme o vínculo específico deste pedido.'},403);
    try{
      ensureSandbox();
      const links=await getJson('data/links',[]);
      const validLinks=Array.isArray(links)?links.filter(l=>
        String(l.request_number||'').padStart(6,'0')===order&&
        l.checkout_mode!=='production'):[];
      if(validLinks.length!==1)
        return json({ok:false,message:'Pedido de teste não encontrado de forma única.'},404);
      const link=validLinks[0];
      const clients=await getJson('data/clients',[]);
      const matching=Array.isArray(clients)?clients.filter(c=>
        String(c.id)===String(link.customer_id)):[];
      if(matching.length!==1)
        return json({ok:false,message:'Cliente Ever Clean não encontrado de forma única.'},404);
      const client=matching[0],clientId=String(client.id);
      const doc=digits(client.document||client.cpf_cnpj||client.cpfCnpj);
      if(![11,14].includes(doc.length))
        return json({ok:false,message:'Cadastro do cliente sem CPF/CNPJ válido.'},409);
      const found=await asaas('/customers?cpfCnpj='+encodeURIComponent(doc)+'&limit=100',
        undefined,'GET',{timeoutMs:10000});
      if(found.hasMore===true||!Array.isArray(found.data))
        return json({ok:false,message:'Consulta ao Asaas Sandbox incompleta. Nenhum vínculo alterado.'},409);
      const candidates=found.data.filter(c=>
        digits(c?.cpfCnpj)===doc&&
        /^cus_[a-zA-Z0-9_-]{5,100}$/.test(String(c?.id||'')));
      if(!candidates.length)return json({ok:false,
        message:'Não há cadastro Asaas com o CPF/CNPJ deste cliente.'},404);
      const safeLabel=c=>{
        const full=String(c.name||'').trim().slice(0,120);
        const name=full.split(/\s+/).filter(Boolean);
        const maskedName=name.length?name[0].slice(0,24)+' '+
          name.slice(1).map(x=>x[0]?.toUpperCase()+'.').join(' '):'Sem nome';
        const email=String(c.email||'').trim().toLowerCase();
        const emailHint=email.includes('@')?
          email.slice(0,2)+'***@'+email.split('@').pop().slice(0,60):'E-mail não cadastrado';
        const pastOrders=links.filter(l=>String(l.customer_id)===clientId&&
          String(l.asaas_customer_id)===String(c.id)).length;
        return {id:String(c.id),name:maskedName,email_hint:emailHint,
          used_in_previous_orders:pastOrders,
          email_matches:Boolean(email&&String(client.email||'').toLowerCase()===email)};
      };
      if(!write)return json({ok:true,request_number:order,
        environment:'sandbox',read_only:true,
        current_customer_id:/^cus_[a-zA-Z0-9_-]{5,100}$/.test(
          String(client.asaas_sandbox_customer_id||''))?
          String(client.asaas_sandbox_customer_id):null,
        candidates:candidates.slice(0,100).map(safeLabel),
        message:candidates.length>1?
          'Foram encontrados cadastros duplicados. Selecione o correto conferindo o nome e e-mail. Nenhum dado foi alterado.':
          'Foi encontrado um cadastro. Confirme o vínculo para os próximos pedidos.'});
      const chosen=String(body?.asaas_customer_id||'').trim();
      if(!/^cus_[a-zA-Z0-9_-]{5,100}$/.test(chosen)||
        candidates.filter(c=>String(c.id)===chosen).length!==1)
        return json({ok:false,message:'Selecione um dos cadastros encontrados neste pedido.'},403);
      if(clients.some(c=>String(c.id)!==clientId&&
        String(c.asaas_sandbox_customer_id||'')===chosen))
        return json({ok:false,message:'Este ID Asaas já está associado a outro cliente Ever Clean. Revise o cadastro.'},409);
      const detail=await asaas('/customers/'+encodeURIComponent(chosen),
        undefined,'GET',{timeoutMs:8500});
      if(String(detail?.id)!==chosen||digits(detail.cpfCnpj)!==doc)
        return json({ok:false,message:'O Asaas não confirmou que o ID selecionado corresponde ao CPF/CNPJ do cliente.'},409);
      // Reutilizar o cadastro somente depois de confirmar canais pagos
      // desativados. Nenhuma cobrança será criada por esta rotina.
      await enforceEmailOnlyNotifications(chosen,asaas);
      const fresh=await getJson('data/clients',[]);
      if(!Array.isArray(fresh)||fresh.filter(c=>String(c.id)===clientId).length!==1||
         fresh.some(c=>String(c.id)!==clientId&&
           String(c.asaas_sandbox_customer_id||'')===chosen))
        return json({ok:false,message:'Cadastro alterado em outra sessão. Atualize antes de confirmar.'},409);
      const latest=fresh.find(c=>String(c.id)===clientId);
      if(digits(latest.document||latest.cpf_cnpj||latest.cpfCnpj)!==doc)
        return json({ok:false,message:'Documento do cliente foi alterado. Nada foi vinculado.'},409);
      const saved=fresh.map(c=>String(c.id)===clientId?
        {...c,asaas_sandbox_customer_id:chosen}:c);
      await setJson('data/clients',saved);
      return json({ok:true,linked:true,environment:'sandbox',
        request_number:order,selected:safeLabel(detail),
        message:'Cliente Asaas Sandbox vinculado. Canais pagos conferidos/desativados, mantendo os e-mails. Nenhuma cobrança foi criada.'});
    }catch(error){
      console.warn('Asaas Sandbox: vínculo de cadastro não confirmado',
        Number(error?.status)||'n/a',String(error?.message||'falha').slice(0,100));
      return json({ok:false,message:'Não foi possível conferir/vincular o cliente no Asaas Sandbox. Nenhuma cobrança foi criada.'},502);
    }
  }

  if(action==='diagnose_customer_notifications'||
    action==='repair_customer_notifications'){
    // A ação só existe na administração. Reaproveita a validação de sessão
    // e nunca devolve credenciais, CPF, email, telefone ou IDs Asaas.
    const headers=new Headers(request.headers);
    headers.delete('content-length');
    const sessionRequest=new Request(request.url,{
      method:'POST',headers,body:JSON.stringify({action:'session'})
    });
    const sessionResponse=await previousHandler(sessionRequest,context);
    const session=await sessionResponse.clone().json().catch(()=>null);
    if(!sessionResponse.ok||!session?.ok||!session?.user?.email)
      return json({ok:false,message:'Acesso administrativo necessário.'},401);
    const number=String(body?.request_number||'').trim().replace(/^EC-/i,'');
    if(!/^[0-9]{1,6}$/.test(number))
      return json({ok:false,message:'Informe um número EC antigo válido (ex.: 000028).'},400);
    const order=number.padStart(6,'0');
    const change=action==='repair_customer_notifications';
    if(change&&(body?.confirm!==true||
      body?.confirm_phrase!=='REVISAR NOTIFICACOES EC-'+order))
      return json({ok:false,message:'Confirmação específica necessária.'},403);
    try{
      ensureSandbox();
      const links=await getJson('data/links',[]);
      const matching=Array.isArray(links)?links.filter(l=>
        String(l.request_number||'').padStart(6,'0')===order&&
        l.checkout_mode!=='production'):[];
      if(matching.length!==1)
        return json({ok:false,message:'Pedido Sandbox não encontrado de forma única.'},404);
      const link=matching[0];
      const clients=await getJson('data/clients',[]);
      const customerMatches=Array.isArray(clients)?clients.filter(c=>
        String(c.id)===String(link.customer_id)):[];
      if(customerMatches.length!==1)
        return json({ok:false,message:'Cliente do pedido não localizado no cadastro.'},404);
      const client=customerMatches[0];
      // Primeiro usar o ID Asaas salvo no próprio pedido: não depender de
      // CPF compartilhado ou de uma busca que pode retornar cadastros repetidos.
      let asaasId=String(link.asaas_customer_id||
        client.asaas_sandbox_customer_id||'');
      if(!/^cus_[a-zA-Z0-9_-]{5,100}$/.test(asaasId)&&
        /^pay_[a-zA-Z0-9_-]{6,100}$/.test(String(link.asaas_payment_id||''))){
        const paid=await asaas('/payments/'+encodeURIComponent(link.asaas_payment_id),
          undefined,'GET',{timeoutMs:8500});
        if(String(paid?.externalReference||'')===String(link.asaas_reference||'')&&
          /^cus_[a-zA-Z0-9_-]{5,100}$/.test(String(paid.customer||'')))
          asaasId=String(paid.customer);
      }
      if(!/^cus_[a-zA-Z0-9_-]{5,100}$/.test(asaasId)){
        const doc=digits(client.document||client.cpf_cnpj||client.cpfCnpj);
        if(![11,14].includes(doc.length))
          return json({ok:false,message:'Cliente sem CPF/CNPJ válido para identificar o cadastro de notificações. Nada foi alterado.'},409);
        const found=await asaas('/customers?cpfCnpj='+encodeURIComponent(doc)+
          '&limit=100',undefined,'GET',{timeoutMs:8500});
        const candidates=Array.isArray(found.data)?found.data.filter(c=>
          digits(c.cpfCnpj)===doc&&
          /^cus_[a-zA-Z0-9_-]{5,100}$/.test(String(c.id||''))):[];
        if(found.hasMore===true||candidates.length!==1)
          return json({ok:false,message:link.asaas_checkout_id&&!link.asaas_payment_id?
            'Checkout antigo hospedado no Asaas, sem cliente único identificado. '+
            'Se o pagador ainda não concluiu o cadastro, as notificações deste checkout não podem ser ajustadas com segurança. '+
            'Os NOVOS checkouts já vinculam o cliente antes de iniciar o pagamento. Nenhuma alteração realizada.':
            'Não foi possível identificar um único cliente Asaas Sandbox. '+
            'Revise cadastros duplicados; nenhuma alteração foi realizada.'},409);
        asaasId=String(candidates[0].id);
      }
      const endpoint='/customers/'+encodeURIComponent(asaasId)+'/notifications';
      const before=await asaas(endpoint,undefined,'GET',{timeoutMs:8500});
      if(before.hasMore===true)
        return json({ok:false,message:'As notificações vieram paginadas. Nenhuma alteração feita.'},409);
      const prior=summarizeNotificationChannels(before.data);
      if(!change)return json({ok:true,environment:'sandbox',
        request_number:order,read_only:true,diagnostic:prior,
        message:prior.channels_safe?'Somente canais de e-mail ativos; nenhuma alteração necessária.':
          'Há canais pagos ativos ou sem confirmação no Asaas Sandbox. Nenhuma alteração foi realizada.'});
      if(prior.channels_safe)return json({ok:true,environment:'sandbox',
        request_number:order,changed:false,diagnostic:prior,
        message:'Notificações já seguras: nenhuma modificação necessária.'});
      // Ajusta SOMENTE canais pagos do mesmo cliente mediante clique explícito.
      // A rotina mantém email/enabled como antes e reconsulta cada evento.
      try{
        await enforceEmailOnlyNotifications(asaasId,asaas);
      }catch(error){
        console.warn('Ever Clean: notificações Sandbox não confirmadas',
          String(error?.message||'falha').slice(0,140));
        const reread=await asaas(endpoint,undefined,'GET',{timeoutMs:8500}).catch(()=>null);
        const current=reread&&!reread.hasMore?
          (()=>{try{return summarizeNotificationChannels(reread.data)}
            catch{return null}})():null;
        return json({ok:false,environment:'sandbox',
          request_number:order,diagnostic:current,
          message:'O Asaas não confirmou a desativação de todos os canais pagos. '+
            'Nenhuma cobrança foi criada. Confira os canais ainda sinalizados.'},409);
      }
      const checked=await asaas(endpoint,undefined,'GET',{timeoutMs:8500});
      if(checked.hasMore===true)return json({ok:false,
        message:'Não foi possível confirmar todas as notificações no Sandbox.'},409);
      const status=summarizeNotificationChannels(checked.data);
      return json({ok:status.channels_safe,environment:'sandbox',
        request_number:order,changed:true,diagnostic:status,
        message:status.channels_safe?
          'Canais pagos desligados e e-mails preservados. Nenhuma cobrança foi criada.':
          'A confirmação dos canais pagos continua pendente.'},status.channels_safe?200:409);
    }catch(error){
      console.warn('Ever Clean: falha na auditoria de notificações Sandbox',
        Number(error?.status)||'n/a',String(error?.message||'erro').slice(0,110));
      return json({ok:false,message:'Não foi possível conferir as notificações na API do Asaas Sandbox. Nenhuma cobrança foi criada.',
        httpStatus:Number(error?.status)||null},502);
    }
  }

  if (action === 'diagnose_pix') {
    // Apenas o administrador autenticado pode consultar o diagnóstico.
    const headers=new Headers(request.headers);
    headers.delete('content-length');
    const sessionRequest=new Request(request.url,{
      method:'POST', headers,
      body:JSON.stringify({action:'session'})
    });
    const sessionResponse=await previousHandler(sessionRequest,context);
    const sessionData=await sessionResponse.clone().json().catch(()=>null);
    if(!sessionResponse.ok || !sessionData?.ok || !sessionData?.user?.email) {
      return json({ok:false,message:'Entre como administrador para consultar o Asaas.'},401);
    }
    try {
      const result=await asaas('/pix/addressKeys?limit=100');
      const keys=Array.isArray(result.data)?result.data:[];
      const statusCounts={};
      keys.forEach(key=>{
        const state=String(key.status||'DESCONHECIDO').toUpperCase();
        statusCounts[state]=(statusCounts[state]||0)+1;
      });
      // Compara as cobranças PIX existentes sem criar novas cobranças nem expor dados bancários.
      // Falhas nessas consultas não impedem a exibição dos estados das chaves.
      let pixPayments=null;
      let accountApproval=null;
      let paymentsError=null;
      try {
        const [paymentResult,approvalResult]=await Promise.allSettled([
          asaas('/payments?limit=50&billingType=PIX'),
          asaas('/myAccount/status/')
        ]);
        if(paymentResult.status==='fulfilled') {
          const records=Array.isArray(paymentResult.value?.data)?paymentResult.value.data:[];
          const pixOnly=records.filter(item=>String(item.billingType||'').toUpperCase()==='PIX');
          const direct=pixOnly.filter(item=>!String(item.externalReference||'').startsWith('EVERCLEAN-EC-'));
          const fromEverClean=pixOnly.filter(item=>String(item.externalReference||'').startsWith('EVERCLEAN-EC-'));
          const isPaid=item=>['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(String(item.status||'').toUpperCase());
          pixPayments={
            total:pixOnly.length,
            fromEverClean:fromEverClean.length,
            fromOtherSources:direct.length,
            paidFromOtherSources:direct.filter(isPaid).length,
            paidFromEverClean:fromEverClean.filter(isPaid).length,
            hasMore:Boolean(paymentResult.value?.hasMore)
          };
        } else paymentsError='Não foi possível consultar a lista de cobranças PIX da conta.';
        if(approvalResult.status==='fulfilled') {
          const state=approvalResult.value||{};
          accountApproval={
            general:String(state.general||'DESCONHECIDO'),
            commercialInfo:String(state.commercialInfo||'DESCONHECIDO'),
            documentation:String(state.documentation||'DESCONHECIDO')
          };
        }
      } catch(error) {
        paymentsError='A consulta complementar das cobranças não foi concluída.';
      }
      // Auditoria apenas de metadados do Webhook, sem expor authToken ou chave de API.
      let webhookDiagnostics={ok:false,message:'Não foi possível consultar os Webhooks cadastrados no Asaas.'};
      try {
        const hooks=await asaas('/webhooks?limit=100');
        const configurations=Array.isArray(hooks.data)?hooks.data:[];
        const matching=configurations.filter(hook=>
          String(hook.url||'').startsWith('https://evercleancatalogo.netlify.app/.netlify/functions/asaas-webhook') ||
          String(hook.url||'').startsWith('https://cleancatalogo.netlify.app/.netlify/functions/asaas-webhook')
        );
        webhookDiagnostics={
          ok:true,
          total:configurations.length,
          matching:matching.length,
          hasMore:Boolean(hooks.hasMore),
          configurations:matching.map(hook=>({
            destination: String(hook.url||'').includes('evercleancatalogo.netlify.app')?'evercleancatalogo.netlify.app':'cleancatalogo.netlify.app',
            enabled:hook.enabled===true,
            interrupted:hook.interrupted===true,
            receivesCheckoutPaid:Array.isArray(hook.events)&&hook.events.includes('CHECKOUT_PAID'),
            receivesPaymentConfirmed:Array.isArray(hook.events)&&
              (hook.events.includes('PAYMENT_CONFIRMED')||hook.events.includes('PAYMENT_RECEIVED')),
            eventsCount:Array.isArray(hook.events)?hook.events.length:0
          }))
        };
      } catch(error) {
        console.warn('Ever Clean: não foi possível auditar webhook Asaas',error?.status||'');
      }
      const webhookRecent = await getJson('data/asaas_webhook_recent',[]);
      return json({
        ok:true, environment:'sandbox',
        webhookDiagnostics,
        webhookRecent:Array.isArray(webhookRecent)?webhookRecent.slice(0,10):[],
        pixPayments,accountApproval,paymentsError,
        total:keys.length,
        active:statusCounts.ACTIVE||0,
        awaitingActivation:statusCounts.AWAITING_ACTIVATION||0,
        error:statusCounts.ERROR||0,
        statuses:statusCounts,
        isLastPage:!result.hasMore,
        checkedAt:new Date().toISOString()
      });
    } catch(error) {
      console.error('Ever Clean: falha ao diagnosticar chave PIX via Asaas',error?.status||'sem status');
      return json({ok:false,message:'A consulta das chaves PIX à API Asaas falhou. Confira as credenciais do Sandbox e as permissões da API.',httpStatus:error?.status||null},502);
    }
  }

  if (action === 'catalog') {
    const base = await previousHandler(request,context);
    const payload = await base.clone().json().catch(() => null);
    if (!payload?.ok) return base;
    const token = String(body.token || '');
    const links = await getJson('data/links',[]);
    const link = links.find(item => item.token === token);
    const clients = await getJson('data/clients',[]);
    const client = clients.find(item => item.id === link?.customer_id);
    const sanitizeMethods = methods => (methods || []).filter(method => method !== 'boleto' || client?.allow_boleto === true);
    return json({
      ...payload,
      ...(link ? {link:{...payload.link, payment_status:link.payment_status || null}} : {}),
      ...(payload.customer ? {customer:{...payload.customer,payment_methods:sanitizeMethods(payload.customer.payment_methods)}} : {}),
      payment_pending: link?.asaas_reference ? publicPayment(link,allowedMethodsFor(client)) : null
    });
  }

  if (action === 'payment_status' || action === 'refresh_pix') {
    const token = String(body.token || '');
    if (!token || token.length > 250) return json({ok:false,message:'Link inválido.'},400);
    const links = await getJson('data/links',[]);
    const link = links.find(item => item.token === token);
    if (!link?.asaas_reference) return json({ok:false,message:'Cobrança não encontrada.'},404);

    if (action === 'refresh_pix') {
      if (link.payment_method !== 'pix' || !link.asaas_payment_id) {
        return json({ok:false,message:'Este pedido não possui cobrança PIX.'},400);
      }
      if (link.payment_status === 'pago') {
        return json({ok:true,payment:publicPayment(link),paid:true});
      }
      // Consulta EXCLUSIVAMENTE a cobrança já existente (GET, sem novo pedido).
      // Apenas um dos dois campos basta: se houver copia-e-cola, não exigir imagem.
      if (link.asaas_pix_payload || link.asaas_pix_image) {
        if(link.asaas_pix_error){
          link.asaas_pix_error=null;
          await setJson('data/links',links);
        }
        return json({ok:true,payment:publicPayment(link)});
      }
      const lastAttempt = new Date(link.asaas_pix_last_attempt_at || 0).getTime();
      if (Date.now() - lastAttempt < 22000) {
        return json({ok:true,payment:publicPayment(link),
          retry_after:Math.max(1,Math.ceil((22000-(Date.now()-lastAttempt))/1000))});
      }
      link.asaas_pix_last_attempt_at = now();
      try {
        // O Sandbox respondeu após o limite anterior de 6,5s.
        // 18s ainda deixa margem para a execução do Netlify concluir.
        const qr = await asaas('/payments/' + encodeURIComponent(link.asaas_payment_id) +
          '/pixQrCode', undefined, 'GET', {timeoutMs:18000});
        if (!qr.payload && !qr.encodedImage) {
          throw new Error('O Asaas retornou resposta sem QR Code e sem código PIX.');
        }
        link.asaas_pix_payload = qr.payload || null;
        link.asaas_pix_image = qr.encodedImage || null;
        link.asaas_pix_expiration = qr.expirationDate || null;
        link.asaas_pix_error = null;
      } catch(error) {
        const detail = String(error?.message || 'Falha na consulta do PIX').slice(0,160);
        link.asaas_pix_error = Number(error?.status)===504?
          'O Asaas Sandbox não respondeu à consulta do QR Code dentro de 18 segundos. '+
          'A cobrança PIX continua pendente. Use “Abrir cobrança no Asaas” ou consulte a habilitação do PIX em Administração → Asaas.':
          'O Asaas não retornou o código PIX desta cobrança: '+detail;
        console.warn('Ever Clean: leitura do QR Code Sandbox falhou',
          Number(error?.status)||'sem_status',String(link.request_number||''));
      }
      await setJson('data/links',links);
      return json({ok:true,payment:publicPayment(link)});
    }

    // Checkouts Asaas não possuem asaas_payment_id até o pagador concluir a compra.
    // Conciliação sob demanda: buscar cobranças pelo checkoutSession e pelo identificador
    // do pedido, confirmando referência, método, valor e status antes de marcar como pago.
    if (link.asaas_checkout_id && !link.asaas_payment_id && link.payment_status !== 'pago') {
      const lastCheckoutCheck = new Date(link.asaas_checkout_checked_at || 0).getTime();
      if (Date.now()-lastCheckoutCheck > 20000) {
        link.asaas_checkout_checked_at=now();
        try {
          const orders=await getJson('data/orders',[]);
          const order=orders.find(o=>
            o.asaas_checkout_id===link.asaas_checkout_id &&
            o.asaas_reference===link.asaas_reference &&
            o.request_number===link.request_number
          );
          if (!order) {
            console.warn('Ever Clean: checkout sem pedido correspondente',link.request_number);
          } else {
            const expectedCents=Math.round(Number(order.total_amount||0)*100);
            const linkCents=Math.round(Number(link.known_total||0)*100);
            if (expectedCents>0 && expectedCents===linkCents) {
              const queries=[
                '/payments?checkoutSession='+encodeURIComponent(link.asaas_checkout_id)+'&limit=100',
                '/payments?externalReference='+encodeURIComponent(link.asaas_reference)+'&limit=100'
              ];
              const responses=await Promise.allSettled(queries.map(query=>asaas(query)));
              const candidates=responses.flatMap(response=>
                response.status==='fulfilled' && Array.isArray(response.value?.data)
                  ? response.value.data : []
              );
              const getCheckoutId=payment=>typeof payment.checkoutSession==='string'
                ? payment.checkoutSession : String(payment.checkoutSession?.id||'');
              const verified=candidates.filter(payment=>{
                const matchesIdentity=
                  getCheckoutId(payment)===String(link.asaas_checkout_id) ||
                  String(payment.externalReference||'')===String(link.asaas_reference);
                return matchesIdentity &&
                  Math.round(Number(payment.value||0)*100)===expectedCents &&
                  String(payment.billingType||'')==='CREDIT_CARD';
              });
              const paid=verified.find(payment=>['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(String(payment.status||'')));
              const reversed=verified.find(payment=>['REFUNDED','REFUND_REQUESTED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE'].includes(String(payment.status||'')));
              const state=reversed?'estornado':paid?'pago':null;
              if(state && state!==link.payment_status){
                const time=now();
                order.payment_status=state;
                order.status=state==='pago'?'pagamento_confirmado':'pagamento_estornado';
                order.payment_updated_at=time;
                order.payment_confirmed_source='asaas_api_verified_checkout';
                link.payment_status=state;
                link.status=state==='pago'?'enviado':'pagamento_pendente';
                link.payment_updated_at=time;
                link.asaas_reconciled_payment_id=String((reversed||paid).id||'');
                await setJson('data/orders',orders);
              }
              if(responses.every(response=>response.status==='rejected')){
                console.warn('Ever Clean: consultas de checkout indisponíveis');
              }
            }
          }
        } catch(error) {
          console.warn('Ever Clean: não foi possível conciliar checkout',error?.status||'',String(error?.message||'').slice(0,130));
        }
        await setJson('data/links',links);
      }
    }

    // Sincroniza o status diretamente com o Asaas como reforço ao Webhook.
    const lastCheck = new Date(link.asaas_status_checked_at || 0).getTime();
    if (link.asaas_payment_id && link.payment_status !== 'pago' && Date.now()-lastCheck > 30000) {
      link.asaas_status_checked_at = now();
      try {
        const charge = await asaas('/payments/' + encodeURIComponent(link.asaas_payment_id));
        let state = null;
        if (['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(charge.status)) state='pago';
        if (charge.status === 'OVERDUE') state='vencido';
        if (charge.status === 'REFUNDED') state='estornado';
        if (charge.status === 'DELETED') state='cancelado';
        if (state && state !== link.payment_status) {
          link.payment_status=state;
          link.payment_updated_at=now();
          const orders=await getJson('data/orders',[]);
          const order=orders.find(item=>item.asaas_reference===link.asaas_reference);
          if(order) {
            order.payment_status=state;
            order.status=state==='pago'?'pagamento_confirmado':'pagamento_'+state;
            order.payment_updated_at=link.payment_updated_at;
            await setJson('data/orders',orders);
          }
        }
      } catch(error) {
        console.warn('Ever Clean: consulta de status Asaas indisponível',error?.status || '');
      }
      await setJson('data/links',links);
    }
    return json({ok:true,payment:publicPayment(link),paid:link.payment_status === 'pago'});
  }

  if (action !== 'create_payment') return previousHandler(request,context);

  try {
    ensureSandbox();
    const token = String(body.token || '');
    if (!token || token.length > 250) return json({ok:false,message:'Link inválido.'},400);
    const links = await getJson('data/links',[]);
    const link = links.find(item => item.token === token);
    if (!link) return json({ok:false,message:'Link de pedido não localizado.'},404);
    if (link.checkout_mode === 'production')return json({ok:false,message:'Este link pertence ao checkout de produção. Cobrança de testes bloqueada.'},403);
    if (link.status === 'cancelado' || new Date(link.expires_at).getTime() < Date.now()) {
      return json({ok:false,message:'Link expirado ou cancelado.'},410);
    }
    if (link.asaas_reference) {
      return json({ok:true,reused:true,payment:publicPayment(link)});
    }
    if (link.status === 'enviado') return json({ok:false,message:'O pedido deste link já foi enviado.'},409);

    const clients = await getJson('data/clients',[]);
    const client = clients.find(item => item.id === link.customer_id);
    if (!client) return json({ok:false,message:'Cliente não localizado. Solicite a atualização do cadastro.'},400);
    const method = String(body.payment_method || '');
    const allowed = [...allowedMethodsFor(client),'link_pagamento'];
    if (!allowed.includes(method)) return json({ok:false,message:'Pagamento não autorizado para este cliente.'},403);

    const allProducts = await getJson('data/products',[]);
    const items = validateCart(body.items,allProducts);
    const totalCents = items.reduce((sum,item) => sum + Math.round(item.subtotal * 100),0);
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error('Total de pedido inválido.');
    const total = totalCents / 100;
    const reference = 'EVERCLEAN-EC-' + String(link.request_number || '0') + '-' + crypto.randomUUID();
    const requestNo = 'EC-' + String(link.request_number || 0).padStart(6,'0');
    const callback = 'https://evercleancatalogo.netlify.app/pedido/' + encodeURIComponent(token);
    let paymentId = null;
    let asaasCustomerId = null;
    let checkoutId = null;
    let invoiceUrl = null;
    let boletoUrl = null;
    let checkoutUrl = null;
    let pixPayload = null;
    let pixImage = null;
    let pixExpiration = null;
    let pixError = null;
    let dueDate = null;

    if (method === 'pix' || method === 'boleto' || method === 'link_pagamento') {
      const asaasCustomer = await getAsaasCustomer(client);
      asaasCustomerId=asaasCustomer;
      dueDate = addDays(new Date(),method === 'boleto' ? 7 : 1);
      const payment = await asaas('/payments',{
        customer: asaasCustomer,
        billingType: method === 'pix' ? 'PIX' : method === 'boleto' ? 'BOLETO' : 'UNDEFINED',
        value: total,
        dueDate,
        description: 'Pedido ' + requestNo + ' - Ever Clean Higiene Profissional',
        externalReference:reference
      });
      if (!payment.id) throw new Error('O Asaas não retornou o identificador da cobrança.');
      paymentId = payment.id;
      invoiceUrl = payment.invoiceUrl || null;
      boletoUrl = method === 'boleto' ? (payment.bankSlipUrl || null) : null;
      checkoutUrl = method === 'link_pagamento' ? invoiceUrl : null;
      if (method === 'pix') {
        try {
          const code = await asaas('/payments/' + encodeURIComponent(payment.id) + '/pixQrCode', undefined, 'GET', {timeoutMs:6500});
          pixPayload = code.payload || null;
          pixImage = code.encodedImage || null;
          pixExpiration = code.expirationDate || null;
        } catch(error) {
          const detail=String(error?.message || 'O Asaas não forneceu o QR Code.').slice(0,170);
          pixError='O PIX ainda não está disponível no Asaas Sandbox. Verifique a habilitação da conta e a chave PIX. Detalhe: '+detail;
          console.warn('Asaas: QR Code indisponível:',error?.status || '',detail);
        }
      }
    } else {
      // Vincular o checkout ao MESMO cadastro Asaas já configurado apenas
      // para e-mail. Sem customer, o checkout hospedado cria outro cadastro
      // com SMS/voz padrão, escapando da política de notificações.
      // Faltantes de endereço/contato são preenchidos na página Asaas.
      const asaasCustomer=await getAsaasCustomer(client);
      asaasCustomerId=asaasCustomer;
      const checkout = await asaas('/checkouts',{
        customer:asaasCustomer,
        billingTypes:['CREDIT_CARD'],
        chargeTypes:['DETACHED'],
        minutesToExpire:60,
        externalReference:reference,
        callback:{successUrl:callback,cancelUrl:callback,expiredUrl:callback},
        items:items.map(item=>({name:item.product_name.slice(0,160),quantity:item.quantity,value:item.unit_price_snapshot}))
      });
      if (!checkout.id) throw new Error('O Asaas não retornou o identificador do checkout.');
      checkoutId = checkout.id;
      // Não montar uma URL de checkout manualmente. O Asaas alterou o formato
      // dos links públicos e o Sandbox pode usar um domínio/caminho diferente.
      const returnedLink = String(checkout.link || '');
      let parsedCheckoutUrl;
      try { parsedCheckoutUrl = new URL(returnedLink); } catch { parsedCheckoutUrl = null; }
      if (!parsedCheckoutUrl ||
          parsedCheckoutUrl.protocol !== 'https:' ||
          parsedCheckoutUrl.hostname !== 'sandbox.asaas.com') {
        console.error('Asaas Sandbox: checkout criado sem link público válido:', checkout.id);
        // Mantém o checkout registrado no pedido para análise, sem abrir um URL incorreto.
        checkoutUrl = null;
      } else {
        checkoutUrl = parsedCheckoutUrl.href;
      }
    }

    const issuedAt = now();
    const units = items.reduce((sum,item) => sum + item.quantity,0);
    Object.assign(link,{
      status:'pagamento_pendente',
      payment_status:'aguardando_pagamento',
      payment_method:method,
      payment_allowed_methods:allowedMethodsFor(client),
      known_total:total,
      items_count:items.length,
      units_count:units,
      fulfillment_requires_review:items.some(item=>item.fulfillment_requires_review),
      fulfillment_status:items.some(item=>item.fulfillment_requires_review)
        ?'aguardando_reposicao_ou_ajuste':'pronta_entrega',
      customer_notes:String(body.notes || '').slice(0,2000),
      invoice_requested:Boolean(body.invoice_requested),
      invoice_channel:body.invoice_requested ? String(body.invoice_channel || '') : null,
      invoice_contact:body.invoice_requested ? String(body.invoice_contact || '').slice(0,200) : null,
      asaas_reference:reference,
      // Cliente configurado apenas para e-mail antes de iniciar o pagamento.
      asaas_customer_id:asaasCustomerId,
      asaas_payment_id:paymentId,
      asaas_checkout_id:checkoutId,
      asaas_checkout_url:checkoutUrl,
      asaas_invoice_url:invoiceUrl,
      asaas_boleto_url:boletoUrl,
      asaas_pix_payload:pixPayload,
      asaas_pix_image:pixImage,
      asaas_pix_expiration:pixExpiration,
      asaas_pix_error:pixError,
      asaas_pix_last_attempt_at:method==='pix'?now():null,
      asaas_due_date:dueDate,
      submitted_at:issuedAt
    });
    const orders = await getJson('data/orders',[]);
    orders.unshift({
      id:crypto.randomUUID(),
      order_number:requestNo,
      request_number:link.request_number,
      customer_id:link.customer_id,
      customer_name:link.customer_name,
      created_at:issuedAt,
      total_amount:total,
      status:'aguardando_pagamento',
      payment_status:'aguardando_pagamento',
      payment_method:method,
      asaas_reference:reference,
      // Cliente configurado apenas para e-mail antes de iniciar o pagamento.
      asaas_customer_id:asaasCustomerId,
      asaas_payment_id:paymentId,
      asaas_checkout_id:checkoutId,
      source:'Catálogo Ever Clean / Asaas Sandbox',
      fulfillment_requires_review:link.fulfillment_requires_review,
      fulfillment_status:link.fulfillment_status,
      notes:link.customer_notes,
      invoice_requested:link.invoice_requested,
      invoice_channel:link.invoice_channel,
      invoice_contact:link.invoice_contact,
      items
    });
    // Persistir o pedido antes do link de cobrança, para associar o webhook.
    await setJson('data/orders',orders);
    await setJson('data/links',links);
    return json({ok:true,payment:publicPayment(link)});
  } catch(error) {
    console.error('Ever Clean Asaas:',error?.message || 'Erro');
    return json({ok:false,message:error?.message || 'Falha ao criar a cobrança no Asaas.'},502);
  }
}
