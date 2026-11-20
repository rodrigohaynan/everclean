import {asaas, ensureSandbox, getJson, setJson, json, publicPayment} from './everclean-asaas.mjs';

const now=()=>new Date().toISOString();
const addDays=(date,days)=>{
  const next=new Date(date);
  next.setUTCDate(next.getUTCDate()+days);
  return next.toISOString().slice(0,10);
};
const paymentCodes={pix:'PIX',boleto:'BOLETO',cartao:'CREDIT_CARD'};
const paidStates=new Set(['RECEIVED','CONFIRMED','RECEIVED_IN_CASH']);
const editableStates=new Set(['PENDING','OVERDUE']);

export function allowedMethodsFor(client){
  return ['pix','cartao',...(client?.allow_boleto===true?['boleto']:[])];
}

// Troca a forma de pagamento DA MESMA cobrança no Asaas (PUT).
// Não gera novo número de pedido, cobrança paralela, boleto duplicado ou estorno.
export async function changePaymentMethod(body){
  try {
    ensureSandbox();
    const token=String(body?.token||'');
    const method=String(body?.payment_method||'');
    if(!token || token.length>250) return json({ok:false,message:'Link inválido.'},400);
    const links=await getJson('data/links',[]);
    const link=links.find(item=>item.token===token);
    if(!link?.asaas_reference) return json({ok:false,message:'Pedido não encontrado.'},404);
    if(link.status==='cancelado' || new Date(link.expires_at).getTime()<Date.now()){
      return json({ok:false,message:'Link expirado ou cancelado. Peça um novo link à Ever Clean.'},410);
    }
    if(['pago','estornado','cancelado'].includes(link.payment_status)){
      return json({ok:false,message:'Este pagamento não permite alteração. Consulte a Ever Clean.'},409);
    }
    const clients=await getJson('data/clients',[]);
    const client=clients.find(c=>c.id===link.customer_id);
    const allowed=allowedMethodsFor(client);
    if(!allowed.includes(method)){
      return json({ok:false,message:'Forma de pagamento não autorizada para este cliente.'},403);
    }
    if(method===link.payment_method) return json({ok:true,reused:true,payment:publicPayment(link,allowed)});
    if(!link.asaas_payment_id){
      return json({ok:false,message:'Este pedido foi criado em um checkout anterior. Para alterar com segurança, solicite um novo link à Ever Clean.'},409);
    }
    const orders=await getJson('data/orders',[]);
    const order=orders.find(o=>o.asaas_reference===link.asaas_reference && o.request_number===link.request_number);
    if(!order) return json({ok:false,message:'Não foi possível localizar o pedido original.'},409);
    if(['pago','estornado','cancelado'].includes(order.payment_status)){
      return json({ok:false,message:'Este pedido já está pago, cancelado ou estornado.'},409);
    }
    const charge=await asaas('/payments/'+encodeURIComponent(link.asaas_payment_id));
    const originalState=String(charge?.status||'').toUpperCase();
    if(paidStates.has(originalState)){
      link.payment_status='pago';
      link.status='enviado';
      order.payment_status='pago';
      order.status='pagamento_confirmado';
      await setJson('data/orders',orders);
      await setJson('data/links',links);
      return json({ok:false,paid:true,payment:publicPayment(link,allowed),message:'O pagamento já foi confirmado pelo Asaas. Não é possível trocar a forma de pagamento.'},409);
    }
    if(!editableStates.has(originalState)){
      return json({ok:false,message:'O Asaas não permite alterar esta cobrança no status atual ('+originalState+').'},409);
    }
    const cents=Math.round(Number(order.total_amount||0)*100);
    if(!Number.isSafeInteger(cents)||cents<1||cents!==Math.round(Number(link.known_total||0)*100)){
      return json({ok:false,message:'O valor do pedido precisa ser conferido pelo administrador.'},409);
    }
    if(String(charge.externalReference||'')!==String(link.asaas_reference) ||
       Math.round(Number(charge.value||0)*100)!==cents) {
      return json({ok:false,message:'A cobrança Asaas não confere com este pedido. Alteração bloqueada.'},409);
    }

    const dueDate=addDays(new Date(),method==='boleto'?7:1);
    const updated=await asaas('/payments/'+encodeURIComponent(link.asaas_payment_id),{
      billingType:paymentCodes[method],
      value:cents/100,
      dueDate,
      description:'Pedido '+String(order.order_number||'Ever Clean')+' - Ever Clean Higiene Profissional',
      externalReference:link.asaas_reference
    },'PUT');

    let pixPayload=null,pixImage=null,pixExpiration=null,pixError=null;
    if(method==='pix'){
      try{
        const code=await asaas('/payments/'+encodeURIComponent(link.asaas_payment_id)+'/pixQrCode');
        pixPayload=code.payload||null;
        pixImage=code.encodedImage||null;
        pixExpiration=code.expirationDate||null;
        if(!pixPayload && !pixImage)throw new Error('O Asaas não retornou o QR Code.');
      }catch(error){
        pixError='Não foi possível gerar o QR Code nesta cobrança. Detalhe: '+String(error?.message||'PIX indisponível').slice(0,160);
      }
    }

    const updatedAt=now();
    const invoiceUrl=updated.invoiceUrl||charge.invoiceUrl||link.asaas_invoice_url||null;
    Object.assign(link,{
      payment_method:method,
      payment_allowed_methods:allowed,
      payment_status:'aguardando_pagamento',
      status:'pagamento_pendente',
      asaas_checkout_id:null,
      asaas_checkout_url:method==='cartao'?invoiceUrl:null,
      asaas_invoice_url:invoiceUrl,
      asaas_boleto_url:method==='boleto'?(updated.bankSlipUrl||null):null,
      asaas_pix_payload:pixPayload,
      asaas_pix_image:pixImage,
      asaas_pix_expiration:pixExpiration,
      asaas_pix_error:pixError,
      asaas_pix_last_attempt_at:method==='pix'?updatedAt:null,
      asaas_due_date:dueDate,
      asaas_status_checked_at:null,
      payment_updated_at:updatedAt,
      payment_method_change_count:Number(link.payment_method_change_count||0)+1
    });
    order.payment_method=method;
    order.payment_status='aguardando_pagamento';
    order.status='aguardando_pagamento';
    order.payment_updated_at=updatedAt;
    order.payment_method_change_count=link.payment_method_change_count;

    await setJson('data/orders',orders);
    await setJson('data/links',links);
    return json({ok:true,changed:true,payment:publicPayment(link,allowed)});
  }catch(error){
    console.error('Ever Clean: erro ao alterar a forma de pagamento',error?.status||'',error?.message||'erro');
    return json({ok:false,message:error?.message||'Não foi possível alterar a forma de pagamento no Asaas.'},502);
  }
}
