import crypto from 'node:crypto';
import legacy from './test-api-v7.mjs';
import {json,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {checkoutDb,reconcilePaymentEventTx} from '../shared/everclean-transactional-checkout.mjs';
import {asaasProduction} from '../shared/everclean-live-checkout.mjs';

const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const expectedType=method=>method==='boleto'?'BOLETO':'PIX';
const validId=value=>/^pay_[a-zA-Z0-9_-]{6,100}$/.test(String(value||''));

async function loadOrder(number){
  const result=await checkoutDb().query(
    'SELECT id,request_number,checkout_reference,amount_cents,customer_id,'+
    'payment_id,payment_method,state,payment_state FROM everclean_private.checkout_orders '+
    'WHERE request_number=$1 LIMIT 2',[number]
  );
  if(result.rows.length!==1)throw fail('Pedido não localizado de forma única.',404);
  return result.rows[0];
}

async function inspectAsaas(order){
  if(!/^EVERCLEAN-PROD-CATALOG-[a-f0-9]{32}$/.test(String(order.checkout_reference||'')))
    throw fail('Referência da cobrança não é verificável. Solicite suporte técnico.',409);
  const remote=await asaasProduction(
    '/payments?externalReference='+encodeURIComponent(order.checkout_reference)+'&limit=100'
  );
  if(!Array.isArray(remote?.data)||remote.hasMore===true)
    throw fail('A consulta financeira está incompleta. Não repetir a cobrança.',409);
  const exact=remote.data.filter(p=>
    String(p?.externalReference||'')===String(order.checkout_reference)
  );
  if(exact.length>1)
    return {outcome:'multiple',can_attach:false,count:exact.length,
      message:'Mais de uma cobrança para a mesma referência. Conferência manual necessária.'};
  if(exact.length===0)
    return {outcome:'not_found',can_attach:false,count:0,
      message:'Cobrança não localizada nesta consulta. Não refaça automaticamente: confirme também no painel Asaas.'};
  const payment=exact[0];
  const matches=validId(payment.id)&&
    String(payment.billingType)===expectedType(order.payment_method)&&
    Math.round(Number(payment.value)*100)===Number(order.amount_cents);
  if(!matches) return {outcome:'mismatch',can_attach:false,count:1,
    message:'A cobrança localizada não corresponde aos valores ou à forma de pagamento. Conferência manual necessária.'};
  const status=String(payment.status||'').slice(0,40);
  const canAttach=order.state==='manual_review'&&!order.payment_id&&
    ['PENDING','OVERDUE','RECEIVED','CONFIRMED'].includes(status);
  return {outcome:'located',can_attach:canAttach,count:1,
    payment_id:payment.id,provider_status:status,
    paid:['RECEIVED','CONFIRMED'].includes(status),
    message:canAttach?
      'Cobrança existente localizada e conferida. É possível vincular ao pedido sem emitir outra cobrança.':
      'Cobrança localizada. Verifique a situação e o vínculo atual antes de qualquer alteração.'};
}

// API exclusivamente administrativa, sem POST de pagamento e sem emissão de títulos.
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const body=await request.json().catch(()=>null);
  const number=String(body?.request_number||'').trim();
  const action=String(body?.action||'');
  if(!/^[1-9]\d{0,9}$/.test(number)||!['inspect','attach_existing'].includes(action))
    return json({ok:false,message:'Pedido ou ação inválidos.'},400);
  if(action==='attach_existing'&&body?.confirmation!=='VINCULAR COBRANCA EXISTENTE')
    return json({ok:false,message:'Confirme expressamente a vinculação da cobrança existente.'},400);
  try{
    const order=await loadOrder(number);
    if(!['manual_review','payment_pending','paid'].includes(order.state))
      return json({ok:false,message:'Situação não elegível para conciliação.'},409);
    const remote=await inspectAsaas(order);
    if(action==='inspect')return json({ok:true,request_number:number,
      local_status:order.state,payment_linked:Boolean(order.payment_id),
      ...remote,read_only:true,created_new_charge:false});
    if(!remote.can_attach)
      return json({ok:false,...remote,created_new_charge:false},409);
    const db=await checkoutDb().connect();
    try{
      await db.query('BEGIN');
      const locked=await db.query(
        'SELECT id,checkout_reference,amount_cents,payment_method,state,payment_id '+
        'FROM everclean_private.checkout_orders WHERE id=$1 FOR UPDATE',
        [order.id]
      );
      const now=locked.rows[0];
      if(!now||now.state!=='manual_review'||now.payment_id||
        String(now.checkout_reference)!==String(order.checkout_reference)||
        Number(now.amount_cents)!==Number(order.amount_cents)||
        String(now.payment_method)!==String(order.payment_method))
        throw fail('Pedido alterado durante a conferência. Consulte novamente.',409);
      const updated=await db.query(
        "UPDATE everclean_private.checkout_orders SET payment_id=$2,"+
        "state='payment_pending',payment_state='PENDING',updated_at=now() "+
        "WHERE id=$1 AND state='manual_review' AND payment_id IS NULL RETURNING id",
        [now.id,remote.payment_id]
      );
      if(updated.rowCount!==1)throw fail('Não foi possível vincular a cobrança existente.',409);
      if(remote.paid){
        // Conciliação auditável do estado já confirmado pelo Asaas.
        const synthetic='evt_everclean_verified_existing_'+
          crypto.createHash('sha256').update(remote.payment_id+'|'+now.checkout_reference)
            .digest('hex').slice(0,32);
        const event=await reconcilePaymentEventTx(db,{
          id:synthetic,event:'PAYMENT_RECEIVED',
          payment:{id:remote.payment_id,externalReference:now.checkout_reference,
            value:Number(now.amount_cents)/100}
        });
        if(!event.matched||(!event.updated&&!event.duplicate))
          throw fail('Não foi possível confirmar o recebimento no pedido.',409);
      }
      await db.query('COMMIT');
      return json({ok:true,request_number:number,linked:true,
        already_paid:remote.paid,created_new_charge:false,
        message:remote.paid?
          'Cobrança existente vinculada e pagamento confirmado. Nenhum pagamento novo foi criado.':
          'Cobrança existente vinculada. O cliente pode atualizar a página para continuar o pagamento.'});
    }catch(error){
      await db.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{db.release();}
  }catch(error){
    console.warn('Ever Clean conciliacao de pagamento:',String(error?.status||'error'));
    return json({ok:false,message:String(error?.message||'Não foi possível verificar a cobrança.').slice(0,230),
      created_new_charge:false},Number(error?.status||502));
  }
}
