import crypto from 'node:crypto';
import {getStore} from '@netlify/blobs';
import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,setJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {readProducts,readClients} from '../shared/catalog-store.mjs';

// Único pedido de homologação (R$ 7,00), criado exclusivamente após confirmação
// explícita do administrador. Nunca altera estoque, contas ou emite nota fiscal.
const PILOT='integrations/asaas-prod/pilot/first-payment';
const EXPORT='integrations/bling/exports/first-production-pilot';
const RETRY='integrations/bling/exports/first-production-pilot-retry';
const BLING='https://api.bling.com.br/Api/v3';
const ASAAS='https://api.asaas.com/v3';
const digits=v=>String(v||'').replace(/\D/g,'');
const sku=v=>String(v||'').trim().toUpperCase();
const cents=v=>Math.round(Number(v)*100);
const id=v=>/^\d{1,20}$/.test(String(v||''))?String(v):null;
const contactId=c=>id(c?.bling_contact_id)||id(String(c?.id||'').match(/^client-(\d+)$/)?.[1]);
const productId=p=>id(p?.bling_product_id)||id(String(p?.id||'').match(/^bling-product-(\d+)$/)?.[1]);
const output=record=>record?{
  state:record.state||'aguardando_conferencia',created_at:record.created_at||null,
  bling_order_id:record.bling_order_id||null,order_number:record.order_number||null,
  reference:record.reference||null,
  payment_id:record.payment_id||null,message:record.message||null,
  last_checked_at:record.last_checked_at||null
}:null;
const safeError=e=>String(e?.message||'Falha no provedor').slice(0,165);
async function getAsaasPayment(paymentId){
  const response=await fetch(ASAAS+'/payments/'+encodeURIComponent(paymentId),{
    headers:{Accept:'application/json','User-Agent':'EverCleanCatalogo/1.0',
      access_token:String(env('ASAAS_PROD_API_KEY')||'')},
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw Error('Consulta do pagamento Asaas falhou (HTTP '+response.status+').');
  return response.json();
}
// Bling limita a 3 requisições por segundo por conta, inclusive outros aplicativos.
// Serializar as consultas desta chamada com espaçamento de 650 ms evita estouro
// causado pelas consultas de contatos, produtos e pedidos na mesma operação.
let nextBlingSlot=0;
let pendingBling=Promise.resolve();
async function awaitBlingSlot(){
  const slot=pendingBling.then(async()=>{
    const delay=Math.max(0,nextBlingSlot-Date.now());
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    nextBlingSlot=Date.now()+650;
  });
  pendingBling=slot.catch(()=>{});
  await slot;
}
async function blingRequest(path,token,method='GET',payload=null){
  await awaitBlingSlot();
  const result=await fetch(BLING+path,{
    method,headers:{Accept:'application/json',Authorization:'Bearer '+token,'enable-jwt':'1',
      ...(method==='POST'?{'Content-Type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(payload)}:{}),
    signal:AbortSignal.timeout(13000)
  });
  const body=await result.json().catch(()=>null);
  if(!result.ok){
    const details=Array.isArray(body?.error?.fields)?body.error.fields
      .map(f=>f.message||f.error||'').join('; '):String(body?.error?.message||'');
    const message=details?details.slice(0,160):'Código HTTP '+result.status;
    throw Error('O Bling não concluiu a operação: '+message);
  }
  return body;
}
function localDate(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Campo_Grande',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=k=>parts.find(p=>p.type===k)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
}
async function listRemoteOrder(token,number){
  // Consulta pelo identificador do pedido de origem, antes de QUALQUER escrita.
  // A API v3 filtra números de loja pelo parâmetro de LISTA numerosLojas[].
  // O antigo numeroLoja era ignorado, retornando pedidos de outras origens.
  const params=new URLSearchParams({pagina:'1',limite:'100'});
  params.append('numerosLojas[]',number);
  const response=await blingRequest('/pedidos/vendas?'+params.toString(),token);
  if(!Array.isArray(response?.data))throw Error('Lista de pedidos do Bling inválida.');
  const records=response.data;
  const matching=records.filter(r=>String(r.numeroLoja||'')===number);
  if(records.some(r=>String(r.numeroLoja||'')!==number)){
    throw Error('O Bling retornou pedidos fora da referência pesquisada; filtro de duplicidade não confirmado. Envio bloqueado.');
  }
  if(matching.length>1)throw Error('Mais de um pedido no Bling com a mesma referência. Necessária conferência manual.');
  return matching[0]||null;
}
async function inspect(){
  const [pilot,marker,retry,clients,products]=await Promise.all([
    getJson(PILOT,null),getJson(EXPORT,null),getJson(RETRY,null),readClients(),readProducts()
  ]);
  const reasons=[];
  if(!pilot?.payment_id||pilot.external_reference?.startsWith('EVERCLEAN-PROD-PILOT-')!==true)
    reasons.push('Cobrança piloto de produção não identificada.');
  if(Number(pilot?.total)!==7||sku(pilot?.sku)!=='100388')
    reasons.push('Cobrança não corresponde ao piloto de R$ 7,00 e SKU 100388.');
  const retryAllowed=Boolean(marker?.state==='retry_liberado'&&!retry);
  if(marker&&!retryAllowed)reasons.push('Já existe um registro de envio ou tentativa. Não será criado outro pedido.');
  if(reasons.length)return {approved:false,reasons,export_record:output(marker),payment_status:pilot?.payment_status||null};
  const [pay,blingToken]=await Promise.all([
    getAsaasPayment(String(pilot.payment_id)),blingAccessToken()
  ]);
  if(!blingToken)throw Error('Conexão Bling indisponível.');
  if(pay.id!==pilot.payment_id||String(pay.externalReference||'')!==pilot.external_reference)
    reasons.push('O pagamento no Asaas não corresponde à referência original.');
  if(String(pay.billingType)!=='PIX'||cents(pay.value)!==700)
    reasons.push('Tipo ou valor do pagamento no Asaas divergente.');
  if(String(pay.status)!=='RECEIVED')
    reasons.push('O Asaas ainda não confirmou RECEIVED para este pagamento.');
  const client=Array.isArray(clients)?clients.find(c=>String(c.id)===String(pilot.client_id)):null;
  const localProduct=Array.isArray(products)?products.find(p=>sku(p?.sku)==='100388'):null;
  if(!client||!localProduct)reasons.push('Cliente ou produto não encontrado no catálogo.');
  const cId=contactId(client),pId=productId(localProduct);
  if(!cId||!pId)reasons.push('Contato ou produto sem vínculo identificável com o Bling.');
  if(localProduct&&cents(localProduct.base_price)!==700)reasons.push('Preço atual do produto difere do pagamento de R$ 7,00.');
  if(Array.isArray(products)&&products.filter(p=>sku(p?.sku)==='100388').length!==1)
    reasons.push('SKU 100388 duplicado no catálogo.');
  let remoteContact=null,remoteProduct=null;
  if(cId&&pId&&client&&localProduct){
    const pair=await Promise.all([
      blingRequest('/contatos/'+encodeURIComponent(cId),blingToken),
      blingRequest('/produtos/'+encodeURIComponent(pId),blingToken)
    ]);
    remoteContact=pair[0]?.data;remoteProduct=pair[1]?.data;
    if(digits(remoteContact?.numeroDocumento)!==digits(client.document))
      reasons.push('CPF/CNPJ não corresponde ao contato Bling.');
    if(sku(remoteProduct?.codigo)!=='100388')
      reasons.push('SKU não corresponde ao produto Bling.');
  }
  const reference='EVERCLEAN-PILOT-'+String(pilot.payment_id);
  const remoteOrder=await listRemoteOrder(blingToken,reference);
  if(remoteOrder)reasons.push('Pedido já existe no Bling (ID '+String(remoteOrder.id)+').');
  const sameCustomer=String(client?.trade_name||client?.legal_name||client?.name||'Cliente').slice(0,110);
  return {
    approved:reasons.length===0,reasons,
    reference,
    payment_status:String(pay.status||''),
    payment_id:String(pay.id||''),
    customer_name:sameCustomer,
    product_name:String(localProduct?.name||'ÁLCOOL 70% 1L').slice(0,110),
    sku:'100388',quantity:1,total:7,unit_price:7,
    contact_id:cId,product_id:pId,
    existing_bling_order_id:remoteOrder?.id?String(remoteOrder.id):null,
    export_record:output(marker),retry_allowed:retryAllowed,
    // Somente dados necessários à confirmação, sem documentos pessoais.
    document_ending:digits(client?.document).slice(-4)
  };
}
async function status(){
  const record=await getJson(EXPORT,null);
  const pilot=await getJson(PILOT,null);
  return json({ok:true,pilot_paid:pilot?.state==='pago'||pilot?.payment_status==='RECEIVED',
    export_record:output(record),automatic_orders:false,automatic_invoices:false,
    automatic_stock_movements:false});
}
async function preview(){
  const result=await inspect();
  return json({ok:true,...result,message:result.approved?
    'Pronto para envio controlado. Nenhum pedido foi criado no Bling.':
    'Prévia identificou pendências. Nenhum pedido foi criado.'});
}
async function send(body){
  const confirmation='AUTORIZO ENVIAR PEDIDO AO BLING';
  if(body.confirm_phrase!==confirmation||body.accepted!==true)
    return json({ok:false,message:'A autorização expressa do administrador é obrigatória.'},403);
  const checked=await inspect();
  if(!checked.approved)return json({ok:false,...checked,
    message:'O envio foi bloqueado. Confira as pendências e gere uma nova prévia.'},409);
  if(checked.total!==7||checked.sku!=='100388'||checked.quantity!==1)
    return json({ok:false,message:'Operação restrita ao piloto pago de R$ 7,00, SKU 100388.'},403);
  const attempt={state:'enviando',created_at:new Date().toISOString(),
    payment_id:checked.payment_id,reference:checked.reference,order_number:null};
  // Trava atômica: o Bling não oferece chave de idempotência nativa para POST.
  const slotKey=checked.retry_allowed?RETRY:EXPORT;
  const reservation=await getStore({name:'everclean-test',consistency:'strong'})
    .setJSON(slotKey,attempt,{onlyIfNew:true});
  if(!reservation?.modified)return json({ok:false,
    export_record:output(await getJson(EXPORT,null)),
    message:'Já existe uma tentativa de exportação. Não repetir para evitar pedido duplicado.'},409);
  try{
    const token=await blingAccessToken();
    const already=await listRemoteOrder(token,checked.reference);
    if(already){
      const record={...attempt,state:'ja_existente',
        bling_order_id:String(already.id),order_number:String(already.numero||''),
        last_checked_at:new Date().toISOString()};
      await setJson(EXPORT,record);
      return json({ok:false,export_record:output(record),
        message:'O pedido já está no Bling e não foi recriado.'},409);
    }
    const payload={
      data:localDate(),numeroLoja:checked.reference,
      contato:{id:Number(checked.contact_id)},
      itens:[{produto:{id:Number(checked.product_id)},quantidade:1,valor:7}],
      observacoes:'Ever Clean Catálogo | PILOTO PRODUÇÃO | PIX R$ 7,00 recebido no Asaas. ID: '+checked.payment_id,
      observacoesInternas:'Referência única: '+checked.reference+' | NF-e e lançamento de estoque manuais.'
    };
    // ÚNICA escrita no Bling: registrar pedido de venda. Não lançar estoque/contas/NF-e.
    const result=await blingRequest('/pedidos/vendas',token,'POST',payload);
    const idOrder=String(result?.data?.id||'');
    if(!/^\d+$/.test(idOrder))throw Error('Resposta do Bling sem ID do pedido. Confira no ERP antes de qualquer nova tentativa.');
    const record={...attempt,state:'enviado',bling_order_id:idOrder,
      order_number:String(result?.data?.numero||''),last_checked_at:new Date().toISOString()};
    await setJson(EXPORT,record);
    return json({ok:true,export_record:output(record),
      message:'Pedido do piloto registrado no Bling. Nenhum lançamento de estoque, conta ou NF-e foi executado.'});
  }catch(error){
    const saved={...attempt,state:'conferencia_manual',
      message:'Resultado incerto. Conferir manualmente no Bling pelo número de origem. '+safeError(error),
      last_checked_at:new Date().toISOString()};
    try{await setJson(EXPORT,saved)}catch(err){console.error('Ever Clean Bling pilot persistence:',safeError(err))}
    console.error('Ever Clean Bling pilot export:',safeError(error));
    return json({ok:false,export_record:output(saved),
      message:'Não repita o envio. Confira o Bling por '+checked.reference+' antes de qualquer nova tentativa.'},502);
  }
}
async function recover(body){
  if(body.confirm_phrase!=='CONFIRMO PEDIDO AUSENTE NO BLING'||body.manual_checked!==true){
    return json({ok:false,message:'Confira manualmente no Bling e informe a confirmação exigida antes de liberar uma nova tentativa.'},403);
  }
  const [marker,pilot,retry]=await Promise.all([
    getJson(EXPORT,null),getJson(PILOT,null),getJson(RETRY,null)
  ]);
  if(!marker||marker.state!=='conferencia_manual'||marker.bling_order_id||retry){
    return json({ok:false,message:'A tentativa não está elegível para recuperação segura. Nenhum pedido foi criado.'},409);
  }
  const reference='EVERCLEAN-PILOT-'+String(pilot?.payment_id||'');
  if(marker.reference!==reference||pilot?.payment_status!=='RECEIVED'||Number(pilot?.total)!==7){
    return json({ok:false,message:'Pagamento ou referência incompatível. Recuperação bloqueada.'},409);
  }
  // Verificação em tempo real antes de liberar, sem enviar nada.
  const token=await blingAccessToken();
  if(!token)throw Error('Conexão Bling indisponível.');
  const existing=await listRemoteOrder(token,reference);
  if(existing){
    const record={...marker,state:'enviado',bling_order_id:String(existing.id),
      order_number:String(existing.numero||''),last_checked_at:new Date().toISOString(),message:null};
    await setJson(EXPORT,record);
    return json({ok:true,found:true,export_record:output(record),
      message:'Pedido já encontrado no Bling e vinculado. Não foi criado outro.'});
  }
  const record={...marker,state:'retry_liberado',
    recovery_reason:'HTTP 429 confirmado nos registros do Netlify (20/11/2026, 21h35)',
    recovered_at:new Date().toISOString(),last_checked_at:new Date().toISOString(),
    message:'Consulta sem pedido encontrado. Uma nova tentativa está liberada após confirmação manual de ausência no Bling. Nenhum pedido foi criado nesta conferência.'};
  await setJson(EXPORT,record);
  return json({ok:true,retry_allowed:true,export_record:output(record),
    message:'Nova tentativa liberada. Refaça a prévia e autorize o pedido somente uma vez; não é necessário novo pagamento.'});
}
async function reconcile(){
  const existing=await getJson(EXPORT,null);
  if(!existing)return json({ok:false,message:'Nenhuma tentativa de exportação registrada.'},404);
  const token=await blingAccessToken();
  if(!token)throw Error('Bling desconectado.');
  const found=await listRemoteOrder(token,String(existing.reference||''));
  if(found){
    const record={...existing,state:'enviado',bling_order_id:String(found.id),
      order_number:String(found.numero||''),
      last_checked_at:new Date().toISOString(),message:null};
    await setJson(EXPORT,record);
    return json({ok:true,export_record:output(record),
      message:'Pedido encontrado no Bling. Registro vinculado sem criar outra venda.'});
  }
  const record={...existing,last_checked_at:new Date().toISOString(),
    message:'A API não encontrou pedido com a referência. Confira manualmente antes de qualquer ação.'};
  await setJson(EXPORT,record);
  return json({ok:true,export_record:output(record),
    message:'Nenhum pedido com essa referência retornou da API. A tentativa permanece bloqueada.'});
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object')return json({ok:false,message:'JSON inválido.'},400);
  try{
    if(body.action==='status')return await status();
    if(body.action==='preview')return await preview();
    if(body.action==='send')return await send(body);
    if(body.action==='reconcile')return await reconcile();
    if(body.action==='recover')return await recover(body);
    return json({ok:false,message:'Ação inválida.'},400);
  }catch(error){
    console.error('Ever Clean Bling pilot operation:',safeError(error));
    return json({ok:false,message:'Não foi possível confirmar a operação. Nenhum envio adicional deve ser feito: '+safeError(error)},502);
  }
}
