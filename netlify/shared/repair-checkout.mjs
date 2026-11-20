import crypto from 'node:crypto';
import {asaas,ensureSandbox,getJson,setJson,json,publicPayment} from './everclean-asaas.mjs';

// Corrige somente checkouts antigos cujo link foi montado incorretamente.
// Reutiliza o pedido original e cancela o checkout antigo antes de emitir outro.
export async function repairLegacyCheckout(body) {
  try {
    ensureSandbox();
    const token=String(body?.token||'');
    if(!token || token.length>250)return json({ok:false,message:'Link inválido.'},400);
    const links=await getJson('data/links',[]);
    const link=links.find(x=>x.token===token);
    if(!link?.asaas_checkout_id || link.payment_method!=='cartao' || link.asaas_payment_id) {
      return json({ok:false,message:'Este pedido não possui um checkout antigo para corrigir.'},400);
    }
    if(link.payment_status==='pago'||link.status==='cancelado'||link.payment_status==='estornado'){
      return json({ok:false,message:'Este pedido está pago, cancelado ou estornado. Não pode ser alterado.'},409);
    }
    if(new Date(link.expires_at).getTime()<Date.now()){
      return json({ok:false,message:'O link de pedido expirou. Solicite um novo link à Ever Clean.'},410);
    }
    const previousUrl=String(link.asaas_checkout_url||'');
    if(!previousUrl.startsWith('https://asaas.com/checkoutSession/show?id=')) {
      return json({ok:true,reused:true,payment:publicPayment(link)});
    }
    const orders=await getJson('data/orders',[]);
    const order=orders.find(o=>o.asaas_reference===link.asaas_reference&&o.request_number===link.request_number);
    if(!order || !Array.isArray(order.items)||!order.items.length){
      return json({ok:false,message:'O pedido original não possui itens suficientes para reconstruir o checkout.'},409);
    }
    if(['pago','estornado','cancelado'].includes(order.payment_status)){
      return json({ok:false,message:'O pedido original não permite alteração de pagamento.'},409);
    }
    const cents=Math.round(Number(order.total_amount||0)*100);
    const itemsCents=order.items.reduce((sum,item)=>sum+Math.round(Number(item.unit_price_snapshot||0)*100)*Number(item.quantity||0),0);
    if(!Number.isSafeInteger(cents) || cents<1 || cents!==itemsCents ||
        Math.round(Number(link.known_total||0)*100)!==cents) {
      return json({ok:false,message:'Valor do pedido inconsistente. Consulte a Ever Clean antes de pagar.'},409);
    }
    if(!link.asaas_legacy_checkout_canceled){
      // Evita coexistirem dois checkouts disponíveis para o mesmo pedido.
      const canceled=await asaas('/checkouts/'+encodeURIComponent(link.asaas_checkout_id)+'/cancel',{});
      if(canceled?.status && String(canceled.status).toUpperCase()!=='CANCELED'){
        return json({ok:false,message:'O checkout antigo não pôde ser cancelado. A correção foi interrompida.'},409);
      }
      link.asaas_legacy_checkout_canceled=true;
      await setJson('data/links',links);
    }
    const reference='EVERCLEAN-EC-'+String(link.request_number||'0')+'-'+crypto.randomUUID();
    const callback='https://evercleancatalogo.netlify.app/pedido/'+encodeURIComponent(token);
    const checkout=await asaas('/checkouts',{
      billingTypes:['CREDIT_CARD'],
      chargeTypes:['DETACHED'],
      minutesToExpire:60,
      externalReference:reference,
      callback:{successUrl:callback,cancelUrl:callback,expiredUrl:callback},
      items:order.items.map(item=>({
        name:String(item.product_name||'Produto Ever Clean').slice(0,30),
        quantity:Number(item.quantity),
        value:Number(item.unit_price_snapshot)
      }))
    });
    const returned=String(checkout?.link||'');
    let url=null;
    try{url=new URL(returned);}catch{}
    if(!checkout?.id || !url || url.protocol!=='https:' || url.hostname!=='sandbox.asaas.com'){
      return json({ok:false,message:'O Asaas não forneceu a URL de Checkout Sandbox. A cobrança antiga foi cancelada, mas nenhum link válido foi recebido. Consulte o administrador.'},502);
    }
    const updatedAt=new Date().toISOString();
    Object.assign(link,{
      asaas_checkout_id:checkout.id,
      asaas_checkout_url:url.href,
      asaas_reference:reference,
      asaas_legacy_checkout_canceled:false,
      payment_status:'aguardando_pagamento',
      status:'pagamento_pendente',
      payment_updated_at:updatedAt
    });
    Object.assign(order,{
      asaas_checkout_id:checkout.id,
      asaas_reference:reference,
      payment_status:'aguardando_pagamento',
      status:'aguardando_pagamento',
      payment_updated_at:updatedAt
    });
    await setJson('data/orders',orders);
    await setJson('data/links',links);
    return json({ok:true,repaired:true,payment:publicPayment(link)});
  }catch(error){
    console.error('Ever Clean: recuperação do checkout Asaas:',error?.status||'',String(error?.message||'erro').slice(0,200));
    return json({ok:false,message:'Não foi possível recuperar o link do cartão. O Asaas retornou: '+String(error?.message||'erro inesperado').slice(0,170)},502);
  }
}
