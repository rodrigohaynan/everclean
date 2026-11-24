import test from 'node:test';
import assert from 'node:assert/strict';
import {addressIssues,isCompleteAddress,normalizeAddress,addressFromClient,
  normalizeStateRegistration,formatAddress,lookupCep} from '../src/lib/address.js';

const ok={cep:'79002-000',street:' Rua 14 de Julho ',number:'1500',district:'Centro',city:'Campo Grande',uf:'ms'};

test('endereço completo e normalizado',()=>{
  assert.equal(isCompleteAddress(ok),true);
  assert.deepEqual(normalizeAddress(ok),{cep:'79002000',street:'Rua 14 de Julho',number:'1500',
    complement:'',district:'Centro',city:'Campo Grande',uf:'MS'});
  assert.equal(formatAddress(ok),'Rua 14 de Julho, 1500 · Centro · Campo Grande/MS · 79002-000');
});

test('lista o que falta',()=>{
  assert.deepEqual(addressIssues({}),['CEP','rua','número','bairro','cidade','UF']);
  assert.deepEqual(addressIssues({...ok,number:'',uf:'XX'}),['número','UF']);
  assert.equal(isCompleteAddress(undefined),false);
});

test('cadastro antigo com "Cidade/UF" pré-preenche',()=>{
  const a=addressFromClient({city:'Campo Grande/MS'});
  assert.equal(a.city,'Campo Grande');assert.equal(a.uf,'MS');
});

test('inscrição estadual',()=>{
  assert.equal(normalizeStateRegistration(''),'');
  assert.equal(normalizeStateRegistration('isento'),'ISENTO');
  assert.equal(normalizeStateRegistration('28.345.678-9'),'283456789');
});

test('consulta de CEP: preenche ou falha em silêncio',async()=>{
  const fake=async()=>({ok:true,json:async()=>({logradouro:'Rua X',bairro:'Centro',localidade:'Campo Grande',uf:'MS'})});
  assert.deepEqual(await lookupCep('79002-000',fake),{street:'Rua X',district:'Centro',city:'Campo Grande',uf:'MS'});
  assert.equal(await lookupCep('79002-000',async()=>({ok:true,json:async()=>({erro:true})})),null);
  assert.equal(await lookupCep('123',fake),null);
  assert.equal(await lookupCep('79002000',async()=>{throw Error('rede')}),null);
});
