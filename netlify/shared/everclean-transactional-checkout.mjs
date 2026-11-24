import crypto from 'node:crypto';
import pg from 'pg';
import {env} from './everclean-asaas.mjs';
import {normalizeStage} from './fulfillment.mjs';
import {SITE_URL} from '../../src/lib/site.js';

const {Pool}=pg;
let pool;
const validReference=value=>/^EVERCLEAN-PROD-CATALOG-[0-9a-f]{32}$/i.test(String(value||''));
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const connString=()=>String(env('EVERCLEAN_DATABASE_URL')||'').trim();
export const databaseConfigured=()=>/^postgres(?:ql)?:\/\//i.test(connString());
export function checkoutDb(){
  if(!databaseConfigured())throw Error('Banco PostgreSQL Ever Clean não configurado.');
  if(!pool)pool=new Pool({connectionString:connString(),max:3,connectionTimeoutMillis:6000,
    idleTimeoutMillis:15000,allowExitOnIdle:true});
  return pool;
}
const cents=value=>{
  const n=Math.round(Number(value)*100);
  if(!Number.isSafeInteger(n)||n<1||n>100000000)throw Error('Valor inválido.');
  return n;
};
const stateFor=event=>{
  if(['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(event))return 'paid';
  if(event==='PAYMENT_REFUNDED')return 'refunded';
  if(event==='PAYMENT_CHARGEBACK_REQUESTED')return 'chargeback';
  if(event==='PAYMENT_DELETED')return 'canceled';
  return null;
};
export async function reserveCheckoutTx(client,record){
  if(!validReference(record.reference)||!/^[a-f0-9]{64}$/i.test(record.link_digest)||
     !Number.isSafeInteger(record.amount_cents)||record.amount_cents<=0||
     !Array.isArray(record.items)||!record.items.length)throw Error('Pedido inválido.');
  const result=await client.query(
    'INSERT INTO everclean_private.checkout_orders '+
    '(id,link_digest,checkout_reference,request_number,customer_id,amount_cents,items,requires_stock_review) '+
    'VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (link_digest) DO NOTHING '+
    'RETURNING id,checkout_reference,amount_cents,state',
    [record.id,record.link_digest,record.reference,String(record.request_number),
      String(record.customer_id),record.amount_cents,JSON.stringify(record.items),
      record.requires_stock_review===true]);
  if(result.rowCount)return {created:true,record:result.rows[0]};
  const old=await client.query(
    'SELECT id,checkout_reference,amount_cents,state FROM everclean_private.checkout_orders WHERE link_digest=$1',
    [record.link_digest]);
  if(!old.rowCount)throw Error('Reserva em conflito.');
  return {created:false,record:old.rows[0]};
}
export async function linkPaymentTx(client,reference,paymentId){
  if(!validReference(reference)||!/^pay_[a-z0-9_-]{6,}$/i.test(String(paymentId||'')))
    throw Error('Pagamento inválido.');
  const result=await client.query(
    "UPDATE everclean_private.checkout_orders SET payment_id=$2,state='payment_pending',"+
    "payment_state='PENDING',updated_at=now() WHERE checkout_reference=$1 AND "+
    "payment_id IS NULL AND state IN ('reserved','creating_payment') RETURNING id",[reference,paymentId]);
  if(result.rowCount)return {linked:true,created:true};
  const existing=await client.query(
    'SELECT payment_id FROM everclean_private.checkout_orders WHERE checkout_reference=$1',[reference]);
  if(existing.rows[0]?.payment_id===paymentId)return {linked:true,created:false};
  throw Error('Pagamento já vinculado a outra cobrança ou situação incompatível.');
}
export async function reconcilePaymentEventTx(client,payload){
  const payment=payload?.payment||{},reference=String(payment.externalReference||'');
  if(!validReference(reference))return {matched:false,reason:'outside_catalog'};
  const eventName=String(payload?.event||''),eventId=String(payload?.id||'');
  const desired=stateFor(eventName);
  if(!desired)return {matched:false,reason:'untracked_event'};
  if(!eventId||eventId.length>255)throw Error('Evento sem ID válido.');
  const result=await client.query(
    'SELECT id,payment_id,amount_cents,state FROM everclean_private.checkout_orders '+
    'WHERE checkout_reference=$1 FOR UPDATE',[reference]);
  const current=result.rows[0];
  if(!current)return {matched:false,reason:'order_not_registered'};
  if(String(current.payment_id)!==String(payment.id||'')||
      Number(current.amount_cents)!==cents(payment.value))
    return {matched:false,reason:'payment_or_amount_mismatch'};
  const immutable=['refunded','chargeback','canceled'];
  const next=immutable.includes(current.state)&&desired==='paid'?current.state:desired;
  const inserted=await client.query(
    'INSERT INTO everclean_private.payment_events '+
    '(event_id,checkout_order_id,event_name,payment_id,result_state) '+
    'VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
    [eventId,current.id,eventName,payment.id,next]);
  if(!inserted.rowCount)return {matched:true,duplicate:true,updated:false,state:current.state};
  if(next!==current.state){
    await client.query(
      'UPDATE everclean_private.checkout_orders SET state=$2::varchar(32),payment_state=$3,'+
      "last_event_id=$4,updated_at=now(),paid_at=CASE WHEN $2::varchar(32)='paid' "+
      'THEN coalesce(paid_at,now()) ELSE paid_at END WHERE id=$1',
      [current.id,next,eventName,eventId]);
  }
  return {matched:true,updated:next!==current.state,duplicate:false,state:next};
}
export async function reconcileProductionDbEvent(payload){
  if(!databaseConfigured())return {matched:false,reason:'db_not_configured'};
  const client=await checkoutDb().connect();
  try{
    await client.query('BEGIN');
    const result=await reconcilePaymentEventTx(client,payload);
    await client.query('COMMIT');
    return result;
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
export async function listProductionOrders(limit=60){
  if(!databaseConfigured())return [];
  const size=Math.max(1,Math.min(100,Math.trunc(Number(limit)||60)));
  const {rows}=await checkoutDb().query(
    'SELECT o.request_number,o.customer_id,o.amount_cents,o.state,o.payment_state,'+
    'o.requires_stock_review,o.items,o.created_at,o.paid_at,o.updated_at,'+
    'o.payment_method,o.customer_notes,o.invoice_requested,o.invoice_channel,o.invoice_contact,'+
    'o.payment_id IS NOT NULL AS payment_linked,'+
    'e.state AS bling_export_state,e.bling_order_id,e.bling_order_number,'+
    'e.origin_reference AS bling_origin_reference,'+
    'f.stage AS fulfillment_stage,f.public_note AS fulfillment_note,f.updated_at AS fulfillment_updated_at,'+
    'v.status AS invoice_status,v.number AS invoice_number,v.series AS invoice_series,'+
    'v.issued_at AS invoice_issued_at,v.bling_status AS invoice_bling_status,v.checked_at AS invoice_checked_at,'+
    'v.shared_at AS invoice_shared_at,l.token AS link_token '+
    'FROM everclean_private.checkout_orders o '+
    'LEFT JOIN everclean_private.bling_export_intents e ON e.checkout_order_id=o.id '+
    'LEFT JOIN everclean_private.order_fulfillment f ON f.checkout_order_id=o.id '+
    'LEFT JOIN everclean_private.order_invoices v ON v.checkout_order_id=o.id '+
    'LEFT JOIN everclean_private.production_catalog_links l ON l.token_digest=o.link_digest '+
    'ORDER BY o.created_at DESC LIMIT $1',[size]);
  return rows.map(row=>({
    request_number:String(row.request_number),
    customer_id:String(row.customer_id),
    amount:Number(row.amount_cents)/100,
    status:row.state,
    payment_status:row.payment_state,
    payment_method:row.payment_method||'pix',
    customer_notes:String(row.customer_notes||'').slice(0,2000),
    invoice_requested:row.invoice_requested===true,
    invoice_channel:row.invoice_requested?(row.invoice_channel||null):null,
    invoice_contact:row.invoice_requested?(row.invoice_contact||null):null,
    requires_stock_review:row.requires_stock_review===true,
    fulfillment_stage:normalizeStage(row.fulfillment_stage),
    fulfillment_note:row.fulfillment_note||'',
    fulfillment_updated_at:row.fulfillment_updated_at||null,
    item_count:Array.isArray(row.items)?row.items.length:0,
    created_at:row.created_at,
    paid_at:row.paid_at,
    updated_at:row.updated_at,
    payment_linked:row.payment_linked===true,
    // Auditoria de leitura: não altera o pedido nem faz novas chamadas ao Bling.
    bling_export_state:row.bling_export_state||null,
    bling_order_id:/^\d{1,20}$/.test(String(row.bling_order_id||''))
      ?String(row.bling_order_id):null,
    bling_order_number:/^\d{1,12}$/.test(String(row.bling_order_number||''))
      ?String(row.bling_order_number):null,
    bling_export_confirmed:row.state==='paid'&&
      ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(row.payment_state)&&
      Boolean(row.paid_at)&&['sent','already_exists'].includes(row.bling_export_state)&&
      /^\d{1,20}$/.test(String(row.bling_order_id||''))&&
      row.bling_origin_reference==='EC-PROD-'+String(row.request_number),
    // Nota fiscal lida do Bling pela rotina bling-invoice-sync.
    invoice:row.invoice_status?{status:row.invoice_status,number:row.invoice_number||null,
      series:row.invoice_series||null,issued_at:row.invoice_issued_at||null,
      bling_status:row.invoice_bling_status??null,checked_at:row.invoice_checked_at||null,
      shared_at:row.invoice_shared_at||null}:null,
    // Página do pedido do cliente (para enviar a nota pelo WhatsApp).
    order_url:/^[a-f0-9]{64}$/.test(String(row.link_token||''))?
      SITE_URL+'/pedido-producao/'+row.link_token:null,
    customer_pdf_ready:row.state==='paid'&&
      ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(row.payment_state)&&
      Boolean(row.paid_at)&&Date.now()-Date.parse(row.paid_at)<=90*86400000&&
      ['sent','already_exists'].includes(row.bling_export_state)&&
      /^\d{1,20}$/.test(String(row.bling_order_id||''))&&
      row.bling_origin_reference==='EC-PROD-'+String(row.request_number)
  }));
}

export async function auditProductionDatabase(runTest=false){
  if(!databaseConfigured())return {configured:false,migrated:false,transaction_test:false,
    message:'Cadastre EVERCLEAN_DATABASE_URL no Netlify, exclusivamente para Functions.'};
  let client;
  try{client=await checkoutDb().connect();}
  catch(error){return {configured:true,migrated:false,transaction_test:false,
    message:'Não foi possível conectar ao banco: '+String(error?.message||'Erro de conexão').slice(0,125)};}
  let started=false;
  try{
    const schema=await client.query(
      "SELECT to_regclass('everclean_private.checkout_orders') IS NOT NULL AS orders,"+
      "to_regclass('everclean_private.payment_events') IS NOT NULL AS events");
    if(!schema.rows[0]?.orders||!schema.rows[0]?.events)
      return {configured:true,migrated:false,transaction_test:false,
        message:'Conexão estabelecida, mas a migração SQL do checkout ainda não foi aplicada.'};
    if(!runTest)return {configured:true,migrated:true,transaction_test:false,
      message:'Tabelas localizadas. Execute o teste transacional de segurança.'};
    await client.query('BEGIN');started=true;
    const suffix=crypto.randomBytes(16).toString('hex');
    const reference='EVERCLEAN-PROD-CATALOG-'+suffix;
    const record={id:crypto.randomUUID(),link_digest:digest(suffix),reference,
      request_number:'0',customer_id:'autoteste',amount_cents:700,
      items:[{sku:'TESTE',quantity:1,unit_price_cents:700}],requires_stock_review:true};
    const one=await reserveCheckoutTx(client,record);
    const two=await reserveCheckoutTx(client,{...record,id:crypto.randomUUID()});
    const payId='pay_everclean_test_'+suffix;
    const linked=await linkPaymentTx(client,reference,payId);
    const event={id:'evt_everclean_'+suffix,event:'PAYMENT_RECEIVED',
      payment:{id:payId,externalReference:reference,value:7}};
    const accepted=await reconcilePaymentEventTx(client,event);
    const repeated=await reconcilePaymentEventTx(client,event);
    const reversed=await reconcilePaymentEventTx(client,{...event,
      id:event.id+'_reverse',event:'PAYMENT_REFUNDED'});
    const stale=await reconcilePaymentEventTx(client,{...event,id:event.id+'_stale'});
    if(!one.created||two.created||!linked.created||!accepted.updated||
      !repeated.duplicate||!reversed.updated||stale.updated||stale.state!=='refunded')
      throw Error('Falha na proteção de unicidade ou reconciliação.');
    await client.query('ROLLBACK');started=false;
    return {configured:true,migrated:true,transaction_test:true,
      message:'Teste transacional aprovado. Todos os registros fictícios foram revertidos (ROLLBACK).'};
  }catch(error){
    if(started)await client.query('ROLLBACK').catch(()=>{});
    return {configured:true,migrated:true,transaction_test:false,
      message:'Falha no teste transacional: '+String(error?.message||'Erro').slice(0,160)};
  }finally{client.release();}
}
