import { getStore } from '@netlify/blobs';
import {normalizeAddress,normalizeStateRegistration} from '../../../src/lib/address.js';
import crypto from 'node:crypto';
import v5Handler from './v5.mjs';
import {updateJson,BlobConflictError} from '../blob-update.mjs';
import {mergeProducts,mergeClients,remapOrders} from '../backup-merge.mjs';
import {updateProducts,updateClients} from '../catalog-store.mjs';
import {checkoutDb,databaseConfigured} from '../everclean-transactional-checkout.mjs';
import {mergeCatalogActivity} from '../client-activity.mjs';

const ID_MAP_KEY='data/import_id_map';

// Netlify fornece credenciais temporárias a cada invocação; não manter o cliente Blobs em cache.
const getDataStore = () => getStore({name: 'everclean-test', consistency: 'strong'});
const json=(data,status=200)=>Response.json(data,{status});
const now=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();

async function getJson(key,fallback=null){
  const value=await getDataStore().get(key,{type:'json',consistency:'strong'});
  return value===null?fallback:value;
}
async function setJson(key,value){await getDataStore().setJSON(key,value)}

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
  // Última compra/histórico: soma os pedidos pagos pelo catálogo ao histórico
  // do Bling. Sem banco ou com falha, mantém o histórico como estava.
  let clients=data.clients;
  if(databaseConfigured()){
    try{
      const {rows}=await checkoutDb().query(
        // Boleto a prazo liberado conta como compra na data da liberação.
        "SELECT customer_id,coalesce(paid_at,released_at) AS paid_at,amount_cents FROM everclean_private.checkout_orders "+
        "WHERE ((state='paid' AND paid_at IS NOT NULL) OR (state='payment_pending' AND released_at IS NOT NULL)) "+
        "AND request_number ~ '^[1-9][0-9]{0,9}$'");
      clients=mergeCatalogActivity(data.clients,rows);
    }catch(error){
      console.warn('Ever Clean admin: histórico do catálogo indisponível',String(error?.message||'').slice(0,80));
    }
  }
  return json({...data,clients,financial_summary,import_meta});
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
      // Histórico de compras vem do backup do Bling e dos pedidos do catálogo
      // (calculado na leitura): a edição do cadastro nunca o sobrescreve.
      const {last_order_at,order_count,historical_revenue,average_ticket,
        catalog_order_count,catalog_last_paid_at,...input}=body.client||{};
      const id=input.id||uuid();
      // A seleção explícita de boleto ativa condição e preferência padrão de
      // 30 dias, inclusive para cadastros antigos sem condição informada.
      const boletoEnabled=input.allow_boleto===true;
      const requestedTerms=String(input.payment_terms||'').trim();
      const termMatch=requestedTerms.match(/(?:^|\b)(\d{1,2})\s*dias?\b/i);
      const days=termMatch?Number(termMatch[1]):30;
      if(boletoEnabled&&(days<1||days>90))
        return json({ok:false,message:'Prazo do boleto deve ter entre 1 e 90 dias.'},400);
      const paymentTerms=boletoEnabled?'Boleto '+days+' dias':requestedTerms;
      const timestamp=now();
      let client,missingName=false;
      await updateClients(clients=>{
        const old=clients.find(c=>c.id===id)||{};
        client={
          ...old,
          ...input,
          id,
          // Cadastro feito pelo próprio cliente pode vir só com o nome/razão social.
          trade_name:String(input.trade_name||input.name||old.trade_name||
            input.legal_name||old.legal_name||'').trim(),
          legal_name:String(input.legal_name||old.legal_name||'').trim(),
          document:String(input.document||old.document||'').trim(),
          phone:String(input.phone||old.phone||'').trim(),
          email:String(input.email||old.email||'').trim(),
          invoice_email:String(input.invoice_email||old.invoice_email||input.email||old.email||'').trim(),
          city:String(input.city||old.city||'').trim(),
          seller_name:'Guilherme Amaral',
          allow_boleto:boletoEnabled,
          payment_methods:boletoEnabled?['pix','boleto']:['pix'],
          preferred_payment_method:boletoEnabled?'boleto':'pix',
          payment_terms:paymentTerms,
          credit_limit:Number(input.credit_limit||0),
          // Endereço completo para nota fiscal (vai para o contato do Bling).
          address:input.address!==undefined?normalizeAddress(input.address):old.address,
          state_registration:input.state_registration!==undefined?
            normalizeStateRegistration(input.state_registration):(old.state_registration||''),
          created_at:old.created_at||input.created_at||timestamp,
          updated_at:timestamp,
        };
        missingName=!client.trade_name;
        if(missingName)return undefined;
        const index=clients.findIndex(c=>c.id===id);
        if(index>=0)clients[index]=client;else clients.unshift(client);
        return clients;
      });
      if(missingName)return json({ok:false,message:'Informe o nome do cliente.'},400);
      return json({ok:true,client});
    }

    const dataset=String(body.dataset||'');
    const items=body.items;
    if(!['products','clients','orders','financial_summary'].includes(dataset))return json({ok:false,message:'Conjunto de dados inválido.'},400);

    // Importação não destrutiva: mantém IDs, cadastros manuais e configurações
    // feitas no painel. Ver netlify/shared/backup-merge.mjs.
    if(dataset==='products'){
      if(!Array.isArray(items))return json({ok:false,message:'Produtos inválidos.'},400);
      let result;
      await updateProducts(existing=>{
        result=mergeProducts(existing,items,now());
        return result.items;
      });
      await updateJson(ID_MAP_KEY,{},map=>({...map,products:result.idMap,products_at:now()}));
      await updateJson('data/import_meta',{},meta=>({...meta,source:'Bling backup',imported_at:now(),
        products:result.items.length,products_stats:result.stats}));
      return json({ok:true,count:result.items.length,...result.stats});
    }

    if(dataset==='clients'){
      if(!Array.isArray(items))return json({ok:false,message:'Clientes inválidos.'},400);
      let result;
      await updateClients(existing=>{
        result=mergeClients(existing,items,now());
        return result.items;
      });
      await updateJson(ID_MAP_KEY,{},map=>({...map,clients:result.idMap,clients_at:now()}));
      await updateJson('data/import_meta',{},meta=>({...meta,source:'Bling backup',imported_at:now(),
        clients:result.items.length,clients_stats:result.stats}));
      return json({ok:true,count:result.items.length,...result.stats});
    }

    if(dataset==='orders'){
      if(!Array.isArray(items))return json({ok:false,message:'Pedidos inválidos.'},400);
      const idMap=await getJson(ID_MAP_KEY,{});
      const historical=remapOrders(items,idMap?.products||{},idMap?.clients||{});
      let operationalCount=0;
      await updateJson('data/orders',[],existing=>{
        const operational=existing.filter(o=>!String(o.source||'').startsWith('Bling backup'));
        operationalCount=operational.length;
        return [...operational,...historical].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
      });
      await updateJson('data/import_meta',{},meta=>({...meta,source:'Bling backup',imported_at:now(),
        historical_orders:items.length,operational_orders:operationalCount}));
      return json({ok:true,count:items.length,preserved_operational:operationalCount});
    }

    if(dataset==='financial_summary'){
      if(!items||typeof items!=='object'||Array.isArray(items))return json({ok:false,message:'Resumo financeiro inválido.'},400);
      await setJson('data/financial_summary',items);
      await updateJson('data/import_meta',{},meta=>({...meta,source:'Bling backup',imported_at:now(),backup_date:items.backup_date||null}));
      return json({ok:true});
    }
  }catch(error){
    if(error instanceof BlobConflictError)return json({ok:false,message:error.message},409);
    console.error('Ever Clean import V6:',error);
    return json({ok:false,message:'Não foi possível importar os dados do backup.'},500);
  }
}
