import crypto from 'node:crypto';
import legacy from './test-api-v7.mjs';
import {json,getJson,setJson,requireSecureAdmin,blingAccessToken,hash} from '../shared/everclean-bling.mjs';

const ROOT='https://api.bling.com.br/Api/v3';
const LIMIT=100;
const MAX_PAGES=8;
const normSku=(sku)=>String(sku??'').trim().toUpperCase();
const finiteNonnegative=(value)=>{
  if(value===null||value===undefined||value==='')return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?Math.round(parsed*1000)/1000:null;
};
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const snapshotKey=(token)=>'integrations/bling/product-preview/'+hash(token);
const isAvailable=(record)=>record?.stock_available===true&&Number.isFinite(record.stock);
async function api(path,access){
  const response=await fetch(ROOT+path,{
    headers:{'Accept':'application/json','Authorization':'Bearer '+access,'enable-jwt':'1'},
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok){
    const error=new Error(response.status===403?'Permissão do Bling insuficiente. Confira os escopos do aplicativo.':response.status===429?'Limite de consultas do Bling atingido. Tente novamente em alguns instantes.':'Falha na consulta ao Bling (HTTP '+response.status+').');
    error.status=response.status;
    throw error;
  }
  const payload=await response.json();
  if(!Array.isArray(payload?.data))throw new Error('O Bling retornou uma lista de produtos inválida.');
  return payload.data;
}
async function collect(access){
  const products=[];
  let truncated=false;
  for(let page=1;page<=MAX_PAGES+1;page++){
    await delay(360);
    const rows=await api('/produtos?pagina='+page+'&limite='+LIMIT+'&criterio=1',access);
    if(page>MAX_PAGES){truncated=rows.length>0;break;}
    products.push(...rows);
    if(rows.length<LIMIT)break;
  }
  return {products,truncated};
}
async function getStock(access,products){
  const ids=[...new Set(products.map(p=>String(p?.id||'')).filter(id=>/^\d+$/.test(id)))];
  const stocks=new Map();
  let warning='';
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);
    const qs=new URLSearchParams();
    batch.forEach(id=>qs.append('idsProdutos[]',id));
    await delay(360);
    let values;
    try{values=await api('/estoques/saldos?'+qs.toString(),access);}
    catch(error){
      warning=error.status===403?'A autorização atual não permite consultar saldos. Habilite a leitura de estoques no aplicativo Bling e autorize novamente.':'Não foi possível consultar o estoque. Nenhum saldo será atualizado.';
      return {stocks:new Map(),warning};
    }
    values.forEach(item=>{
      const id=String(item?.produto?.id||item?.idProduto||'');
      const virtual=finiteNonnegative(item?.saldoVirtualTotal);
      const physical=finiteNonnegative(item?.saldoFisicoTotal);
      if(id&&virtual!==null)stocks.set(id,{virtual,physical});
    });
  }
  return {stocks,warning};
}
function classify(blingRows,existing,stocks){
  const blingCount=new Map();
  const catalogCount=new Map();
  blingRows.forEach(p=>{const sku=normSku(p.codigo);if(sku)blingCount.set(sku,(blingCount.get(sku)||0)+1);});
  existing.forEach(p=>{const sku=normSku(p.sku);if(sku)catalogCount.set(sku,(catalogCount.get(sku)||0)+1);});
  const catalogIndex=new Map(existing.filter(p=>normSku(p.sku)).map(p=>[normSku(p.sku),p]));
  const report={matched:0,new:0,duplicates:0,missing_sku:0,stock_ready:0,stock_missing:0,invalid_price:0};
  const entries=blingRows.map(row=>{
    const sku=normSku(row.codigo);
    const id=String(row.id||'');
    const current=catalogIndex.get(sku);
    const duplicate=sku&&(blingCount.get(sku)>1||catalogCount.get(sku)>1);
    const stockEntry=stocks.get(id);
    const price=finiteNonnegative(row.preco);
    const stock=stockEntry?.virtual??null;
    const status=!sku?'missing_sku':duplicate?'duplicate':current?'matched':'new';
    const entry={
      bling_id:id,sku,name:String(row.descricao||row.nome||'').trim().slice(0,220),
      unit:String(row.unidade||'UN').slice(0,12),
      price,stock,physical_stock:stockEntry?.physical??null,
      stock_available:stock!==null,status,
      catalog_id:status==='matched'?String(current?.id||''):null,
      catalog_stock:status==='matched'?finiteNonnegative(current?.stock_quantity):null,
      catalog_price:status==='matched'?finiteNonnegative(current?.base_price):null,
    };
    if(status==='matched'){report.matched++;if(stock!==null)report.stock_ready++;else report.stock_missing++;}
    if(status==='new'){report.new++;if(price===null||price<=0)report.invalid_price++;}
    if(status==='duplicate')report.duplicates++;
    if(status==='missing_sku')report.missing_sku++;
    return entry;
  });
  return {entries,report};
}
async function preview(){
  const access=await blingAccessToken();
  if(!access)return json({ok:false,message:'Conecte o Bling antes de consultar os produtos.'},409);
  const existing=await getJson('data/products',[]);
  const {products,truncated}=await collect(access);
  const {stocks,warning}=await getStock(access,products);
  const {entries,report}=classify(products,existing,stocks);
  const previewToken=crypto.randomBytes(24).toString('hex');
  const createdAt=Date.now();
  await setJson(snapshotKey(previewToken),{createdAt,entries,truncated,applied_stock_at:null,applied_import_at:null});
  const sample=[
    ...entries.filter(x=>x.status==='duplicate'||x.status==='missing_sku').slice(0,8),
    ...entries.filter(x=>x.status==='matched').slice(0,20),
    ...entries.filter(x=>x.status==='new').slice(0,20)
  ].slice(0,48);
  return json({ok:true,preview_token:previewToken,checked_at:new Date(createdAt).toISOString(),
    bling_total:products.length,catalog_total:existing.length,truncated,
    stock_permission:!warning,warning,summary:report,products:sample,
    message:'Prévia concluída. Nenhum produto ou estoque foi alterado.'});
}
async function apply(body){
  const mode=String(body.mode||'');
  if(!['stock','import'].includes(mode))return json({ok:false,message:'Operação inválida.'},400);
  const token=String(body.preview_token||'');
  if(!/^[0-9a-f]{48}$/.test(token))return json({ok:false,message:'Prévia inválida.'},400);
  const key=snapshotKey(token);
  const snap=await getJson(key,null);
  if(!snap||!Array.isArray(snap.entries)||Date.now()-Number(snap.createdAt)>10*60*1000){
    return json({ok:false,message:'Prévia expirada. Consulte novamente o Bling.'},409);
  }
  if(snap.truncated)return json({ok:false,message:'A consulta não abrangeu todos os produtos do Bling. Nenhuma alteração foi realizada.'},409);
  if(snap[mode==='stock'?'applied_stock_at':'applied_import_at']){
    return json({ok:false,message:'Esta operação já foi realizada. Gere uma nova prévia para continuar.'},409);
  }
  const products=await getJson('data/products',[]);
  const count=new Map();
  products.forEach(p=>{const sku=normSku(p.sku);if(sku)count.set(sku,(count.get(sku)||0)+1);});
  const entries=snap.entries;
  const now=new Date().toISOString();
  let updated=0,created=0,skipped=0;
  const next=[...products];
  for(const entry of entries){
    if(mode==='stock'){
      if(entry.status!=='matched'||!isAvailable(entry)){skipped++;continue;}
      const sku=normSku(entry.sku);
      if(count.get(sku)!==1){skipped++;continue;}
      const index=next.findIndex(x=>x.id===entry.catalog_id&&normSku(x.sku)===sku);
      if(index<0){skipped++;continue;}
      next[index]={...next[index],bling_product_id:entry.bling_id,
        stock_quantity:entry.stock,stock_source:'bling',stock_synced_at:now};
      updated++;
    }else{
      if(entry.status!=='new'||!entry.sku||!entry.name||!entry.bling_id||
          !Number.isFinite(entry.price)||entry.price<=0||!isAvailable(entry)){
        skipped++;continue;
      }
      const sku=normSku(entry.sku);
      if(count.has(sku)||next.some(p=>String(p.bling_product_id||'')===entry.bling_id)){skipped++;continue;}
      const product={
        id:crypto.randomUUID(),bling_product_id:entry.bling_id,sku:entry.sku,
        name:entry.name,brand:'',category:'',unit:entry.unit||'UN',
        base_price:entry.price,stock_quantity:entry.stock,image_url:'',
        active:true,catalog_visible:false,catalog_show_price:true,catalog_show_stock:true,
        catalog_allow_backorder:false,featured:false,on_sale:false,
        stock_source:'bling',stock_synced_at:now,created_at:now,updated_at:now
      };
      next.push(product);count.set(sku,1);created++;
    }
  }
  if(updated||created)await setJson('data/products',next);
  const field=mode==='stock'?'applied_stock_at':'applied_import_at';
  await setJson(key,{...snap,[field]:now});
  return json({ok:true,mode,updated,created,skipped,
    message:mode==='stock'
      ?updated+' estoque(s) do catálogo atualizado(s), sem modificar os preços.'
      :created+' produto(s) importado(s) de forma oculta. Ative individualmente em Produtos.'});
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const body=await request.json().catch(()=>({}));
  try{
    if(body.action==='preview')return await preview();
    if(body.action==='apply')return await apply(body);
    return json({ok:false,message:'Ação inválida.'},400);
  }catch(error){
    console.error('Ever Clean Bling products:',String(error?.message||'Erro').slice(0,170));
    return json({ok:false,message:error?.status===403?'O Bling recusou a consulta. Verifique as permissões de produtos e estoques.':String(error?.message||'Falha ao consultar o Bling.').slice(0,160)},error?.status===403?403:502);
  }
}
