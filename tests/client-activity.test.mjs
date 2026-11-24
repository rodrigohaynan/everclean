import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCatalogActivity} from '../netlify/shared/client-activity.mjs';

const felipe={id:'f',trade_name:'Felipe'};
const rodrigo={id:'r',trade_name:'Rodrigo',last_order_at:'2024-09-25T00:00:00.000Z',order_count:2,historical_revenue:360};
const paid=[
  {customer_id:'f',paid_at:'2026-11-22T20:56:28Z',amount_cents:500},
  {customer_id:'r',paid_at:'2026-11-22T17:31:45Z',amount_cents:500},
  {customer_id:'r',paid_at:'2026-11-23T19:05:16Z',amount_cents:500},
];

test('cliente só do catálogo ganha última compra e histórico',()=>{
  const [f]=mergeCatalogActivity([felipe],paid);
  assert.equal(f.last_order_at,'2026-11-22T20:56:28.000Z');
  assert.equal(f.order_count,1);assert.equal(f.historical_revenue,5);
});

test('soma ao histórico do Bling e usa o pagamento mais recente',()=>{
  const [r]=mergeCatalogActivity([rodrigo],paid);
  assert.equal(r.last_order_at,'2026-11-23T19:05:16.000Z');
  assert.equal(r.order_count,4);assert.equal(r.historical_revenue,370);
  assert.equal(r.catalog_order_count,2);
});

test('backup novo que já traz os pedidos do catálogo: não conta duas vezes',()=>{
  // Backup importado depois: última compra no dia 23/11 (horário local), já com os 2 pedidos.
  const updated={...rodrigo,last_order_at:'2026-11-23T04:00:00.000Z',order_count:4,historical_revenue:370};
  const [r]=mergeCatalogActivity([updated],paid);
  assert.equal(r.order_count,4);assert.equal(r.historical_revenue,370);
  assert.equal(r.last_order_at,'2026-11-23T19:05:16.000Z');
});

test('sem pedidos no catálogo: cliente intacto',()=>{
  const [r]=mergeCatalogActivity([rodrigo],[]);
  assert.equal(r,rodrigo);
});
