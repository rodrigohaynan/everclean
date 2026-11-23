import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRecords} from '../netlify/shared/catalog-store.mjs';

test('mantém registros válidos como estão',()=>{
  const items=[{id:'a',name:'A'},{id:'b'}];
  assert.deepEqual(normalizeRecords(items),items);
});

test('ID repetido recebe sufixo em vez de sumir',()=>{
  const out=normalizeRecords([{id:'x',n:1},{id:'x',n:2},{id:'x',n:3}]);
  assert.deepEqual(out.map(i=>i.id),['x','x~dup-2','x~dup-3']);
  assert.deepEqual(out.map(i=>i.n),[1,2,3]);
});

test('registro sem ID ganha ID estável',()=>{
  const a=normalizeRecords([{name:'Sem'}])[0].id;
  const b=normalizeRecords([{name:'Sem'}])[0].id;
  assert.match(a,/^sem-id-[0-9a-f]{16}$/);
  assert.equal(a,b);
});

test('ignora entradas que não são objetos e rejeita lista inválida',()=>{
  assert.deepEqual(normalizeRecords([null,1,'x',[],{id:'ok'}]).map(i=>i.id),['ok']);
  assert.throws(()=>normalizeRecords({}));
});
