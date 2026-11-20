import {blingAccessToken,getJson,setJson} from './everclean-bling.mjs';

const API='https://api.bling.com.br/Api/v3';
const STATUS='integrations/bling/stock-sync-status';
const SETTINGS='integrations/bling/stock-sync-settings';
const MAX_PAGES=12;
const PAUSE=380;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sku=v=>String(v??'').trim().toUpperCase();
const number=v=>{
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);
  return Number.isFinite(n)?Math.max(0,Math.round(n*1000)/1000):null;
};
const fail=(msg,status=500)=>Object.assign(new Error(msg),{status});

async function fetchBling(path,token){
  const response=await fetch(API+path,{
    method:'GET',
    headers:{Authorization:'Bearer '+token,Accept:'application/json','enable-jwt':'1'},
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok){
    if(response.status===429)throw fail('Bling atingiu o limite de requisições; será tentado novamente no próximo ciclo.',429);
    if(response.status===401)throw fail('A autorização do Bling expirou ou foi revogada; reconecte o aplicativo.',401);
    if(response.status===403)throw fail('Sem permissão para ler produtos ou estoques no Bling.',403);
    throw fail('Bling retornou HTTP '+response.status+'.',response.status);
  }
  const json=await response.json().catch(()=>null);
  if(!Array.isArray(json?.data))throw fail('Bling retornou uma lista de dados inesperada.');
  return json.data;
}
export async function getStockSyncStatus(){
  const [status,settings]=await Promise.all([
    getJson(STATUS,null),getJson(SETTINGS,{enabled:true})
  ]);
  return {enabled:settings?.enabled!==false,interval_minutes:30,...(status||{})};
}
export async function setStockSyncEnabled(enabled){
  await setJson(SETTINGS,{enabled:enabled===true,updated_at:new Date().toISOString()});
  return getStockSyncStatus();
}

async function loadProductIndex(token){
  const byId=new Map(),skuCount=new Map();
  for(let page=1;page<=MAX_PAGES;page++){
    await sleep(PAUSE);
    const batch=await fetchBling('/produtos?pagina='+page+'&limite=100&criterio=1',token);
    for(const product of batch){
      const id=String(product?.id||'');
      const code=sku(product?.codigo);
      if(id)byId.set(id,code);
      if(code)skuCount.set(code,(skuCount.get(code)||0)+1);
    }
    if(batch.length<100)return {byId,skuCount};
  }
  throw fail('A lista de produtos do Bling excedeu o limite seguro desta rotina; sincronização não aplicada.');
}
async function readStocks(token,ids){
  const saldos=new Map();
  for(let i=0;i<ids.length;i+=100){
    const query=new URLSearchParams();
    ids.slice(i,i+100).forEach(id=>query.append('idsProdutos[]',id));
    await sleep(PAUSE);
    const batch=await fetchBling('/estoques/saldos?'+query.toString(),token);
    for(const item of batch){
      const id=String(item?.produto?.id||item?.idProduto||'');
      const value=number(item?.saldoVirtualTotal);
      if(id&&value!==null)saldos.set(id,value);
    }
  }
  return saldos;
}
export async function runBlingStockSync({source='scheduled'}={}){
  const start=Date.now();
  const last=await getJson(STATUS,{});
  const mark={...last,last_attempt_at:new Date(start).toISOString(),last_source:source};
  let scanned=0,linked=0,updated=0,changed=0,unmatched=0,missing=0;
  try{
    if(source==='scheduled'){
      const settings=await getJson(SETTINGS,{enabled:true});
      if(settings?.enabled===false)return {ok:true,skipped:true,message:'Sincronização automática pausada.'};
    }
    const productsBefore=await getJson('data/products',[]);
    const current=Array.isArray(productsBefore)?productsBefore:[];
    linked=current.filter(p=>/^\d+$/.test(String(p?.bling_product_id||''))).length;
    if(!linked){
      const done={...mark,last_result:'no_links',linked_count:0,updated_count:0,changed_count:0,skipped_count:0,last_error:null,duration_ms:Date.now()-start};
      await setJson(STATUS,done);
      return {ok:true,...done,message:'Nenhum produto está vinculado ao Bling.'};
    }
    const token=await blingAccessToken();
    if(!token)throw fail('Bling não conectado. Autorize o aplicativo.',401);
    const {byId,skuCount}=await loadProductIndex(token);
    scanned=byId.size;
    const localSkuCount=new Map(),localIdCount=new Map();
    current.forEach(p=>{
      const key=sku(p.sku),id=String(p.bling_product_id||'');
      if(key)localSkuCount.set(key,(localSkuCount.get(key)||0)+1);
      if(id)localIdCount.set(id,(localIdCount.get(id)||0)+1);
    });
    const eligible=current.filter(p=>{
      const id=String(p.bling_product_id||''),code=sku(p.sku);
      return /^\d+$/.test(id)&&code&&localSkuCount.get(code)===1&&
        localIdCount.get(id)===1&&byId.get(id)===code&&skuCount.get(code)===1;
    });
    unmatched=linked-eligible.length;
    if(!eligible.length)throw fail('Nenhum produto com vínculo Bling e SKU único validado. Estoques preservados.');
    const stocks=await readStocks(token,eligible.map(p=>String(p.bling_product_id)));
    missing=eligible.filter(p=>!stocks.has(String(p.bling_product_id))).length;
    // Não altera registros se a API não retornou nenhum saldo confiável.
    if(!stocks.size)throw fail('O Bling não retornou saldos para os produtos vinculados. Estoques preservados.');
    // Reabre o catálogo depois das chamadas externas para reduzir conflitos com edições humanas.
    const latest=await getJson('data/products',[]);
    if(!Array.isArray(latest))throw fail('Não foi possível validar o catálogo atual.');
    const newestSkuCount=new Map(),newestIdCount=new Map();
    latest.forEach(p=>{
      const code=sku(p.sku),id=String(p.bling_product_id||'');
      if(code)newestSkuCount.set(code,(newestSkuCount.get(code)||0)+1);
      if(id)newestIdCount.set(id,(newestIdCount.get(id)||0)+1);
    });
    const verifiedIds=new Set(eligible.map(p=>String(p.id)));
    const now=new Date().toISOString();
    const next=latest.map(p=>{
      const id=String(p.bling_product_id||''),code=sku(p.sku);
      const eligibleNow=verifiedIds.has(String(p.id))&&
        newestSkuCount.get(code)===1&&newestIdCount.get(id)===1&&
        byId.get(id)===code&&stocks.has(id);
      if(!eligibleNow)return p;
      updated++;
      const stock=stocks.get(id);
      if(Number(p.stock_quantity)!==stock)changed++;
      return {...p,stock_quantity:stock,stock_source:'bling',stock_synced_at:now};
    });
    if(updated)await setJson('data/products',next);
    const record={...mark,last_result:'success',last_success_at:now,
      checked_bling_products:scanned,linked_count:linked,updated_count:updated,
      changed_count:changed,skipped_count:unmatched+missing+(eligible.length-missing-updated),
      missing_stock_count:missing,last_error:null,duration_ms:Date.now()-start};
    await setJson(STATUS,record);
    console.info('Ever Clean Bling stock sync completed',{source,linked,updated,changed,missing});
    return {ok:true,...record,message:updated+' produtos com estoque conferido; '+changed+' saldos alterados.'};
  }catch(error){
    const reason=String(error?.message||'Falha desconhecida').slice(0,180);
    const record={...mark,last_result:'error',last_error:reason,
      linked_count:linked,checked_bling_products:scanned,
      duration_ms:Date.now()-start};
    try{await setJson(STATUS,record)}catch(saveError){console.error('Ever Clean stock sync status:',saveError?.message)}
    console.error('Ever Clean stock sync error',{source,reason});
    return {ok:false,...record,message:reason};
  }
}
