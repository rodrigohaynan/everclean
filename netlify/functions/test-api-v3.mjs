import { getStore } from '@netlify/blobs';
import oldHandler from './test-api.mjs';

const store=getStore({name:'everclean-test',consistency:'strong'});
const now=()=>new Date().toISOString();
const json=(data,status=200)=>Response.json(data,{status});
const getJson=async(key,fallback=null)=>{const v=await store.get(key,{type:'json',consistency:'strong'});return v===null?fallback:v};
const setJson=(key,value)=>store.setJSON(key,value);
const methodsFor=(client)=>{const base=['pix','cartao','link_pagamento'];return client?.allow_boleto===true||client?.payment_methods?.includes?.('boleto')?[...base,'boleto']:base};

export default async function handler(request,context){
  if(request.method!=='POST')return oldHandler(request,context);
  let body={};try{body=await request.clone().json()}catch{return oldHandler(request,context)}
  const action=String(body.action||'');
  if(action!=='catalog'&&action!=='submit_order')return oldHandler(request,context);
  try{
    const links=await getJson('data/links',[]),products=await getJson('data/products',[]),clients=await getJson('data/clients',[]);
    const index=links.findIndex(x=>x.token===String(body.token||''));
    if(index<0)return json({ok:false,message:'Link inválido.'},404);
    const link=links[index],customer=clients.find(x=>x.id===link.customer_id)||{},paymentMethods=methodsFor(customer);
    if(new Date(link.expires_at).getTime()<Date.now()){link.status='expirado';links[index]=link;await setJson('data/links',links);return json({ok:false,message:'Este link expirou.'},410)}
    if(link.status==='cancelado')return json({ok:false,message:'Este link foi cancelado.'},410);

    if(action==='catalog'){
      const customerView={trade_name:customer.trade_name||link.customer_name,email:customer.email||'',phone:customer.phone||'',payment_methods:paymentMethods};
      const orders=await getJson('data/orders',[]);
      const previous=orders
        .filter(o=>o.customer_id===link.customer_id&&Array.isArray(o.items)&&o.items.length)
        .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0]||null;
      const lastOrder=previous?{order_number:previous.order_number,created_at:previous.created_at,total_amount:previous.total_amount,items:previous.items.map(i=>({product_id:i.product_id,product_sku:i.product_sku,quantity:i.quantity,product_name:i.product_name}))}:null;
      if(link.status==='enviado')return json({ok:true,link,products:[],already:true,customer:customerView,last_order:lastOrder});
      if(!link.first_opened_at)link.first_opened_at=now();if(link.status==='gerado')link.status='aberto';links[index]=link;await setJson('data/links',links);
      const visible=products.filter(p=>p.active!==false&&p.catalog_visible!==false&&p.base_price!=null).map(p=>({...p,catalog_show_price:true}));
      return json({ok:true,link:{...link,payment_methods:paymentMethods},customer:customerView,products:visible,last_order:lastOrder});
    }

    if(link.status==='enviado')return json({ok:true,request_number:link.request_number,known_total:link.known_total||0,payment_method:link.payment_method,already:true});
    const paymentMethod=String(body.payment_method||'');
    if(!paymentMethods.includes(paymentMethod))return json({ok:false,message:'Forma de pagamento indisponível para este cliente.'},400);
    const invoiceRequested=Boolean(body.invoice_requested),invoiceChannel=invoiceRequested?String(body.invoice_channel||''):null,invoiceContact=invoiceRequested?String(body.invoice_contact||'').trim():null;
    if(invoiceRequested&&!['email','whatsapp'].includes(invoiceChannel))return json({ok:false,message:'Escolha como deseja receber a nota fiscal.'},400);
    if(invoiceRequested&&!invoiceContact)return json({ok:false,message:'Informe o contato para envio da nota fiscal.'},400);

    const items=(Array.isArray(body.items)?body.items:[]).map(item=>{const p=products.find(x=>x.id===item.product_id),q=Math.max(0,Number(item.quantity||0));if(!p||q<=0||p.base_price==null)return null;const price=Number(p.base_price),stock=Number(p.stock_quantity||0);return {product_id:p.id,product_sku:p.sku,product_name:p.name,quantity:q,unit:p.unit||'',stock_snapshot:stock,price_visible:true,unit_price_snapshot:price,subtotal:price*q,fulfillment_status:stock>=q?'pronta_entrega':stock>0?'parcial':'sob_encomenda'}}).filter(Boolean);
    if(!items.length)return json({ok:false,message:'Seu carrinho está vazio.'},400);
    const total=items.reduce((s,i)=>s+Number(i.subtotal||0),0),units=items.reduce((s,i)=>s+i.quantity,0);
    Object.assign(link,{status:'enviado',submitted_at:now(),known_total:total,items_count:items.length,units_count:units,customer_notes:String(body.notes||''),payment_method:paymentMethod,invoice_requested:invoiceRequested,invoice_channel:invoiceChannel,invoice_contact:invoiceContact});
    links[index]=link;
    const orders=await getJson('data/orders',[]);
    orders.unshift({id:crypto.randomUUID(),order_number:`EC-${String(link.request_number||0).padStart(6,'0')}`,request_number:link.request_number,customer_id:link.customer_id,customer_name:link.customer_name,created_at:now(),total_amount:total,status:'recebido',notes:link.customer_notes,payment_method:paymentMethod,invoice_requested:invoiceRequested,invoice_channel:invoiceChannel,invoice_contact:invoiceContact,items});
    await Promise.all([setJson('data/links',links),setJson('data/orders',orders)]);
    return json({ok:true,request_number:link.request_number,known_total:total,payment_method:paymentMethod,invoice_requested:invoiceRequested});
  }catch(error){console.error('Ever Clean checkout V3:',error);return json({ok:false,message:'Erro interno ao finalizar o pedido.'},500)}
}
