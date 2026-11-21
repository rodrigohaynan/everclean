import crypto from 'node:crypto';
import {getStore} from '@netlify/blobs';
import legacy from './test-api-v7.mjs';
import {json,getJson,setJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';

// HOMOLOGAÇÃO: este endpoint só permite consultas GET externas e prévias locais.
// Não possui nenhuma rota para POST de cobranças, criação de clientes, pedidos ou notas.
const ASAAS='https://api.asaas.com/v3';
const BLING='https://api.bling.com.br/Api/v3';
const CALLBACK='https://evercleancatalogo.netlify.app/.netlify/functions/asaas-webhook-production';
const norm=v=>String(v??'').trim().toUpperCase();
const digits=v=>String(v||'').replace(/\D/g,'');
const moneyCent=v=>Math.round(Number(v)*100);
const num=v=>Number(v);
function blingProductId(p){
  const id=String(p?.bling_product_id||'')||
    String(p?.id||'').match(/^bling-product-(\d+)$/)?.[1]||'';
  return /^\d{1,20}$/.test(id)?id:null;
}
function blingClientId(c){
  const id=String(c?.bling_contact_id||'')||
    String(c?.id||'').match(/^client-(\d+)$/)?.[1]||'';
  return /^\d{1,20}$/.test(id)?id:null;
}
function validDocument(raw){
  const value=digits(raw);
  if(![11,14].includes(value.length)||/^(\d)\1+$/.test(value))return false;
  if(value.length===11){
    for(let pos=9;pos<=10;pos++){
      const sum=value.slice(0,pos).split('').reduce((acc,d,i)=>acc+Number(d)*(pos+1-i),0);
      const expected=(sum*10)%11===10?0:(sum*10)%11;
      if(Number(value[pos])!==expected)return false;
    }
    return true;
  }
  const weights=[6,5,4,3,2,9,8,7,6,5,4,3,2];
  for(const len of [12,13]){
    const used=len===12?weights.slice(1):weights;
    const sum=value.slice(0,len).split('').reduce((acc,d,i)=>acc+Number(d)*used[i],0);
    const digit=sum%11<2?0:11-sum%11;
    if(Number(value[len])!==digit)return false;
  }
  return true;
}
async function externalGet(base,path,key,type){
  const response=await fetch(base+path,{
    headers:type==='bling'?{Accept:'application/json',Authorization:'Bearer '+key,'enable-jwt':'1'}:
      {Accept:'application/json',access_token:key,'User-Agent':'EverCleanCatalogo/1.0'},
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Error(type==='bling'?'Bling HTTP '+response.status:'Asaas HTTP '+response.status);
  return response.json();
}
const check=(id,label,ok,detail)=>({id,label,ok:Boolean(ok),detail});
async function options(){
  const [clients,products,verified,test]=await Promise.all([
    getJson('data/clients',[]),getJson('data/products',[]),
    getJson('integrations/asaas-prod/last-verification',null),
    getJson('integrations/asaas-prod/last-transport-test',null)
  ]);
  const cs=(Array.isArray(clients)?clients:[]).filter(c=>c?.id&&c?.document)
    .slice(0,650).map(c=>({
      id:String(c.id),name:String(c.trade_name||c.legal_name||c.name||'Cliente').slice(0,100),
      document_valid:validDocument(c.document),has_bling:!!blingClientId(c)
    })).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  const ps=(Array.isArray(products)?products:[]).filter(p=>
    p?.id&&p.active!==false&&p.catalog_visible!==false&&num(p.base_price)>0
  ).slice(0,650).map(p=>({
    id:String(p.id),sku:String(p.sku||'').slice(0,55),
    name:String(p.name||'Produto').slice(0,100),
    price:num(p.base_price),stock:num(p.stock_quantity)||0,
    has_bling:!!blingProductId(p)
  })).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  return json({ok:true,mode:'preparacao_sem_cobranca',production_payments_enabled:false,
    clients:cs,products:ps,verified_at:verified?.at||null,
    technical_test_at:test?.verified_at||null,
    message:'Selecione um cliente e produto para conferir a futura cobrança, sem criá-la.'});
}
async function preview(body){
  const id=String(body.client_id||''),pid=String(body.product_id||'');
  const quantity=num(body.quantity);
  if(id.length>140||pid.length>140||!Number.isInteger(quantity)||quantity<1||quantity>20){
    return json({ok:false,message:'Selecione cliente e produto e informe quantidade entre 1 e 20.'},400);
  }
  const [allClients,allProducts,test,verified]=await Promise.all([
    getJson('data/clients',[]),getJson('data/products',[]),
    getJson('integrations/asaas-prod/last-transport-test',null),
    getJson('integrations/asaas-prod/last-verification',null)
  ]);
  const clients=Array.isArray(allClients)?allClients:[];
  const products=Array.isArray(allProducts)?allProducts:[];
  const c=clients.find(c=>String(c.id)===id);
  const p=products.find(p=>String(p.id)===pid);
  if(!c||!p)return json({ok:false,message:'Cliente ou produto não encontrado no catálogo.'},404);
  const sku=norm(p.sku),customerId=blingClientId(c),productId=blingProductId(p);
  const localSkuCount=products.filter(r=>norm(r.sku)&&norm(r.sku)===sku).length;
  const stock=num(p.stock_quantity),priceCents=moneyCent(p.base_price);
  const totalCents=priceCents*quantity;
  const checks=[
    check('sandbox','Ambiente Sandbox separado',
      String(env('ASAAS_BASE_URL')).replace(/\/+$/,'')==='https://api-sandbox.asaas.com/v3',
      'Cobranças atuais de testes permanecem no Sandbox.'),
    check('prod_key','Chave de produção cadastrada',String(env('ASAAS_PROD_API_KEY')).length>=20,
      'A credencial da produção não substitui a do Sandbox.'),
    check('token','Token do webhook de produção configurado',
      String(env('ASAAS_PROD_WEBHOOK_TOKEN')).length>=32,
      'Autenticação exclusiva do webhook de produção.'),
    check('transport','Webhook passou no teste de transporte, autenticação e duplicidade',
      test?.transport_ok&&test?.duplicate_protection&&test?.invalid_token_rejected,
      test?.verified_at?'Último teste: '+test.verified_at:'Execute o teste técnico do webhook.'),
    check('client_document','CPF/CNPJ válido',validDocument(c.document),
      validDocument(c.document)?'Documento validado localmente.':'Corrija o CPF/CNPJ do cliente.'),
    check('client_bling','Cliente vinculado ao Bling',!!customerId,
      customerId?'ID do contato presente.':'Cliente sem identificador Bling.'),
    check('sku','SKU único e produto vinculado ao Bling',!!sku&&localSkuCount===1&&!!productId,
      !!sku&&localSkuCount===1&&!!productId?'Vínculo local identificado.':'Corrija SKU ou vínculo Bling.'),
    check('stock','Produto ativo com estoque disponível',
      p.active!==false&&p.catalog_visible!==false&&Number.isFinite(stock)&&stock>=quantity,
      'Quantidade solicitada '+quantity+'; disponível '+(Number.isFinite(stock)?stock:0)+'.'),
    check('price','Preço e total válidos',
      Number.isSafeInteger(totalCents)&&priceCents>0&&totalCents>=100&&totalCents<=10000000,
      'Total calculado pelo preço cadastrado, sem digitação manual.'),
  ];
  const prodKey=String(env('ASAAS_PROD_API_KEY')||'');
  if(prodKey.length>=20){
    try{
      const [account,hooks]=await Promise.all([
        externalGet(ASAAS,'/myAccount/status/',prodKey,'asaas'),
        externalGet(ASAAS,'/webhooks?limit=100',prodKey,'asaas')
      ]);
      const active=Array.isArray(hooks.data)?hooks.data.find(h=>
        h.url===CALLBACK&&h.enabled===true&&h.interrupted!==true&&
        Array.isArray(h.events)&&h.events.includes('PAYMENT_CONFIRMED')&&h.events.includes('PAYMENT_RECEIVED')
      ):null;
      checks.push(check('asaas_approved','Conta Asaas Produção aprovada',
        account?.general==='APPROVED','Situação atual da API: '+String(account?.general||'não informada').slice(0,30)+'.'));
      checks.push(check('webhook_active','Webhook de produção ativo para confirmação PIX',
        !!active,'Eventos PAYMENT_CONFIRMED e PAYMENT_RECEIVED habilitados.'));
    }catch(error){
      checks.push(check('asaas_approved','Situação da conta Asaas verificada',false,
        'API indisponível no momento: '+String(error.message).slice(0,80)));
      checks.push(check('webhook_active','Webhook de produção confirmado',false,
        'Confira a integração no painel Asaas.'));
    }
  }
  if(customerId&&productId){
    try{
      const token=await blingAccessToken();
      if(!token)throw Error('A autorização Bling não está ativa.');
      const [contact,product]=await Promise.all([
        externalGet(BLING,'/contatos/'+encodeURIComponent(customerId),token,'bling'),
        externalGet(BLING,'/produtos/'+encodeURIComponent(productId),token,'bling')
      ]);
      checks.push(check('customer_match','Cliente confere com o Bling',
        digits(contact?.data?.numeroDocumento)===digits(c.document),
        'CPF/CNPJ confrontado com o cadastro do Bling.'));
      checks.push(check('product_match','Produto confere com o Bling',
        norm(product?.data?.codigo)===sku,
        'SKU confrontado com o produto do Bling.'));
    }catch(error){
      checks.push(check('customer_match','Cliente conferido no Bling',false,
        'Falha ao confirmar o contato: '+String(error.message).slice(0,70)));
      checks.push(check('product_match','Produto conferido no Bling',false,
        'Falha ao confirmar o produto.'));
    }
  }
  const failed=checks.filter(x=>!x.ok);
  return json({ok:true,mode:'simulacao_producao',
    can_create_real_payment:false,can_send_to_bling:false,can_issue_invoice:false,
    selection:{client_name:String(c.trade_name||c.legal_name||c.name||'Cliente').slice(0,110),
      document_ending:digits(c.document).slice(-4),product_name:String(p.name||'Produto').slice(0,110),
      sku:String(p.sku||''),quantity,unit_price:priceCents/100,total:totalCents/100,
      payment_method:'PIX (futuro teste controlado)'},
    checks,approved:failed.length===0,issues:failed.length,
    message:failed.length===0?
      'Dados preparados e verificados. Nenhuma cobrança real foi criada; liberação financeira permanece bloqueada.':
      'Existem pendências a resolver antes do primeiro pedido real. Nenhuma cobrança foi criada.'});
}

const PILOT_KEY='integrations/asaas-prod/pilot/first-payment';
const safePayment=(record)=>record?{
  state:record.state||'desconhecido',
  created_at:record.created_at||null,
  last_checked_at:record.last_checked_at||null,
  total:record.total||null,
  payment_id:record.payment_id||null,
  payment_status:record.payment_status||'aguardando_pagamento',
  pix_payload:record.pix_payload||null,
  pix_image:record.pix_image||null,
  invoice_url:record.invoice_url||null,
  external_reference:record.external_reference||null,
  message:record.message||null
}:null;
const paid=(status)=>['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(String(status||''));
async function prodApi(path,method='GET',payload=null){
  const key=String(env('ASAAS_PROD_API_KEY')||'');
  if(key.length<20)throw Error('Chave do Asaas Produção não configurada.');
  const response=await fetch(ASAAS+path,{
    method,
    headers:{Accept:'application/json',access_token:key,'User-Agent':'EverCleanCatalogo/1.0',
      'Content-Type':'application/json'},
    ...(method==='GET'?{}:{body:JSON.stringify(payload)}),
    signal:AbortSignal.timeout(15000)
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const detail=Array.isArray(data?.errors)
      ?data.errors.map(e=>String(e.description||'')).filter(Boolean).join('; ').slice(0,150):'';
    throw Error((detail||'Asaas recusou a operação')+' (HTTP '+response.status+').');
  }
  return data;
}
async function pilotStatus(){
  const stored=await getJson(PILOT_KEY,null);
  return json({ok:true,pilot:safePayment(stored),real_payments_enabled:false,
    automatic_bling_orders:false,automatic_invoices:false});
}
async function lookupCustomer(client,record){
  const cpf=digits(client.document);
  const response=await prodApi('/customers?cpfCnpj='+encodeURIComponent(cpf)+'&limit=100');
  const matches=(Array.isArray(response?.data)?response.data:[]).filter(c=>digits(c.cpfCnpj)===cpf);
  if(matches.length>1)throw Error('Mais de um cadastro com este CPF/CNPJ no Asaas. Confira os clientes antes de continuar.');
  if(matches.length===1)return String(matches[0].id||'');
  const name=String(client.legal_name||client.trade_name||client.name||'').trim().slice(0,150);
  if(name.length<3)throw Error('Nome do pagador incompleto.');
  const created=await prodApi('/customers','POST',{
    name,cpfCnpj:cpf,
    externalReference:'everclean-'+String(client.id).slice(0,100),
    notificationDisabled:true
  });
  if(!created?.id)throw Error('O Asaas não confirmou o cadastro do pagador.');
  return String(created.id);
}
async function createPilot(body){
  // Operação real de valor estritamente limitado, sempre sob clique/confirmacão do administrador.
  if(body.confirm_phrase!=='AUTORIZO PIX REAL'||body.confirm_real_payment!==true){
    return json({ok:false,message:'Confirmação explícita obrigatória para criar uma cobrança financeira real.'},403);
  }
  const existing=await getJson(PILOT_KEY,null);
  if(existing)return json({ok:false,pilot:safePayment(existing),
    message:'Já existe uma tentativa ou cobrança piloto registrada. Nenhuma segunda cobrança será criada.'},409);
  const response=await preview(body);
  const preflight=await response.json().catch(()=>null);
  if(!preflight?.ok||!preflight?.approved){
    return json({ok:false,message:'A validação deve estar totalmente aprovada antes de criar o PIX. Gere uma nova prévia.'},409);
  }
  if(preflight.selection?.sku!=='100388'||preflight.selection?.quantity!==1||
    moneyCent(preflight.selection?.total)!==700){
    return json({ok:false,message:'Primeiro piloto limitado a 1 unidade de ÁLCOOL 70% 1L, SKU 100388, no valor exato de R$ 7,00.'},409);
  }
  const clients=await getJson('data/clients',[]);
  const client=(Array.isArray(clients)?clients:[]).find(c=>String(c.id)===String(body.client_id));
  if(!client||!validDocument(client.document))return json({ok:false,message:'Cadastro do pagador inválido.'},400);
  const reference='EVERCLEAN-PROD-PILOT-'+crypto.randomUUID();
  const initial={state:'preparando_pagador',created_at:new Date().toISOString(),total:7,
    payment_status:'aguardando_pagamento',client_id:String(client.id),sku:'100388',
    external_reference:reference};
  // Reserva atômica única para impedir criações simultâneas do mesmo piloto.
  const reserve=await getStore({name:'everclean-test',consistency:'strong'}).setJSON(
    PILOT_KEY,initial,{onlyIfNew:true}
  );
  if(!reserve?.modified){
    const current=await getJson(PILOT_KEY,null);
    return json({ok:false,pilot:safePayment(current),
      message:'Outra tentativa já reservou o piloto. Nenhuma nova cobrança foi criada.'},409);
  }
  try{
    const asaasCustomerId=await lookupCustomer(client,initial);
    await setJson(PILOT_KEY,{...initial,state:'criando_cobranca',customer_id_asaas:asaasCustomerId});
    const dueDate=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const payment=await prodApi('/payments','POST',{
      customer:asaasCustomerId,billingType:'PIX',value:7,dueDate,
      description:'Ever Clean - piloto controlado EC - Álcool 70% 1L (1 un.)',
      externalReference:reference
    });
    if(!payment?.id)throw Error('O Asaas não retornou ID da cobrança; consulte manualmente para evitar duplicidade.');
    const early=await getJson(PILOT_KEY,initial);
    const initialStatus=paid(early?.payment_status)||early?.state==='pago';
    const persisted={...initial,...early,state:initialStatus?'pago':'cobranca_criada',
      payment_id:String(payment.id),
      customer_id_asaas:asaasCustomerId,
      payment_status:initialStatus?'RECEIVED':String(payment.status||'PENDING'),
      invoice_url:typeof payment.invoiceUrl==='string'&&
        /^https:\/\/(www\.)?asaas\.com\//i.test(payment.invoiceUrl)?payment.invoiceUrl:null,
      created_at:initial.created_at,updated_at:new Date().toISOString()};
    await setJson(PILOT_KEY,persisted);
    let qr=null;
    try{qr=await prodApi('/payments/'+encodeURIComponent(payment.id)+'/pixQrCode');}
    catch(error){console.warn('Ever Clean piloto: QR pendente:',String(error.message).slice(0,100));}
    const latest=await getJson(PILOT_KEY,persisted);
    const result={...persisted,...latest,
      pix_payload:String(qr?.payload||'').slice(0,2500)||null,
      pix_image:String(qr?.encodedImage||'').slice(0,200000)||null,
      pix_expiration:qr?.expirationDate||null
    };
    await setJson(PILOT_KEY,result);
    return json({ok:true,pilot:safePayment(result),created:true,
      message:'Cobrança PIX real de R$ 7,00 criada. Nenhum pedido foi enviado ao Bling.'});
  }catch(error){
    const current=await getJson(PILOT_KEY,initial);
    await setJson(PILOT_KEY,{...current,state:'revisao_manual',
      message:'Resultado inconclusivo: '+String(error?.message||'erro').slice(0,150),
      updated_at:new Date().toISOString()});
    console.error('Ever Clean piloto produção: conferir no Asaas:',String(error?.message||'falha').slice(0,160));
    return json({ok:false,message:'Não repita a cobrança. Verifique no Asaas de produção pelo identificador externo; o piloto está travado para evitar duplicidades.'},502);
  }
}
async function refreshPilot(){
  const stored=await getJson(PILOT_KEY,null);
  if(!stored)return json({ok:false,message:'Nenhum PIX piloto real foi criado.'},404);
  try{
    let record=stored;
    let payment=null;
    if(stored.payment_id){
      payment=await prodApi('/payments/'+encodeURIComponent(stored.payment_id));
    }else if(stored.external_reference){
      const response=await prodApi('/payments?externalReference='+encodeURIComponent(stored.external_reference)+'&limit=100');
      const found=(Array.isArray(response?.data)?response.data:[]).filter(p=>p.externalReference===stored.external_reference);
      if(found.length===1)payment=found[0];
      if(found.length>1)throw Error('Mais de uma cobrança para o mesmo identificador: conferir manualmente.');
    }
    if(payment?.id){
      record={...stored,payment_id:String(payment.id),
        payment_status:String(payment.status||stored.payment_status||'PENDING'),
        state:paid(payment.status)?'pago':String(payment.status)==='PENDING'?'aguardando_pagamento':'cobranca_criada',
        last_checked_at:new Date().toISOString(),
        invoice_url:typeof payment.invoiceUrl==='string'&&
          /^https:\/\/(www\.)?asaas\.com\//i.test(payment.invoiceUrl)?payment.invoiceUrl:stored.invoice_url};
      if(!record.pix_payload){
        try{
          const qr=await prodApi('/payments/'+encodeURIComponent(payment.id)+'/pixQrCode');
          record.pix_payload=String(qr?.payload||'').slice(0,2500)||null;
          record.pix_image=String(qr?.encodedImage||'').slice(0,200000)||null;
        }catch{}
      }
      await setJson(PILOT_KEY,record);
    }
    return json({ok:true,pilot:safePayment(record),
      message:payment?'Situação consultada no Asaas Produção.':'Cobrança ainda não localizada; confira manualmente antes de qualquer nova tentativa.'});
  }catch(error){
    return json({ok:false,pilot:safePayment(stored),message:String(error?.message||'Falha na consulta').slice(0,150)},502);
  }
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const gate=await requireSecureAdmin(request,legacy,context);
  if(!gate.ok)return gate.response;
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object')return json({ok:false,message:'Requisição inválida.'},400);
  try{
    if(body.action==='options')return options();
    if(body.action==='status')return pilotStatus();
    if(body.action==='preview')return preview(body);
    if(body.action==='create_pix')return createPilot(body);
    if(body.action==='refresh_pix')return refreshPilot();
    return json({ok:false,message:'Ação inválida.'},400);
  }catch(error){
    console.error('Ever Clean production pilot request:',String(error?.message||'erro').slice(0,130));
    return json({ok:false,message:'A solicitação não foi concluída. Confira o estado do piloto antes de tentar novamente.'},502);
  }
}
