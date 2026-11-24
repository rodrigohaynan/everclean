import test from 'node:test';
import assert from 'node:assert/strict';
import {isOperational,isReleasedUnpaid,operationalSql} from '../netlify/shared/order-release.mjs';
import {buildSafeBlingPreview} from '../netlify/shared/everclean-bling-payload.mjs';

test('pedido liberado: pago ou boleto a prazo em aberto', () => {
  assert.equal(isOperational({state:'paid'}), true);
  assert.equal(isOperational({state:'payment_pending', released_at:'2026-11-24T10:00:00Z'}), true);
  assert.equal(isOperational({state:'payment_pending'}), false);
  // Boleto cancelado ou estornado deixa de valer.
  assert.equal(isOperational({state:'canceled', released_at:'2026-11-24T10:00:00Z'}), false);
  assert.equal(isOperational({state:'refunded', released_at:'2026-11-24T10:00:00Z'}), false);
  assert.equal(isReleasedUnpaid({state:'paid', released_at:'2026-11-24T10:00:00Z'}), false);
  assert.match(operationalSql('o'), /o\.state='paid' OR \(o\.state='payment_pending' AND o\.released_at IS NOT NULL\)/);
});

const base = {
  request_number:'1000000016', payment_id:'pay_abc123456', payment_method:'boleto',
  checkout_reference:'EVERCLEAN-PROD-CATALOG-'+'a'.repeat(32), amount_cents:500,
  items:[{product_sku:'ESP-1', product_id:'p1', product_name:'Esponja', quantity:1, unit_price_cents:500, subtotal_cents:500}]
};
const customer = {id:'c1', bling_contact_id:'123', document:'12345678901'};
const products = [{id:'p1', sku:'ESP-1', bling_product_id:'999', name:'Esponja', price:5}];

test('Bling: boleto a prazo liberado é exportável e a observação diz que falta pagar', () => {
  const released = buildSafeBlingPreview({...base, state:'payment_pending', payment_state:'PAYMENT_CREATED',
    released_at:'2026-11-24T10:00:00Z', payment_due_date:'2026-12-23'}, customer, products, {today:'2026-11-24'});
  const pending = buildSafeBlingPreview({...base, state:'payment_pending', payment_state:'PAYMENT_CREATED'},
    customer, products, {today:'2026-11-24'});
  assert.equal(pending.valid, false);
  assert.ok(pending.issues.includes('Pagamento não conciliado completamente no Neon.'));
  assert.equal(released.valid, true, JSON.stringify(released.issues));
  assert.match(released.payload.observacoes, /Boleto a prazo com vencimento em 23\/12\/2026, aguardando pagamento\./);
  const paid = buildSafeBlingPreview({...base, state:'paid', payment_state:'PAYMENT_RECEIVED',
    paid_at:'2026-11-24T10:00:00Z'}, customer, products, {today:'2026-11-24'});
  assert.equal(paid.valid, true);
  assert.match(paid.payload.observacoes, /Boleto bancario recebido\./);
});
