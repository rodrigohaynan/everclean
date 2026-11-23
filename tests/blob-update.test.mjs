import test from 'node:test';
import assert from 'node:assert/strict';
import {updateJson,BlobConflictError} from '../netlify/shared/blob-update.mjs';

// Armazenamento em memória com ETag, igual ao comportamento do Netlify Blobs.
function fakeStore(initial={}){
  const data=new Map(Object.entries(initial).map(([k,v])=>[k,{value:structuredClone(v),etag:'1'}]));
  let counter=1;
  const api={
    hooks:{beforeWrite:null},
    async getWithMetadata(key){
      const e=data.get(key);
      return e?{data:structuredClone(e.value),etag:e.etag,metadata:{}}:null;
    },
    async setJSON(key,value,opts={}){
      if(api.hooks.beforeWrite){const h=api.hooks.beforeWrite;api.hooks.beforeWrite=null;await h();}
      const e=data.get(key);
      if(opts.onlyIfMatch&&(!e||e.etag!==opts.onlyIfMatch))return {modified:false};
      if(opts.onlyIfNew&&e)return {modified:false};
      data.set(key,{value:structuredClone(value),etag:String(++counter)});
      return {modified:true,etag:String(counter)};
    },
    read:key=>data.get(key)?.value,
  };
  return api;
}

test('grava quando não há concorrência',async()=>{
  const blobs=fakeStore({k:[1]});
  await updateJson('k',[],v=>[...v,2],{blobs});
  assert.deepEqual(blobs.read('k'),[1,2]);
});

test('não perde gravação concorrente: relê e reaplica',async()=>{
  const blobs=fakeStore({products:[{id:'a',stock:1,name:'A'}]});
  // Outra operação edita o nome entre a leitura e a gravação.
  blobs.hooks.beforeWrite=()=>blobs.setJSON('products',[{id:'a',stock:1,name:'A editado'}]);
  let calls=0;
  await updateJson('products',[],list=>{calls++;return list.map(p=>({...p,stock:9}));},{blobs});
  assert.equal(calls,2);
  assert.deepEqual(blobs.read('products'),[{id:'a',stock:9,name:'A editado'}]);
});

test('cria o documento quando não existe',async()=>{
  const blobs=fakeStore();
  await updateJson('novo',[],v=>[...v,'x'],{blobs});
  assert.deepEqual(blobs.read('novo'),['x']);
});

test('undefined não grava',async()=>{
  const blobs=fakeStore({k:[1]});
  const r=await updateJson('k',[],()=>undefined,{blobs});
  assert.equal(r.written,false);
});

test('desiste após conflitos repetidos',async()=>{
  const blobs=fakeStore({k:[1]});
  blobs.setJSON=async()=>({modified:false});
  await assert.rejects(updateJson('k',[],v=>v,{blobs,attempts:2}),BlobConflictError);
});
