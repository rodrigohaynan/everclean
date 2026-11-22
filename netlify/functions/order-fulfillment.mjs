import legacy from './test-api-v7.mjs';
import {json,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';

// Operação logística MANUAL, sem chamadas ao Asaas, Bling, estoque ou NF-e.
// Somente administradores autenticados podem atualizar o andamento.
export const NEXT_STAGE={
  awaiting_review:['preparing','on_hold'],
  preparing:['ready_for_delivery','on_hold'],
  ready_for_delivery:['out_for_delivery','on_hold'],
  out_for_delivery:['delivered','on_hold'],
  on_hold:['preparing'],
  delivered:[]
};
const validOrder=value=>/^\d{10}$/.test(String(value||''));
const safeNote=value=>String(value||'').trim().replace(/\s+/g,' ').slice(0,240);
const validNote=value=>typeof value==='string'&&value.trim().length<=240;
const safeRow=row=>({
  request_number:String(row.request_number),
  stage:String(row.stage||'awaiting_review'),
  public_note:String(row.public_note||''),
  updated_at:row.updated_at||null
});
export async function updateFulfillment(input){
  const number=String(input?.request_number||'').trim();
  const desired=String(input?.stage||'').trim();
  const expected=String(input?.expected_stage||'').trim();
  if(!validOrder(number)||!Object.hasOwn(NEXT_STAGE,desired)||
    !Object.hasOwn(NEXT_STAGE,expected)||!validNote(input?.public_note))
    return json({ok:false,message:'Dados de acompanhamento inválidos.'},400);
  if(input?.confirm!==true||
    input?.confirm_phrase!=='ATUALIZAR ATENDIMENTO EC-'+number)
    return json({ok:false,message:'Confirme a alteração operacional.'},403);
  const note=safeNote(input.public_note);
  const db=checkoutDb(),client=await db.connect();
  let inTransaction=false;
  try{
    await client.query('BEGIN');inTransaction=true;
    const {rows}=await client.query(
      'SELECT o.id,o.request_number,o.state,o.payment_state,o.paid_at,'+
      'e.state AS export_state,e.bling_order_id,e.origin_reference,'+
      'f.stage,f.public_note,f.updated_at '+
      'FROM everclean_private.checkout_orders o '+
      'LEFT JOIN everclean_private.bling_export_intents e ON e.checkout_order_id=o.id '+
      'LEFT JOIN everclean_private.order_fulfillment f ON f.checkout_order_id=o.id '+
      'WHERE o.request_number=$1 FOR UPDATE OF o',[number]);
    if(rows.length!==1){
      await client.query('ROLLBACK');inTransaction=false;
      return json({ok:false,message:'Pedido não encontrado ou ambíguo.'},404);
    }
    const order=rows[0];
    const paid=order.state==='paid'&&
      ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(order.payment_state)&&
      Boolean(order.paid_at);
    const exported=['sent','already_exists'].includes(order.export_state)&&
      /^\d{1,20}$/.test(String(order.bling_order_id||''))&&
      order.origin_reference==='EC-PROD-'+number;
    if(!paid||!exported){
      await client.query('ROLLBACK');inTransaction=false;
      return json({ok:false,message:'O atendimento só pode avançar após PIX confirmado e registro conciliado no Bling.'},409);
    }
    const stage=String(order.stage||'awaiting_review');
    if(stage===desired&&note===String(order.public_note||'')){
      await client.query('COMMIT');inTransaction=false;
      return json({ok:true,unchanged:true,fulfillment:safeRow(order),
        message:'Etapa já registrada. Nenhuma atualização duplicada.'});
    }
    if(stage!==expected||!NEXT_STAGE[stage]?.includes(desired)){
      await client.query('ROLLBACK');inTransaction=false;
      return json({ok:false,current_stage:stage,
        message:'Etapa alterada em outra sessão ou transição não permitida. Atualize a lista.'},409);
    }
    const result=await client.query(
      'INSERT INTO everclean_private.order_fulfillment '+
      '(checkout_order_id,stage,public_note,updated_at) VALUES($1,$2,$3,now()) '+
      'ON CONFLICT(checkout_order_id) DO UPDATE SET '+
      'stage=EXCLUDED.stage,public_note=EXCLUDED.public_note,updated_at=now() '+
      'RETURNING stage,public_note,updated_at',
      [order.id,desired,note]);
    await client.query(
      'INSERT INTO everclean_private.order_fulfillment_events '+
      '(checkout_order_id,previous_stage,new_stage,public_note) VALUES($1,$2,$3,$4)',
      [order.id,stage,desired,note]);
    await client.query('COMMIT');inTransaction=false;
    return json({ok:true,updated:true,fulfillment:{
      request_number:number,...result.rows[0]},
      message:'Etapa operacional atualizada. Estoque, Bling, Asaas e NF-e não foram alterados.'});
  }catch(error){
    if(inTransaction)await client.query('ROLLBACK').catch(()=>{});
    console.warn('Fulfillment update failed:',String(error?.message||'unknown').slice(0,140));
    return json({ok:false,message:'Não foi possível atualizar o atendimento. Consulte a situação antes de repetir.'},502);
  }finally{client.release();}
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  if(Number(request.headers.get('content-length')||0)>12*1024)
    return json({ok:false,message:'Solicitação muito grande.'},413);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const body=await request.json().catch(()=>null);
  if(body?.action==='update')return updateFulfillment(body);
  if(body?.action==='history'){
    const number=String(body?.request_number||'').trim();
    if(!validOrder(number))return json({ok:false,message:'Número inválido.'},400);
    const {rows}=await checkoutDb().query(
      'SELECT e.previous_stage,e.new_stage,e.public_note,e.created_at '+
      'FROM everclean_private.order_fulfillment_events e '+
      'JOIN everclean_private.checkout_orders o ON o.id=e.checkout_order_id '+
      'WHERE o.request_number=$1 ORDER BY e.id DESC LIMIT 25',[number]);
    return json({ok:true,events:rows});
  }
  return json({ok:false,message:'Ação não permitida.'},403);
}
