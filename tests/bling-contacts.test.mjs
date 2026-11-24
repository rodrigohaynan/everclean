import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureBlingContact,ContactLinkError} from '../netlify/shared/bling-contacts.mjs';

// Bling falso: registra as chamadas e responde conforme o cenário.
function fakeBling({contacts=[],createId='777',createStatus=201,searchStatus=200,
  existing={id:555,nome:'Felipe',numeroDocumento:'02616267101',endereco:{geral:{},cobranca:{cep:'1'}}},putStatus=200}={}){
  const calls=[];
  const fetchImpl=async(url,init={})=>{
    const method=init.method||'GET';
    calls.push({method,url,body:init.body?JSON.parse(init.body):null});
    const reply=(status,data)=>({ok:status<300,status,json:async()=>data});
    if(method==='POST')return createStatus<300?reply(createStatus,{data:{id:createId}}):
      reply(createStatus,{error:{description:'Campo inválido'}});
    if(method==='PUT')return reply(putStatus,putStatus<300?{}:{error:{description:'CEP inválido'}});
    if(/\/contatos\/\d+$/.test(url))return reply(200,{data:existing});
    if(searchStatus!==200)return reply(searchStatus,{});
    return reply(200,{data:contacts});
  };
  return {calls,fetchImpl};
}
const saved=[];
const save=async(customer,id,doc,extra={})=>{saved.push({customer:customer.id,id,doc,...extra});};
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
  // criterio=1: sem ele o Bling só pesquisa os contatos recentes.
  assert.match(bling.calls[0].url,/numeroDocumento=02616267101&criterio=1/);
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
    numeroDocumento:'02616267101',indicadorIe:9,celular:'16981112147'});
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

const endereco={cep:'79002-000',street:'Rua 14 de Julho',number:'1500',complement:'Sala 2',
  district:'Centro',city:'Campo Grande',uf:'MS'};

test('cliente novo com endereço: contato criado já com endereço e e-mail da nota',async()=>{
  saved.length=0;
  const bling=fakeBling();
  const out=await ensureBlingContact({...novo,address:endereco,email:'f@x.com'},'tok',{...bling,save});
  const body=bling.calls.find(c=>c.method==='POST').body;
  assert.deepEqual(body.endereco,{geral:{endereco:'Rua 14 de Julho',numero:'1500',complemento:'Sala 2',
    bairro:'Centro',municipio:'Campo Grande',uf:'MS',cep:'79002000'}});
  assert.equal(body.emailNotaFiscal,'f@x.com');
  assert.equal(out.address_synced,true);
  assert.ok(saved[0].bling_address_synced);
});

test('cliente vinculado: endereço novo atualiza o contato (PUT com o cadastro inteiro)',async()=>{
  saved.length=0;
  const bling=fakeBling();
  const cliente={id:'client-555',document:'02616267101',address:endereco,state_registration:'283.456.789'};
  const out=await ensureBlingContact(cliente,'tok',{...bling,save});
  const put=bling.calls.find(c=>c.method==='PUT');
  assert.match(put.url,/\/contatos\/555$/);
  assert.equal(put.body.nome,'Felipe');                       // preserva o que já existe
  assert.deepEqual(put.body.endereco.cobranca,{cep:'1'});     // preserva outros endereços
  assert.equal(put.body.endereco.geral.municipio,'Campo Grande');
  assert.equal(put.body.indicadorIe,1);
  assert.equal(put.body.ie,'283456789');
  assert.equal(out.address_synced,true);
  // Segunda vez, sem mudança: nenhuma chamada.
  const again=fakeBling();
  await ensureBlingContact({...cliente,bling_address_synced:saved[0].bling_address_synced},'tok',{...again,save});
  assert.equal(again.calls.length,0);
});

test('Bling recusa o endereço: pedido segue, erro volta para o admin',async()=>{
  const bling=fakeBling({putStatus:400});
  const out=await ensureBlingContact({id:'client-555',document:'02616267101',address:endereco},'tok',{...bling,save});
  assert.equal(out.address_synced,false);
  assert.match(out.address_error,/CEP inválido/);
  assert.equal(out.customer.bling_contact_id,'555');
});

test('endereço incompleto não é enviado ao Bling',async()=>{
  const bling=fakeBling();
  await ensureBlingContact({id:'client-555',document:'02616267101',address:{...endereco,number:''}},'tok',{...bling,save});
  assert.equal(bling.calls.length,0);
});
