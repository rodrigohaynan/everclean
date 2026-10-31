import { getStore } from '@netlify/blobs';
import v4Handler from './test-api-v4.mjs';

const store=getStore({name:'everclean-test',consistency:'strong'});
const json=(data,status=200)=>Response.json(data,{status});

async function getJson(key,fallback=null){
  const value=await store.get(key,{type:'json',consistency:'strong'});
  return value===null?fallback:value;
}

async function setJson(key,value){await store.setJSON(key,value)}

export default async function handler(request,context){
  if(request.method!=='POST')return v4Handler(request,context);
  let body={};
  try{body=await request.clone().json()}catch{return v4Handler(request,context)}
  if(body.action!=='delete_product')return v4Handler(request,context);

  // reaproveita a validação de sessão já existente no backend anterior
  const sessionRequest=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({action:'session'})});
  const sessionResponse=await v4Handler(sessionRequest,context);
  if(!sessionResponse.ok)return sessionResponse;

  const id=String(body.id||'');
  if(!id)return json({ok:false,message:'Produto inválido.'},400);
  try{
    const products=await getJson('data/products',[]);
    const product=products.find(p=>p.id===id);
    if(!product)return json({ok:false,message:'Produto não encontrado.'},404);
    const next=products.filter(p=>p.id!==id);
    await setJson('data/products',next);
    return json({ok:true,deleted_id:id});
  }catch(error){
    console.error('Ever Clean delete product:',error);
    return json({ok:false,message:'Não foi possível excluir o produto.'},500);
  }
}
