import test from 'node:test';
import assert from 'node:assert/strict';
import {FULFILLMENT_STAGES,normalizeStage,cleanNote,isStage} from '../netlify/shared/fulfillment.mjs';
import {FULFILLMENT_LABELS,stepIndex} from '../src/lib/fulfillment.js';

test('pedido sem registro ou legado começa em Pedido recebido',()=>{
  assert.equal(normalizeStage(null),'received');
  assert.equal(normalizeStage('awaiting_review'),'received');
  assert.equal(normalizeStage('out_for_delivery'),'out_for_delivery');
  assert.ok(!isStage('awaiting_review'));
});

test('rótulos iguais no servidor e na tela',()=>{
  assert.deepEqual(FULFILLMENT_LABELS,FULFILLMENT_STAGES);
});

test('linha do tempo: Recebido, Separado, Em rota, Entregue',()=>{
  assert.equal(stepIndex('received'),0);
  assert.equal(stepIndex('preparing'),0);
  assert.equal(stepIndex('ready_for_delivery'),1);
  assert.equal(stepIndex('out_for_delivery'),2);
  assert.equal(stepIndex('delivered'),3);
});

test('comentário é limpo e limitado a 240 caracteres',()=>{
  assert.equal(cleanNote('  Saiu\npara\tentrega  '),'Saiu para entrega');
  assert.equal(cleanNote('x'.repeat(300)).length,240);
  assert.equal(cleanNote(undefined),'');
});
