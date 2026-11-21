import crypto from 'node:crypto';
import legacy from './test-api-v7.mjs';
import {requireSecureAdmin,json} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';

// Auditoria de infraestrutura futura (SEM POST no Bling / Asaas).
// Toda a escrita de teste ocorre dentro de transação com ROLLBACK obrigatório.
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const body=await request.json().catch(()=>null);
  if(body?.action!=='test_lock')return json({ok:false,message:'Somente teste transacional permitido.'},403);
  const client=await checkoutDb().connect();
  let started=false;
  let orderId=null,reference=null;
  try{
    const suffix=crypto.randomBytes(16).toString('hex');
    orderId=crypto.randomUUID();
    reference='EVERCLEAN-PROD-CATALOG-'+suffix;
    const link=crypto.createHash('sha256').update('audit-bl-export-'+suffix).digest('hex');
    const origin='EC-AUDIT-'+suffix;
    await client.query('BEGIN');started=true;
    const table=await client.query(
      "SELECT to_regclass('everclean_private.bling_export_intents') IS NOT NULL AS present");
    if(!table.rows[0]?.present)throw Error('Migração de unicidade ainda não instalada.');
    await client.query(
      'INSERT INTO everclean_private.checkout_orders '+
      '(id,link_digest,checkout_reference,request_number,customer_id,amount_cents,items,requires_stock_review) '+
      'VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
      [orderId,link,reference,'0','auditoria-temporaria',700,
        JSON.stringify([{product_sku:'TESTE',quantity:1,unit_price_cents:700,subtotal_cents:700}]),true]);
    const query='INSERT INTO everclean_private.bling_export_intents '+
      '(checkout_order_id,origin_reference) VALUES ($1,$2) '+
      'ON CONFLICT DO NOTHING RETURNING checkout_order_id';
    const first=await client.query(query,[orderId,origin]);
    const duplicate=await client.query(query,[orderId,origin]);
    const claimed=await client.query(
      "UPDATE everclean_private.bling_export_intents SET state='sending',"+
      'attempt_count=attempt_count+1,updated_at=now(),attempted_at=now() '+
      "WHERE checkout_order_id=$1 AND state='reserved' AND attempt_count=0 RETURNING checkout_order_id",
      [orderId]);
    const secondClaim=await client.query(
      "UPDATE everclean_private.bling_export_intents SET state='sending',"+
      'attempt_count=attempt_count+1 WHERE checkout_order_id=$1 '+
      "AND state='reserved' AND attempt_count=0 RETURNING checkout_order_id",
      [orderId]);
    const ok=first.rowCount===1&&duplicate.rowCount===0&&
      claimed.rowCount===1&&secondClaim.rowCount===0;
    if(!ok)throw Error('A trava de unicidade falhou.');
    await client.query('ROLLBACK');started=false;
    // Sem registros persistidos após o teste.
    const after=await client.query(
      'SELECT (SELECT count(*)::int FROM everclean_private.checkout_orders WHERE id=$1) AS orders,'+
      '(SELECT count(*)::int FROM everclean_private.bling_export_intents WHERE checkout_order_id=$1) AS attempts',[orderId]);
    if(Number(after.rows[0]?.orders)!==0||Number(after.rows[0]?.attempts)!==0)
      throw Error('A auditoria deixou registro; intervenção necessária.');
    return json({ok:true,unique_intent:true,repeated_insert_blocked:true,
      repeated_send_claim_blocked:true,rollback_confirmed:true,
      automatic_bling_export:false,stock_and_invoice_automation:false,
      message:'Trava transacional validada. Teste revertido, sem pedido ou cobrança criada.'});
  }catch(error){
    if(started)await client.query('ROLLBACK').catch(()=>{});
    console.warn('Ever Clean Bling transactional audit:',String(error?.message||'Erro').slice(0,130));
    return json({ok:false,message:'Teste transacional não concluído; envio automático continua bloqueado. '+String(error?.message||'').slice(0,100)},409);
  }finally{client.release();}
}
