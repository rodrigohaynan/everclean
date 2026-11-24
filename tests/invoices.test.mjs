import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceStatusFrom,readInvoiceFromBling,invoiceDocument,publicInvoice,blingDateTime} from '../netlify/shared/invoices.mjs';

const KEY='50241112345678000199550010000001231000001234';
const reply=(status,data,type='application/json')=>({ok:status<300,status,
  headers:{get:()=>type},json:async()=>data,
  arrayBuffer:async()=>typeof data==='string'?new TextEncoder().encode(data).buffer:new ArrayBuffer(0)});

test('situações do Bling',()=>{
  assert.equal(invoiceStatusFrom(5),'authorized');
  assert.equal(invoiceStatusFrom(6),'authorized');
  assert.equal(invoiceStatusFrom(2),'cancelled');
  for(const s of [4,9,11])assert.equal(invoiceStatusFrom(s),'problem');
  for(const s of [1,3,7,8,10,undefined])assert.equal(invoiceStatusFrom(s),'pending');
});

test('pedido sem nota no Bling',async()=>{
  const fetchImpl=async()=>reply(200,{data:{id:1,notaFiscal:{id:0}}});
  assert.equal((await readInvoiceFromBling('27492732171','t',{fetchImpl})).status,'none');
});

test('nota autorizada: número, série, chave e data',async()=>{
  const fetchImpl=async url=>/pedidos/.test(url)?reply(200,{data:{notaFiscal:{id:9988}}}):
    reply(200,{data:{situacao:5,numero:'000123',serie:1,chaveAcesso:KEY,dataEmissao:'2026-11-24 10:15:00'}});
  const nf=await readInvoiceFromBling('27492732171','t',{fetchImpl});
  assert.equal(nf.status,'authorized');assert.equal(nf.number,'000123');assert.equal(nf.series,'1');
  assert.equal(nf.access_key,KEY);assert.equal(nf.bling_invoice_id,'9988');
  // 10:15 em Brasília = 13:15 UTC (e 09:15 em Campo Grande).
  assert.equal(nf.issued_at,'2026-11-24T13:15:00.000Z');
});

test('autorizada sem chave válida fica pendente (cliente não vê)',async()=>{
  const fetchImpl=async url=>/pedidos/.test(url)?reply(200,{data:{notaFiscal:{id:9988}}}):
    reply(200,{data:{situacao:5,numero:'1',chaveAcesso:''}});
  assert.equal((await readInvoiceFromBling('1','t',{fetchImpl})).status,'pending');
});

test('cliente só vê nota autorizada',()=>{
  assert.equal(publicInvoice({status:'pending'}),null);
  assert.equal(publicInvoice({status:'cancelled'}),null);
  assert.deepEqual(publicInvoice({status:'authorized',number:'1',series:'1',issued_at:null,access_key:KEY}),
    {number:'1',series:'1',issued_at:null,access_key:KEY});
});

const inv={status:'authorized',number:'123',bling_invoice_id:'9988',access_key:KEY};

test('download pela rota de documento do Bling',async()=>{
  const calls=[];
  const fetchImpl=async url=>{calls.push(url);return reply(200,'%PDF-1.4 conteúdo','application/pdf');};
  const res=await invoiceDocument(inv,'pdf','t',{fetchImpl});
  assert.equal(res.headers.get('content-type'),'application/pdf');
  assert.match(res.headers.get('content-disposition'),/EverClean-NotaFiscal-123\.pdf/);
  assert.match(calls[0],/\/nfe\/documento\/\d{44}\?formato=pdf/);
});

test('sem rota de documento: usa o link da nota (só domínio do Bling)',async()=>{
  const fetchImpl=async url=>{
    if(/documento/.test(url))return reply(404,{});
    if(/\/nfe\/9988$/.test(url))return reply(200,{data:{chaveAcesso:KEY,
      linkPDF:'https://www.bling.com.br/doc.view.php?id=x&accessKey=y',xml:'<nfeProc>ok</nfeProc>'}});
    if(/bling\.com\.br\/doc/.test(url))return reply(200,'%PDF-1.7','application/pdf');
    throw Error('inesperado '+url);
  };
  assert.equal((await invoiceDocument(inv,'pdf','t',{fetchImpl})).status,200);
  const xml=await invoiceDocument(inv,'xml','t',{fetchImpl});
  assert.equal(await xml.text(),'<nfeProc>ok</nfeProc>');
});

test('link fora do Bling ou nota divergente: não entrega',async()=>{
  const evil=async url=>/documento/.test(url)?reply(404,{}):
    /\/nfe\//.test(url)?reply(200,{data:{chaveAcesso:KEY,linkPDF:'https://evil.example/x.pdf'}}):reply(200,'%PDF','application/pdf');
  await assert.rejects(invoiceDocument(inv,'pdf','t',{fetchImpl:evil}),e=>e.status===502);
  const other=async url=>/documento/.test(url)?reply(404,{}):reply(200,{data:{chaveAcesso:'1'.repeat(44)}});
  await assert.rejects(invoiceDocument(inv,'pdf','t',{fetchImpl:other}),e=>e.status===409);
  await assert.rejects(invoiceDocument({...inv,status:'pending'},'pdf','t',{fetchImpl:other}),e=>e.status===404);
});

test('horário do Bling é de Brasília',()=>{
  assert.equal(new Date(blingDateTime('2026-11-24 13:40:40')).toISOString(),'2026-11-24T16:40:40.000Z');
  assert.equal(new Date(blingDateTime('2026-11-24T13:40:40-03:00')).toISOString(),'2026-11-24T16:40:40.000Z');
  assert.equal(new Date(blingDateTime('2026-11-24T16:40:40Z')).toISOString(),'2026-11-24T16:40:40.000Z');
  assert.ok(Number.isNaN(blingDateTime('')));
});
