import { getStore } from '@netlify/blobs';
import oldHandler from './test-api-v3.mjs';

const store=getStore({name:'everclean-test',consistency:'strong'});
const json=(data,status=200)=>Response.json(data,{status});
const getJson=async(key,fallback=null)=>{const v=await store.get(key,{type:'json',consistency:'strong'});return v===null?fallback:v};

function buildSuggestions({products,orders,customerId,cartIds=[]}){
  const inCart=new Set(cartIds);
  const visible=products.filter(p=>p.active!==false&&p.catalog_visible!==false&&p.base_price!=null&&!inCart.has(p.id));
  const byId=new Map(visible.map(p=>[p.id,p]));
  const historyCount=new Map();
  const customerOrders=orders.filter(o=>o.customer_id===customerId);
  customerOrders.forEach(order=>{
    (order.items||[]).forEach(item=>{
      const id=item.product_id;
      if(id&&byId.has(id))historyCount.set(id,(historyCount.get(id)||0)+Number(item.quantity||1));
    });
  });
  const result=[];
  [...historyCount.entries()].sort((a,b)=>b[1]-a[1]).forEach(([id])=>{
    const p=byId.get(id);if(p)result.push({...p,suggestion_type:'history'});
  });
  const categories=new Set();
  customerOrders.slice(0,3).forEach(order=>(order.items||[]).forEach(item=>{const p=products.find(x=>x.id===item.product_id);if(p?.category)categories.add(p.category)}));
  visible.forEach(p=>{
    if(result.some(x=>x.id===p.id))return;
    if(categories.has(p.category))result.push({...p,suggestion_type:'similar'});
  });
  visible.forEach(p=>{
    if(result.some(x=>x.id===p.id))return;
    if(p.featured===true||p.on_sale===true||p.highlight===true||p.promotion===true)result.push({...p,suggestion_type:'featured'});
  });
  visible.forEach(p=>{
    if(result.length>=10||result.some(x=>x.id===p.id))return;
    result.push({...p,suggestion_type:'similar'});
  });
  return result.slice(0,10);
}

export default async function handler(request,context){
  if(request.method!=='POST')return oldHandler(request,context);
  let body={};try{body=await request.clone().json()}catch{return oldHandler(request,context)}
  if(String(body.action||'')!=='catalog')return oldHandler(request,context);
  try{
    const baseResponse=await oldHandler(request,context);
    const baseData=await baseResponse.clone().json().catch(()=>null);
    if(!baseData?.ok||baseData?.already)return baseResponse;
    const links=await getJson('data/links',[]),orders=await getJson('data/orders',[]),products=await getJson('data/products',[]);
    const link=links.find(x=>x.token===String(body.token||''));
    if(!link)return baseResponse;
    const customerOrders=orders.filter(o=>o.customer_id===link.customer_id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    const lastOrder=customerOrders[0]||null;
    const previousItems=(lastOrder?.items||[]).map(item=>({product_id:item.product_id,quantity:Number(item.quantity||0)})).filter(x=>x.product_id&&x.quantity>0);
    const suggestions=buildSuggestions({products,orders,customerId:link.customer_id,cartIds:[]});
    return json({...baseData,last_order:lastOrder?{order_number:lastOrder.order_number,created_at:lastOrder.created_at,total_amount:lastOrder.total_amount,items:previousItems}:null,suggestions});
  }catch(error){console.error('Ever Clean API V4:',error);return oldHandler(request,context)}
}
