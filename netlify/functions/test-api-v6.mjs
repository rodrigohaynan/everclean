import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import v5Handler from './test-api-v5.mjs';

const store=getStore({name:'everclean-test',consistency:'strong'});
const json=(data,status=200)=>Response.json(data,{status});
const now=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();

async function getJson(key,fallback=null){
  const value=await store.get(key,{type:'json',consistency:'strong'});
  return value===null?fallback:value;
}
async function setJson(key,value){await store.setJSON(key,value)}

async function validateSession(request,context){
  const sessionRequest=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({action:'session'})});
  return v5Handler(sessionRequest,context);
}
const norm=(value)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();

async function enrichedBootstrap(request,context){
  const response=await v5Handler(request,context);
  if(!response.ok)return response;
  const data=await response.clone().json().catch(()=>null);
  if(!data?.ok)return response;
  const financial_summary=await getJson('data/financial_summary',null);
  const import_meta=await getJson('data/import_meta',null);
  return json({...data,financial_summary,import_meta});
}

export default async function handler(request,context){
  if(request.method!=='POST')return v5Handler(request,context);
  let body={};
  try{body=await request.clone().json()}catch{return v5Handler(request,context)}
  const action=String(body.action||'');

  if(action==='bootstrap')return enrichedBootstrap(request,context);
  if(!['import_dataset','save_client'].includes(action))return v5Handler(request,context);

  const sessionResponse=await validateSession(request,context);
  if(!sessionResponse.ok)return sessionResponse;

  try{
    if(action==='save_client'){
      const clients=await getJson('data/clients',[]);
      const input=body.client||{};
      const id=input.id||uuid();
      const old=clients.find(c=>c.id===id)||{};
      const client={
        ...old,
        ...input,
        id,
        trade_name:String(input.trade_name||input.name||old.trade_name||'').trim(),
        legal_name:String(input.legal_name||old.legal_name||'').trim(),
        document:String(input.document||old.document||'').trim(),
        phone:String(input.phone||old.phone||'').trim(),
        email:String(input.email||old.email||'').trim(),
        invoice_email:String(input.invoice_email||old.invoice_email||input.email||old.email||'').trim(),
        city:String(input.city||old.city||'').trim(),
        seller_name:'Guilherme Amaral',
        allow_boleto:Boolean(input.allow_boleto),
        payment_methods:Array.isArray(input.payment_methods)?input.payment_methods:(input.allow_boleto?['pix','cartao','link_pagamento','boleto']:['pix','cartao','link_pagamento']),
        preferred_payment_method:String(input.preferred_payment_method||old.preferred_payment_method||'pix'),
        payment_terms:String(input.payment_terms||old.payment_terms||'').trim(),
        credit_limit:Number(input.credit_limit||0),
        created_at:old.created_at||input.created_at||now(),
        updated_at:now(),
      };
      if(!client.trade_name)return json({ok:false,message:'Informe o nome do cliente.'},400);
      const index=clients.findIndex(c=>c.id===id);
      if(index>=0)clients[index]=client;else clients.unshift(client);
      await setJson('data/clients',clients);
      return json({ok:true,client});
    }

    const dataset=String(body.dataset||'');
    const items=body.items;
    if(!['products','clients','orders','financial_summary'].includes(dataset))return json({ok:false,message:'Conjunto de dados inválido.'},400);

    if(dataset==='products'){
      if(!Array.isArray(items))return json({ok:false,message:'Produtos inválidos.'},400);
      const existing=await getJson('data/products',[]);
      const bySku=new Map(existing.filter(p=>p.sku).map(p=>[String(p.sku).trim(),p]));
      const byName=new Map(existing.filter(p=>p.name).map(p=>[norm(p.name),p]));
      const merged=items.map(input=>{
        const old=bySku.get(String(input.sku||'').trim())||byName.get(norm(input.name))||{};
        return {
          ...input,
          image_url:String(input.image_url||old.image_url||''),
          featured:Boolean(input.featured||old.featured),
          on_sale:Boolean(input.on_sale||old.on_sale),
          created_at:old.created_at||input.created_at||now(),
          updated_at:now(),
        };
      });
      await setJson('data/products',merged);
      await setJson('data/import_meta',{source:'Bling backup',imported_at:now(),products:merged.length});
      return json({ok:true,count:merged.length});
    }

    if(dataset==='clients'){
      if(!Array.isArray(items))return json({ok:false,message:'Clientes inválidos.'},400);
      const existing=await getJson('data/clients',[]);
      const byDoc=new Map(existing.filter(c=>c.document).map(c=>[String(c.document).replace(/\D/g,''),c]));
      const byName=new Map(existing.filter(c=>c.trade_name).map(c=>[norm(c.trade_name),c]));
      const merged=items.map(input=>{
        const old=byDoc.get(String(input.document||'').replace(/\D/g,''))||byName.get(norm(input.trade_name))||{};
        return {
          ...old,
          ...input,
          phone:input.phone||old.phone||'',
          email:input.email||old.email||'',
          invoice_email:input.invoice_email||old.invoice_email||input.email||old.email||'',
          updated_at:now(),
        };
      });
      await setJson('data/clients',merged);
      const meta=await getJson('data/import_meta',{});
      await setJson('data/import_meta',{...meta,source:'Bling backup',imported_at:now(),clients:merged.length});
      return json({ok:true,count:merged.length});
    }

    if(dataset==='orders'){
      if(!Array.isArray(items))return json({ok:false,message:'Pedidos inválidos.'},400);
      const existing=await getJson('data/orders',[]);
      const operational=existing.filter(o=>!String(o.source||'').startsWith('Bling backup'));
      const merged=[...operational,...items].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
      await setJson('data/orders',merged);
      const meta=await getJson('data/import_meta',{});
      await setJson('data/import_meta',{...meta,source:'Bling backup',imported_at:now(),historical_orders:items.length,operational_orders:operational.length});
      return json({ok:true,count:items.length,preserved_operational:operational.length});
    }

    if(dataset==='financial_summary'){
      if(!items||typeof items!=='object'||Array.isArray(items))return json({ok:false,message:'Resumo financeiro inválido.'},400);
      await setJson('data/financial_summary',items);
      const meta=await getJson('data/import_meta',{});
      await setJson('data/import_meta',{...meta,source:'Bling backup',imported_at:now(),backup_date:items.backup_date||null});
      return json({ok:true});
    }
  }catch(error){
    console.error('Ever Clean import V6:',error);
    return json({ok:false,message:'Não foi possível importar os dados do backup.'},500);
  }
}
