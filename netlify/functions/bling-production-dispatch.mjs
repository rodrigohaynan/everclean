import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {buildSafeBlingPreview} from '../shared/everclean-bling-payload.mjs';
import {verifyExternal} from './bling-production-payload-preview.mjs';
import {readProducts,readClients} from '../shared/catalog-store.mjs';

// Motor preparado, MAS NÃO AGENDADO E NÃO LIGADO A WEBHOOK.
// A flag privada + confirmação específica são obrigatórias. Por padrão nunca envia.
// Nenhum POST em cobrança Asaas, estoque, contas ou NF-e.
const ready=()=>String(env('EVERCLEAN_BLING_DISPATCH_ENABLE')||'')==='explicitly-authorized-v1';
// Dois bloqueios separados do envio administrativo e uma data de início obrigatória.
// Nenhum pedido anterior a essa data pode ser selecionado pela rotina automática.
export function automaticExportStart(){
  const flag=String(env('EVERCLEAN_BLING_AUTO_EXPORT_ENABLE')||'');
  const date=String(env('EVERCLEAN_BLING_AUTO_START_AT')||'');
  if(flag!=='explicitly-authorized-v1'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.\d{3})?Z$/.test(date))return null;
  const timestamp=Date.parse(date);
  return Number.isFinite(timestamp)&&timestamp>0?new Date(timestamp).toISOString():null;
}
const API='https://api.bling.com.br/Api/v3';
const validRequest=n=>/^[1-9][0-9]{0,9}$/.test(String(n||''));
const dateLocal=()=>{
  const pieces=new Intl.DateTimeFormat('en-US',{
    year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Campo_Grande'
  }).formatToParts(new Date());
  const part=name=>pieces.find(x=>x.type===name)?.value||'';
  return part('year')+'-'+part('month')+'-'+part('day');
};
const digits=value=>String(value||'').replace(/\D/g,'');
async function bling(token,path,method='GET',data){
  const res=await fetch(API+path,{
    method,headers:{Accept:'application/json',Authorization:'Bearer '+token,
      ...(method==='POST'?{'Content-Type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(data)}:{}),
    signal:AbortSignal.timeout(18000)
  });
  const answer=await res.json().catch(()=>null);
  if(!res.ok)throw Error('Bling indisponível, HTTP '+res.status+'.');
  if(!answer||typeof answer!=='object')throw Error('Resposta Bling inválida.');
  return answer;
}
async function getReference(token,origin){
  const params=new URLSearchParams({pagina:'1',limite:'100'});
  params.append('numerosLojas[]',origin);
  const data=(await bling(token,'/pedidos/vendas?'+params.toString())).data;
  if(!Array.isArray(data)||data.some(x=>String(x.numeroLoja||'')!==origin))
    throw Error('Consulta de duplicidade inconclusiva.');
  if(data.length>1)throw Error('Mais de um pedido Bling com a mesma origem.');
  return data[0]||null;
}
async function intentState(orderId,state,fields={}){
  const id=fields.id?String(fields.id):null;
  const number=fields.number?String(fields.number):null;
  const error=fields.error?String(fields.error).slice(0,220):null;
  await checkoutDb().query(
    'UPDATE everclean_private.bling_export_intents SET state=$2,bling_order_id=$3,'+
    'bling_order_number=$4,last_error=$5,resolved_at=now(),updated_at=now() '+
    "WHERE checkout_order_id=$1 AND state='sending'",
    [orderId,state,id,number,error]
  );
}
async function claimOne(order,origin){
  const client=await checkoutDb().connect();
  try{
    await client.query('BEGIN');
    const current=await client.query(
      'SELECT id,state,payment_state,payment_id,checkout_reference,amount_cents '+
      'FROM everclean_private.checkout_orders WHERE id=$1 FOR UPDATE',[order.id]);
    const row=current.rows[0];
    if(!row||row.state!=='paid'||row.payment_id!==order.payment_id||
      row.checkout_reference!==order.checkout_reference||
      Number(row.amount_cents)!==Number(order.amount_cents)||
      !['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(row.payment_state)){
      await client.query('ROLLBACK');return {claimed:false,reason:'Pagamento alterado durante a conferência.'};
    }
    const inserted=await client.query(
      "INSERT INTO everclean_private.bling_export_intents (checkout_order_id,origin_reference,state,attempt_count)"+
      " VALUES ($1,$2,'reserved',0) ON CONFLICT DO NOTHING RETURNING checkout_order_id",
      [order.id,origin]
    );
    if(inserted.rowCount!==1){
      await client.query('ROLLBACK');return {claimed:false,reason:'Já existe uma tentativa de envio para esta referência.'};
    }
    const updated=await client.query(
      "UPDATE everclean_private.bling_export_intents SET state='sending',"+
      'attempt_count=1,attempted_at=now(),updated_at=now() '+
      "WHERE checkout_order_id=$1 AND state='reserved' AND attempt_count=0 RETURNING checkout_order_id",
      [order.id]
    );
    if(updated.rowCount!==1){
      await client.query('ROLLBACK');return {claimed:false,reason:'Não foi possível reservar a tentativa.'};
    }
    await client.query('COMMIT');return {claimed:true};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
async function dispatch(body,{automatic=false}={}){
  const number=String(body?.request_number||'').trim();
  if(!validRequest(number))
    return json({ok:false,message:'Pedido inválido. HOMOLOG-01 nunca pode ser reenviado.'},403);
  if(automatic){
    if(!automaticExportStart())return json({ok:false,activated:false,
      message:'Rotina automática bloqueada; exige duas configurações privadas de ativação.'},403);
  }else if(!ready()||body?.accepted!==true||
    body?.confirm_phrase!=='AUTORIZO ENVIO UNICO '+number){
    return json({ok:false,activated:false,
      message:'Envio bloqueado: requer ativação privada e autorização específica deste pedido.'},403);
  }
  const [records,clients,products]=await Promise.all([
    checkoutDb().query(
      'SELECT id,request_number,customer_id,amount_cents,state,payment_state,payment_id,'+
      'checkout_reference,items,requires_stock_review,paid_at,payment_method '+
      'FROM everclean_private.checkout_orders WHERE request_number=$1 ORDER BY created_at DESC LIMIT 2',
      [number]),
    readClients(),readProducts()
  ]);
  if(records.rows.length!==1)return json({ok:false,message:'Pedido Neon não é único.'},409);
  const order=records.rows[0];
  const customer=(Array.isArray(clients)?clients:[])
    .find(x=>String(x.id)===String(order.customer_id));
  const preview=buildSafeBlingPreview(order,customer,products,{today:dateLocal()});
  if(!preview.valid)return json({ok:false,issues:preview.issues,
    message:'Cadastro, pagamento ou valores inválidos; nada enviado.'},409);
  // Sem envios repetidos de qualquer intento já criado.
  const attempt=await checkoutDb().query(
    'SELECT state,attempt_count FROM everclean_private.bling_export_intents '+
    'WHERE checkout_order_id=$1',[order.id]);
  if(attempt.rowCount)return json({ok:false,state:attempt.rows[0].state,
    message:'Existe tentativa anterior. Não repetir o POST; conferir Bling manualmente.'},409);

  // Valida diretamente Asaas, CPF/CNPJ, SKU e referência Bling.
  const inspection=await verifyExternal({order,customer,products,preview,pilot:null,exportState:null});
  if(!inspection.verified)return json({ok:false,issues:inspection.issues,
    message:'Conferência externa não aprovada. Nenhum pedido enviado.'},409);
  if(inspection.existing_bling_id)return json({ok:false,
    already_exists:true,bling_number:inspection.existing_bling_order,
    message:'Pedido já existe no Bling. Nenhuma venda criada.'},409);
  // Reserva única persistida ANTES de qualquer POST. Se a rede falhar, NÃO reenviar automaticamente.
  const claimed=await claimOne(order,preview.origin_reference);
  if(!claimed.claimed)return json({ok:false,message:claimed.reason},409);
  try{
    const token=await blingAccessToken();
    if(!token)throw Error('Bling desconectado.');
    // Última consulta após adquirir trava transacional.
    const existing=await getReference(token,preview.origin_reference);
    if(existing){
      const id=String(existing.id||'');
      if(!/^\d{1,20}$/.test(id))throw Error('ID Bling inválido na conferência.');
      await intentState(order.id,'already_exists',{
        id,number:String(existing.numero||'')
      });
      return json({ok:true,already_exists:true,bling_order_number:String(existing.numero||''),
        message:'Pedido já existente no Bling. Nenhuma venda criada.'});
    }
    // Esta é a única operação externa de criação. Proibido repetir POST
    // até mesmo após HTTP 429, perda de rede ou resposta sem ID.
    const saved=await bling(token,'/pedidos/vendas','POST',preview.payload);
    const remoteId=String(saved?.data?.id||'');
    if(!/^\d{1,20}$/.test(remoteId))throw Error('Resposta ao POST inconclusiva.');
    await intentState(order.id,'sent',{id:remoteId,number:String(saved.data.numero||'')});
    return json({ok:true,bling_order_number:String(saved.data.numero||''),
      automatic_export:false,stock_automation:false,invoice_automation:false,
      message:'Pedido registrado uma única vez. Ações financeiras, fiscais e estoque permanecem manuais.'});
  }catch(error){
    // Nunca repetir POST, inclusive 429 ou timeout. A consulta manual é obrigatória.
    try{await intentState(order.id,'inconclusive',{error:error?.message})}
    catch(e){console.error('Ever Clean export attempt reconciliation needed:',String(e?.message||'').slice(0,90));}
    return json({ok:false,manual_review:true,
      message:'Envio inconclusivo. NÃO REPITA. Verifique o Bling pela origem '+
        preview.origin_reference+'.'},502);
  }
}
// Chamado apenas pela função agendada interna. Não expõe credenciais nem
// bypass para solicitações HTTP; as duas flags privadas continuam obrigatórias.
export async function dispatchPaidAutomatically(number){
  return dispatch({request_number:String(number||'')},{automatic:true});
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const body=await request.json().catch(()=>null);
  if(body?.action==='status'){
    return json({ok:true,dispatch_active:automaticExportStart()!==null,
      manual_dispatch_enabled:ready(),
      automatic_scheduling_enabled:automaticExportStart()!==null,
      scheduled_runner_installed:true,
      webhook_dispatch_enabled:false,
      pilot_excluded:true,financial_stock_invoice_automatic:false,
      message:automaticExportStart()?'Processamento agendado habilitado por configurações privadas.':'Rotina agendada instalada, porém bloqueada. O webhook apenas concilia pagamentos.'});
  }
  if(body?.action==='dispatch')return await dispatch(body).catch(error=>{
    console.warn('Ever Clean Bling dispatch failed safely:',String(error?.message||'').slice(0,110));
    return json({ok:false,message:'Falha antes do envio. Verifique a origem no Bling; não repita.'},502);
  });
  return json({ok:false,message:'Ação não permitida.'},403);
}
