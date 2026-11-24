import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureBlingContact,ContactLinkError} from '../netlify/shared/bling-contacts.mjs';

// Bling falso: registra as chamadas e responde conforme o cenário.
function fakeBling({contacts=[],createId='777',createStatus=201,searchStatus=200}={}){
  const calls=[];
  const fetchImpl=async(url,init={})=>{
    const method=init.method||'GET';
    calls.push({method,url,body:init.body?JSON.parse(init.body):null});
    const reply=(status,data)=>({ok:status<300,status,json:async()=>data});
    if(method==='POST')return createStatus<300?reply(createStatus,{data:{id:createId}}):
      reply(createStatus,{error:{description:'Campo inválido'}});
    if(searchStatus!==200)return reply(searchStatus,{});
    return reply(200,{data:contacts});
  };
  return {calls,fetchImpl};
}
const saved=[];
const save=async(customer,id,doc)=>{saved.push({customer:customer.id,id,doc});};
const novo={id:'62ef24f6-uuid',legal_name:'Felipe Caobianco',trade_name:'Felipe Caobianco',
  document:'026.162.671-01',phone:'(16) 98111-2147',email:''};

test('cliente importado do Bling não consulta nada',async()=>{
  const bling=fakeBling();
  const out=await ensureBlingContact({id:'client-16940855968',document:'01768763160'},'tok',{...bling,save});
  assert.equal(out.action,'existing');
  assert.equal(bling.calls.length,0);
});

test('encontra o contato existente pelo CPF e grava o vínculo',async()=>{
  saved.length=0;
  const bling=fakeBling({contacts:[{id:555,numeroDocumento:'026.162.671-01'},{id:556,numeroDocumento:'111'}]});
  const out=await ensureBlingContact(novo,'tok',{...bling,save});
  assert.equal(out.action,'linked');
  assert.equal(out.customer.bling_contact_id,'555');
  assert.deepEqual(saved,[{customer:novo.id,id:'555',doc:'02616267101'}]);
  assert.ok(bling.calls.every(c=>c.method==='GET'));
});

test('sem contato no Bling: cria uma vez como pessoa física',async()=>{
  saved.length=0;
  const bling=fakeBling();
  const out=await ensureBlingContact(novo,'tok',{...bling,save});
  assert.equal(out.action,'created');
  assert.equal(out.customer.bling_contact_id,'777');
  const posts=bling.calls.filter(c=>c.method==='POST');
  assert.equal(posts.length,1);
  assert.deepEqual(posts[0].body,{nome:'Felipe Caobianco',tipo:'F',situacao:'A',
    numeroDocumento:'02616267101',celular:'16981112147'});
});

test('CNPJ vira pessoa jurídica',async()=>{
  const bling=fakeBling();
  await ensureBlingContact({...novo,document:'12.345.678/0001-90',trade_name:'Loja X'},'tok',{...bling,save});
  const body=bling.calls.find(c=>c.method==='POST').body;
  assert.equal(body.tipo,'J');
  assert.equal(body.fantasia,'Loja X');
});

test('dois contatos com o mesmo CPF: não escolhe sozinho',async()=>{
  const bling=fakeBling({contacts:[{id:1,numeroDocumento:'02616267101'},{id:2,numeroDocumento:'02616267101'}]});
  await assert.rejects(ensureBlingContact(novo,'tok',{...bling,save}),ContactLinkError);
  assert.ok(!bling.calls.some(c=>c.method==='POST'));
});

test('sem CPF/CNPJ: motivo claro e nenhuma chamada',async()=>{
  const bling=fakeBling();
  await assert.rejects(ensureBlingContact({...novo,document:''},'tok',{...bling,save}),
    e=>e instanceof ContactLinkError&&/CPF\/CNPJ/.test(e.message));
  assert.equal(bling.calls.length,0);
});

test('Bling recusa o cadastro: motivo repassado ao admin',async()=>{
  const bling=fakeBling({createStatus:400});
  await assert.rejects(ensureBlingContact(novo,'tok',{...bling,save}),
    e=>e instanceof ContactLinkError&&/Campo inválido/.test(e.message));
});

test('Bling fora do ar na busca: não cria contato',async()=>{
  const bling=fakeBling({searchStatus:503});
  await assert.rejects(ensureBlingContact(novo,'tok',{...bling,save}),/HTTP 503/);
  assert.ok(!bling.calls.some(c=>c.method==='POST'));
});
