import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import v4Handler from './v4.mjs';
import {updateJson,BlobConflictError} from '../blob-update.mjs';

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
  return v4Handler(sessionRequest,context);
}

export default async function handler(request,context){
  if(request.method!=='POST')return v4Handler(request,context);
  let body={};
  try{body=await request.clone().json()}catch{return v4Handler(request,context)}
  const action=String(body.action||'');
  if(action!=='delete_product'&&action!=='save_product')return v4Handler(request,context);

  const sessionResponse=await validateSession(request,context);
  if(!sessionResponse.ok)return sessionResponse;

  try{
    if(action==='delete_product'){
      const id=String(body.id||'');
      if(!id)return json({ok:false,message:'Produto inválido.'},400);
      let found=false;
      await updateJson('data/products',[],products=>{
        found=products.some(p=>p.id===id);
        return found?products.filter(p=>p.id!==id):undefined;
      });
      if(!found)return json({ok:false,message:'Produto não encontrado.'},404);
      return json({ok:true,deleted_id:id});
    }

    const input=body.product||{};
    const id=input.id||uuid();
    const parsedPrice=input.base_price===''||input.base_price==null?null:Number(input.base_price);
    if(!String(input.name||'').trim())return json({ok:false,message:'Informe o nome do produto.'},400);
    const timestamp=now();
    let product;
    // Atualização atômica: não sobrescreve estoque sincronizado ou outra edição
    // gravada entre a leitura e a gravação.
    await updateJson('data/products',[],products=>{
      const old=products.find(p=>p.id===id)||{};
      product={
        ...old,
        id,
        name:String(input.name||'').trim(),
        sku:String(input.sku||old.sku||'').trim(),
        brand:String(input.brand||'').trim(),
        category:String(input.category||'').trim(),
        unit:String(input.unit||'').trim(),
        image_url:String(input.image_url||'').trim(),
        base_price:parsedPrice,
        stock_quantity:Number(input.stock_quantity||0),
        active:input.active!==false,
        catalog_visible:input.catalog_visible!==false,
        catalog_show_price:parsedPrice!=null,
        catalog_show_stock:input.catalog_show_stock!==false,
        catalog_allow_backorder:input.catalog_allow_backorder!==false,
        featured:Boolean(input.featured),
        on_sale:Boolean(input.on_sale),
        created_at:old.created_at||timestamp,
        updated_at:timestamp,
      };
      const index=products.findIndex(p=>p.id===id);
      if(index>=0)products[index]=product;else products.unshift(product);
      return products;
    });
    return json({ok:true,product});
  }catch(error){
    if(error instanceof BlobConflictError)return json({ok:false,message:error.message},409);
    console.error('Ever Clean product V5:',error);
    return json({ok:false,message:'Não foi possível concluir a operação do produto.'},500);
  }
}
