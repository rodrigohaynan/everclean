import test from 'node:test';
import assert from 'node:assert/strict';
import {SITE_URL,isOrderPageUrl} from '../src/lib/site.js';

test('endereço público é o domínio próprio',()=>{
  assert.equal(SITE_URL,'https://everclean.com.br');
});

test('link de pedido aceito nos dois endereços, e só neles',()=>{
  const t='a'.repeat(64);
  assert.ok(isOrderPageUrl('https://everclean.com.br/pedido-producao/'+t));
  assert.ok(isOrderPageUrl('https://evercleancatalogo.netlify.app/pedido-producao/'+t));
  assert.ok(!isOrderPageUrl('https://everclean.com.br.evil.com/pedido-producao/'+t));
  assert.ok(!isOrderPageUrl('http://everclean.com.br/pedido-producao/'+t));
  assert.ok(!isOrderPageUrl('https://everclean.com.br/pedido-producao/curto'));
});
