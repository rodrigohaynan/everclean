import legacy from '../shared/admin-api/index.mjs';
import {json,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {isReleasedUnpaid} from '../shared/order-release.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {FULFILLMENT_STAGES,cleanNote,fulfillmentEventsFor,isStage,normalizeStage,MAX_NOTE}
  from '../shared/fulfillment.mjs';

// Acompanhamento do pedido pela equipe (somente administradores).
// Operação MANUAL: não chama Asaas, Bling, estoque ou NF-e.
//
// Cada movimentação vira um evento visível ao cliente:
// - mudança de etapa (com comentário opcional), em qualquer direção, para
//   permitir correções; tudo fica registrado no histórico;
// - comentário sem mudar de etapa (comentário obrigatório).
// Pedido precisa estar pago (ou liberado no boleto a prazo). O registro no Bling não é exigido: a entrega
// não pode ficar travada por uma pendência de integração.

const validOrder=value=>/^\d{10}$/.test(String(value||''));

export async function updateFulfillment(input,db=checkoutDb()){
  const number=String(input?.request_number||'').trim();
  const desired=String(input?.stage||'').trim();
  const expected=normalizeStage(input?.expected_stage);
  const rawNote=input?.public_note??'';
  if(!validOrder(number)||!isStage(desired)||typeof rawNote!=='string'||rawNote.trim().length>MAX_NOTE)
    return json({ok:false,message:'Dados de acompanhamento inválidos.'},400);
  const note=cleanNote(rawNote);
  const client=await db.connect();
  let inTransaction=false;
  try{
    await client.query('BEGIN');inTransaction=true;
    const {rows}=await client.query(
      'SELECT o.id,o.state,o.payment_state,o.paid_at,o.released_at,f.stage,f.public_note '+
      'FROM everclean_private.checkout_orders o '+
      'LEFT JOIN everclean_private.order_fulfillment f ON f.checkout_order_id=o.id '+
      'WHERE o.request_number=$1 FOR UPDATE OF o',[number]);
    if(rows.length!==1){
      await client.query('ROLLBACK');inTransaction=false;
      return json({ok:false,message:'Pedido não encontrado.'},404);
    }
    const order=rows[0];
    const paid=order.state==='paid'&&
      ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(order.payment_state)&&Boolean(order.paid_at);
    // Boleto a prazo liberado também pode ser separado e entregue.
    if(!paid&&!isReleasedUnpaid(order)){
      await client.query('ROLLBACK');inTransaction=false;
      return json({ok:false,message:'O acompanhamento começa depois do pagamento confirmado.'},409);
    }
    const current=normalizeStage(order.stage);
    if(current!==expected){
      await client.query('ROLLBACK');inTransaction=false;
      return json({ok:false,current_stage:current,
        message:'O pedido foi atualizado em outra sessão. Atualize a lista e tente de novo.'},409);
    }
    if(desired===current&&!note){
      await client.query('ROLLBACK');inTransaction=false;
      return json({ok:false,message:'Escreva um comentário ou escolha outra etapa.'},400);
    }
    // Clique duplo: mesma movimentação nos últimos 2 minutos não é repetida.
    const {rows:recent}=await client.query(
      'SELECT 1 FROM everclean_private.order_fulfillment_events WHERE checkout_order_id=$1 '+
      "AND new_stage=$2 AND public_note=$3 AND created_at>now()-interval '2 minutes' LIMIT 1",
      [order.id,desired,note]);
    if(recent.length){
      await client.query('ROLLBACK');inTransaction=false;
      return json({ok:true,unchanged:true,stage:desired,
        message:'Essa atualização acabou de ser registrada.'});
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
      [order.id,current,desired,note]);
    await client.query('COMMIT');inTransaction=false;
    return json({ok:true,updated:true,stage:result.rows[0].stage,
      label:FULFILLMENT_STAGES[result.rows[0].stage],
      message:desired===current?'Comentário publicado para o cliente.':
        'Etapa atualizada: '+FULFILLMENT_STAGES[desired]+'.'});
  }catch(error){
    if(inTransaction)await client.query('ROLLBACK').catch(()=>{});
    console.warn('Fulfillment update failed:',String(error?.message||'unknown').slice(0,140));
    return json({ok:false,message:'Não foi possível atualizar o pedido. Atualize a lista antes de repetir.'},502);
  }finally{client.release();}
}

export async function fulfillmentHistory(number,db=checkoutDb()){
  if(!validOrder(number))return json({ok:false,message:'Número inválido.'},400);
  const {rows}=await db.query(
    'SELECT id::text AS id FROM everclean_private.checkout_orders WHERE request_number=$1 LIMIT 2',[number]);
  if(rows.length!==1)return json({ok:false,message:'Pedido não encontrado.'},404);
  const events=(await fulfillmentEventsFor(db,[rows[0].id],100)).get(rows[0].id)||[];
  return json({ok:true,events});
}

export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  if(Number(request.headers.get('content-length')||0)>12*1024)
    return json({ok:false,message:'Solicitação muito grande.'},413);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const body=await request.json().catch(()=>null);
  if(body?.action==='update')return updateFulfillment(body);
  if(body?.action==='history')return fulfillmentHistory(String(body?.request_number||'').trim());
  return json({ok:false,message:'Ação não permitida.'},403);
}
