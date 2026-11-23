import {getStore} from '@netlify/blobs';
import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,setJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {inspectNeonBling} from './bling-production-order-audit.mjs';

// Apenas HOMOLOG-01. Não ativa exportação automática dos demais pedidos.
// A tentativa é reservada ANTES do POST, impedindo reenvio silencioso.
const KEY='integrations/bling/exports/homolog-01';
const RETRY_KEY='integrations/bling/exports/homolog-01-retry-once';
const ORIGIN='EC-HOMOLOG-01';
const API='https://api.bling.com.br/Api/v3';
const tidy=value=>String(value||'').slice(0,150);
const output=x=>x?{
  state:x.state,reference:x.reference,bling_order_id:x.bling_order_id||null,
  bling_order_number:x.bling_order_number||null,created_at:x.created_at,
  checked_at:x.checked_at||null,message:x.message||null
}:null;
function todayCampoGrande(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Campo_Grande',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=type=>parts.find(p=>p.type===type)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
}
let nextBlingSlot=0;
async function paceBling(){
  const delay=Math.max(0,nextBlingSlot-Date.now());
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  nextBlingSlot=Date.now()+850;
}
async function bling(path,token,method='GET',payload){
  // Sem repetição automática de POST, inclusive quando houver HTTP 429.
  await paceBling();
  const response=await fetch(API+path,{
    method,headers:{Accept:'application/json',Authorization:'Bearer '+token,'enable-jwt':'1',
      ...(method==='POST'?{'Content-Type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(payload)}:{}),
    signal:AbortSignal.timeout(16000)
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok){
    const reason=String(body?.error?.message||'HTTP '+response.status).slice(0,120);
    throw Error('Bling: '+reason);
  }
  if(!body||typeof body!=='object')throw Error('Resposta Bling inválida.');
  return body;
}
async function remoteByOrigin(token){
  const params=new URLSearchParams({pagina:'1',limite:'100'});
  params.append('numerosLojas[]',ORIGIN);
  const data=(await bling('/pedidos/vendas?'+params.toString(),token)).data;
  if(!Array.isArray(data)||data.some(o=>String(o.numeroLoja||'')!==ORIGIN))
    throw Error('Filtro de duplicidade não confiável. Envio bloqueado.');
  if(data.length>1)throw Error('Mais de um pedido com esta origem no Bling. Conferência manual obrigatória.');
  return data[0]||null;
}
async function asaasCheck(checked){
  const response=await fetch('https://api.asaas.com/v3/payments/'+
    encodeURIComponent(checked.payment_id),{
      headers:{Accept:'application/json','User-Agent':'EverCleanCatalogo/1.0',
        access_token:String(env('ASAAS_PROD_API_KEY')||'')},
      signal:AbortSignal.timeout(15000)
    });
  if(!response.ok)throw Error('Consulta de pagamento Asaas indisponível.');
  const payment=await response.json().catch(()=>null);
  if(!payment||payment.id!==checked.payment_id||
    payment.externalReference!==checked.asaas_reference||
    payment.billingType!=='PIX'||Math.round(Number(payment.value)*100)!==700||
    !['RECEIVED','CONFIRMED'].includes(String(payment.status||'')))
    throw Error('Pagamento Asaas não corresponde ao pedido liquidado, ou não está confirmado.');
}
async function status(){
  const marker=await getJson(KEY,null);
  return json({ok:true,export_record:output(marker),
    automatic_bling_export:false,automatic_stock:false,automatic_invoice:false,
    message:marker?'Existe um registro de tentativa. Não criar outro pedido.':
      'Nenhum envio executado para HOMOLOG-01.'});
}
async function send(body){
  if(body.accepted!==true||body.confirm_phrase!=='AUTORIZO ENVIAR HOMOLOG-01 AO BLING')
    return json({ok:false,message:'É necessária confirmação expressa para enviar esta venda ao Bling.'},403);
  const [existing,retry] = await Promise.all([
    getJson(KEY,null),getJson(RETRY_KEY,null)
  ]);
  const oneAuthorizedRetry=existing?.state==='retry_liberado'&&
    existing?.reference===ORIGIN&&
    existing?.manual_checked===true&&
    existing?.recovery_preflight_ok===true&&!retry;
  if(existing&&!oneAuthorizedRetry)return json({ok:false,export_record:output(existing),
    message:'Já existe tentativa de envio HOMOLOG-01. Repetição bloqueada até reconciliação e nova autorização.'},409);
  const checked=await inspectNeonBling();
  if(!checked.approved||checked.origin_reference!==ORIGIN||
    checked.request_number!=='HOMOLOG-01'||checked.neon_paid!==true||
    Number(checked.amount)!==7||checked.sku!=='100388'||checked.quantity!==1||
    !checked.contact_id||!checked.product_id||!checked.payment_id)
    return json({ok:false,issues:checked.reasons||[],
      message:'Conferência não aprovada. Nenhum pedido foi enviado.'},409);
  await asaasCheck(checked);
  const record={state:'enviando',reference:ORIGIN,payment_id:checked.payment_id,
    asaas_reference:checked.asaas_reference,created_at:new Date().toISOString(),
    attempt_no:oneAuthorizedRetry?2:1};
  // Primeira tentativa: KEY; reenvio autorizado: RETRY_KEY. Cada chave pode
  // ser criada somente uma vez, inclusive em concorrência de dois cliques.
  const slot=oneAuthorizedRetry?RETRY_KEY:KEY;
  const created=await getStore({name:'everclean-test',consistency:'strong'})
    .setJSON(slot,record,{onlyIfNew:true});
  if(!created?.modified)return json({ok:false,
    export_record:output(await getJson(slot,null)),
    message:'Outra tentativa já está registrada; não repetir para evitar duplicidade.'},409);
  // Atualizar o status visível sem remover o registro histórico.
  if(oneAuthorizedRetry)await setJson(KEY,record);
  try{
    const token=await blingAccessToken();
    if(!token)throw Error('Bling desconectado.');
    const remote=await remoteByOrigin(token);
    if(remote){
      const existingRecord={...record,state:'ja_existente',
        bling_order_id:String(remote.id||''),bling_order_number:String(remote.numero||''),
        checked_at:new Date().toISOString(),
        message:'Pedido encontrado pela referência; não foi recriado.'};
      await setJson(KEY,existingRecord);
      return json({ok:false,export_record:output(existingRecord),
        message:existingRecord.message},409);
    }
    // ÚNICO POST autorizado: pedido em aberto; não aciona endpoints de
    // baixa de estoque, lançamento financeiro ou emissão fiscal.
    const payload={
      data:todayCampoGrande(),numeroLoja:ORIGIN,
      contato:{id:Number(checked.contact_id)},
      itens:[{produto:{id:Number(checked.product_id)},quantidade:1,valor:7}],
      observacoes:'Ever Clean | HOMOLOG-01 | PIX R$ 7,00 confirmado no Asaas.',
      observacoesInternas:'Origem única '+ORIGIN+
        '. Conferir encomenda; estoque, contas e NF-e sujeitos a lançamento manual.'
    };
    const saved=await bling('/pedidos/vendas',token,'POST',payload);
    const blingId=String(saved?.data?.id||'');
    if(!/^\d+$/.test(blingId))
      throw Error('Bling não retornou ID inequívoco. Verificar antes de qualquer nova tentativa.');
    const completed={...record,state:'enviado',
      bling_order_id:blingId,bling_order_number:String(saved?.data?.numero||''),
      checked_at:new Date().toISOString(),message:'Pedido registrado no Bling sem ações fiscais ou de estoque pela integração.'};
    await setJson(KEY,completed);
    return json({ok:true,export_record:output(completed),message:completed.message});
  }catch(error){
    const failed={...record,state:'conferencia_manual',checked_at:new Date().toISOString(),
      message:'Resultado do POST pode ser inconclusivo. Conferir a origem '+ORIGIN+' no Bling.'};
    try{await setJson(KEY,failed)}catch(e){console.error('Bling export state persistence failed',tidy(e?.message))}
    console.error('Bling HOMOLOG-01:',tidy(error?.message));
    return json({ok:false,export_record:output(failed),
      message:'Envio inconclusivo. NÃO REPITA. Confira o Bling usando a referência '+ORIGIN+'.'},502);
  }
}
async function reconcile(){
  const marker=await getJson(KEY,null);
  if(!marker)return json({ok:false,message:'Nenhuma tentativa registrada. Use apenas a prévia.'},404);
  const token=await blingAccessToken();
  if(!token)return json({ok:false,message:'Bling desconectado.'},503);
  const found=await remoteByOrigin(token);
  if(found){
    const record={...marker,state:'enviado',bling_order_id:String(found.id||''),
      bling_order_number:String(found.numero||''),checked_at:new Date().toISOString(),
      message:'Pedido localizado por referência, sem criar outra venda.'};
    await setJson(KEY,record);
    return json({ok:true,export_record:output(record),message:record.message});
  }
  // Registro informativo, SEM liberar segunda tentativa.
  const checked={...marker,checked_at:new Date().toISOString(),
    last_lookup_not_found:true,
    message:'API não encontrou a referência. Confira também a lista de pedidos por cliente e data antes de liberar nova tentativa.'};
  await setJson(KEY,checked);
  return json({ok:true,not_found:true,export_record:output(checked),
    message:'Nenhum pedido localizado pela referência. O bloqueio permanece até conferência manual e validação da ausência.'});
}
async function prepareRecovery(body){
  if(body.manual_checked!==true||body.confirm_phrase!=='CONFIRMO HOMOLOG-01 AUSENTE NO BLING')
    return json({ok:false,message:'É obrigatória a conferência manual no Bling, por referência, cliente, data e produto.'},403);
  const [marker,retry]=await Promise.all([getJson(KEY,null),getJson(RETRY_KEY,null)]);
  if(!marker||marker.state!=='conferencia_manual'||marker.reference!==ORIGIN||
     marker.bling_order_id||retry)
    return json({ok:false,export_record:output(marker),
      message:'Recuperação bloqueada. O pedido já foi enviado, há nova tentativa ou o estado não permite liberar reenvio.'},409);
  // Verificação atualizada. Inspeciona o pagamento, SKU, contato e consulta
  // de pedidos por referência sem realizar nenhuma escrita no Bling.
  const checked=await inspectNeonBling();
  if(!checked.approved||checked.origin_reference!==ORIGIN||
     checked.request_number!=='HOMOLOG-01'||checked.neon_paid!==true||
     checked.existing_bling_order_id||Number(checked.amount)!==7||
     checked.sku!=='100388'||Number(checked.quantity)!==1||
     checked.payment_id!==marker.payment_id||
     checked.asaas_reference!==marker.asaas_reference)
    return json({ok:false,issues:checked.reasons||[],export_record:output(marker),
      message:'Pagamento, referência ou ausência no Bling não confirmados. Nova tentativa continua bloqueada.'},409);
  // Uma segunda consulta pelo número de loja evita confiar apenas no resultado
  // anterior. Falha de consulta NÃO libera reenvio.
  const token=await blingAccessToken();
  if(!token)throw Error('Bling desconectado.');
  const remote=await remoteByOrigin(token);
  if(remote){
    const recorded={...marker,state:'enviado',bling_order_id:String(remote.id||''),
      bling_order_number:String(remote.numero||''),checked_at:new Date().toISOString(),
      message:'Pedido já existe no Bling. Nenhuma nova tentativa será permitida.'};
    await setJson(KEY,recorded);
    return json({ok:true,found:true,export_record:output(recorded),
      message:recorded.message});
  }
  const store=getStore({name:'everclean-test',consistency:'strong'});
  const current=await store.getWithMetadata(KEY,{type:'json',consistency:'strong'});
  if(!current?.etag||current?.data?.state!=='conferencia_manual')
    return json({ok:false,message:'Estado mudou durante a conferência. Consulte novamente antes de agir.'},409);
  const recovered={...current.data,state:'retry_liberado',
    manual_checked:true,recovery_preflight_ok:true,
    recovery_reason:'API Bling HTTP 429 em 21/11/2026; ausência conferida manualmente e por referência',
    recovered_at:new Date().toISOString(),checked_at:new Date().toISOString(),
    message:'Uma única nova tentativa está preparada. Nenhum pedido foi enviado nesta conferência.'};
  const written=await store.setJSON(KEY,recovered,{onlyIfMatch:current.etag});
  if(!written?.modified)return json({ok:false,
    message:'Conflito de concorrência; nenhuma tentativa foi liberada. Atualize o status.'},409);
  return json({ok:true,retry_allowed:true,export_record:output(recovered),
    message:recovered.message});
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const body=await request.json().catch(()=>null);
  try{
    if(body?.action==='status')return await status();
    if(body?.action==='reconcile')return await reconcile();
    if(body?.action==='prepare_recovery')return await prepareRecovery(body);
    if(body?.action==='send')return await send(body);
    return json({ok:false,message:'Ação não permitida.'},403);
  }catch(error){
    console.error('Bling controlled production:',tidy(error?.message));
    return json({ok:false,message:'Não foi possível confirmar a operação. Não repetir o envio até conferir o Bling.'},502);
  }
}
