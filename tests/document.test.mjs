import test from 'node:test';
import assert from 'node:assert/strict';
import {validDocument,formatDocument,maskDocument} from '../src/lib/document.js';

test('CPF e CNPJ: dígitos verificadores',()=>{
  assert.equal(validDocument('529.982.247-25'),true);
  assert.equal(validDocument('529.982.247-26'),false);
  assert.equal(validDocument('111.111.111-11'),false);
  assert.equal(validDocument('11.222.333/0001-81'),true);
  assert.equal(validDocument('11.222.333/0001-80'),false);
  assert.equal(validDocument('123'),false);
});

test('formatação e máscara',()=>{
  assert.equal(formatDocument('52998224725'),'529.982.247-25');
  assert.equal(formatDocument('11222333000181'),'11.222.333/0001-81');
  assert.equal(maskDocument('5299822'),'529.982.2');
  assert.equal(maskDocument('52998224725'),'529.982.247-25');
  assert.equal(maskDocument('112223330001819'),'11.222.333/0001-81');
});
