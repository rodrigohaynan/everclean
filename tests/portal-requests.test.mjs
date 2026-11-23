import test from 'node:test';
import assert from 'node:assert/strict';
import {requestReusable} from '../netlify/shared/portal-requests.mjs';
import {findReusableApprovedRequest} from '../src/lib/approvedRequest.js';

const future=new Date(Date.now()+86400000).toISOString();
const past=new Date(Date.now()-86400000).toISOString();

test('aprovada sem cobrança pode seguir para pagamento',()=>{
  assert.equal(requestReusable({status:'quoted'}),true);
  assert.equal(requestReusable({status:'quoted',checkout_number:'1',checkout_link_status:'prepared',checkout_link_expires_at:future}),true);
  assert.equal(requestReusable({status:'quoted',checkout_number:'1',checkout_link_status:'prepared',checkout_link_expires_at:future,checkout_payment_state:'payment_pending'}),true);
});

test('pedido pago, encerrado ou link vencido não é reaproveitado',()=>{
  // Caso real: SOL-000002, aprovada e paga.
  assert.equal(requestReusable({status:'quoted',checkout_number:'1000000004',checkout_link_status:'prepared',checkout_link_expires_at:future,checkout_payment_state:'paid'}),false);
  for(const state of ['refunded','chargeback','canceled','manual_review'])
    assert.equal(requestReusable({status:'quoted',checkout_payment_state:state}),false);
  assert.equal(requestReusable({status:'quoted',checkout_number:'1',checkout_link_status:'prepared',checkout_link_expires_at:past}),false);
  assert.equal(requestReusable({status:'quoted',checkout_number:'1',checkout_link_status:'canceled',checkout_link_expires_at:future}),false);
  assert.equal(requestReusable({status:'received'}),false);
});

test('repetir um pedido já pago não cai na solicitação antiga',()=>{
  const selected=[{id:'p1',sku:'A1',price:5}],qty={p1:1};
  const item={sku:'A1',quantity:1,unit_price_cents:500};
  const paid={id:'r1',status:'quoted',items:[item],checkout_reusable:false};
  const open={id:'r2',status:'quoted',items:[item],checkout_reusable:true};
  assert.equal(findReusableApprovedRequest([paid],selected,qty),null);
  assert.equal(findReusableApprovedRequest([paid,open],selected,qty).id,'r2');
  assert.equal(findReusableApprovedRequest([open],selected,{p1:2}),null);
  assert.equal(findReusableApprovedRequest([{...open,checkout_reusable:undefined}],selected,qty),null);
});
