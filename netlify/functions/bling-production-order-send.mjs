import {getStore} from '@netlify/blobs';
import legacy from './test-api-v7.mjs';
import {json,getJson,setJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {inspectNeonBling} from './bling-production-order-audit.mjs';

// Apenas HOMOLOG-01. Não ativa exportação automática dos demais pedidos.
// A tentativa é reservada ANTES do POST, impedindo reenvio silencioso.
const KEY='integrations/bling/exports/homolog-01';
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
async function bling(path,token,method='GET',payload){
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
  const existing=await getJson(KEY,null);
  if(existing)return json({ok:false,export_record:output(existing),
    message:'Já existe tentativa de envio HOMOLOG-01. Não é permitido repetir o POST.'},409);
  const checked=await inspectNeonBling();
  if(!checked.approved||checked.origin_reference!==ORIGIN||
    checked.request_number!=='HOMOLOG-01'||checked.neon_paid!==true||
    Number(checked.amount)!==7||checked.sku!=='100388'||checked.quantity!==1||
    !checked.contact_id||!checked.product_id||!checked.payment_id)
    return json({ok:false,issues:checked.reasons||[],
      message:'Conferência não aprovada. Nenhum pedido foi enviado.'},409);
  await asaasCheck(checked);
  const record={state:'enviando',reference:ORIGIN,payment_id:checked.payment_id,
    asaas_reference:checked.asaas_reference,created_at:new Date().toISOString()};
  const created=await getStore({name:'everclean-test',consistency:'strong'})
    .setJSON(KEY,record,{onlyIfNew:true});
  if(!created?.modified)return json({ok:false,
    export_record:output(await getJson(KEY,null)),
    message:'Outra tentativa já está registrada; não repetir para evitar duplicidade.'},409);
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
  return json({ok:true,export_record:output(marker),
    message:'Nenhum pedido localizado pela referência. Tentativa continua bloqueada; não reenviar automaticamente.'});
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const body=await request.json().catch(()=>null);
  try{
    if(body?.action==='status')return await status();
    if(body?.action==='reconcile')return await reconcile();
    if(body?.action==='send')return await send(body);
    return json({ok:false,message:'Ação não permitida.'},403);
  }catch(error){
    console.error('Bling controlled production:',tidy(error?.message));
    return json({ok:false,message:'Não foi possível confirmar a operação. Não repetir o envio até conferir o Bling.'},502);
  }
}
