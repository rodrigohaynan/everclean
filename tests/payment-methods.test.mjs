import test from 'node:test';
import assert from 'node:assert/strict';
import {billingTypeFor,billingTypeMatches,changeablePaymentMethods,paymentLabel,isPaymentMethod} from '../netlify/shared/payment-methods.mjs';

test('cada forma corresponde ao tipo do Asaas',()=>{
  assert.equal(billingTypeFor('pix'),'PIX');
  assert.equal(billingTypeFor('boleto'),'BOLETO');
  assert.equal(billingTypeFor('cartao'),'CREDIT_CARD');
  assert.equal(billingTypeFor('link'),'UNDEFINED');
});

test('conferência do pagamento aceita só o tipo certo',()=>{
  assert.ok(billingTypeMatches('pix','PIX'));
  assert.ok(!billingTypeMatches('pix','CREDIT_CARD'));
  assert.ok(billingTypeMatches('cartao','CREDIT_CARD'));
  assert.ok(billingTypeMatches(undefined,'PIX'));
  // Link: o Asaas grava a forma usada depois do pagamento.
  for(const t of ['UNDEFINED','PIX','BOLETO','CREDIT_CARD'])assert.ok(billingTypeMatches('link',t));
  assert.ok(!billingTypeMatches('link','TRANSFER'));
});

test('boleto só aparece para cliente com boleto liberado',()=>{
  assert.deepEqual(changeablePaymentMethods({}),['pix','cartao','link']);
  assert.deepEqual(changeablePaymentMethods({allow_boleto:true}),['pix','boleto','cartao','link']);
});

test('rótulos e validação',()=>{
  assert.equal(paymentLabel('cartao'),'Cartão de crédito');
  assert.equal(paymentLabel('x'),'PIX');
  assert.ok(isPaymentMethod('link'));
  assert.ok(!isPaymentMethod('toString'));
});
