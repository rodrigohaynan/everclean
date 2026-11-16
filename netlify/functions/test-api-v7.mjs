import crypto from 'node:crypto';
import previousHandler from './test-api-v6.mjs';
import {getJson, setJson, json, asaas, ensureSandbox, publicPayment} from '../shared/everclean-asaas.mjs';

const now = () => new Date().toISOString();
const digits = value => String(value || '').replace(/\D/g, '');
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0,10);
};

async function getAsaasCustomer(customer) {
  const cpfCnpj = digits(customer.document || customer.cpf_cnpj || customer.cpfCnpj);
  const cached = String(customer.asaas_sandbox_customer_id || '');
  if (cached.startsWith('cus_')) return cached;

  if (cpfCnpj.length === 11 || cpfCnpj.length === 14) {
    const existing = await asaas('/customers?cpfCnpj=' + encodeURIComponent(cpfCnpj));
    if (existing.data?.[0]?.id) return existing.data[0].id;
  }

  const customerData = {
    name: String(customer.trade_name || customer.legal_name || customer.name || 'Cliente Ever Clean').slice(0,200),
    ...(cpfCnpj.length === 11 || cpfCnpj.length === 14 ? {cpfCnpj} : {}),
    ...(validEmail(customer.email) ? {email: customer.email} : {}),
    ...(digits(customer.phone).length >= 10 ? {mobilePhone: digits(customer.phone)} : {})
  };
  const created = await asaas('/customers', customerData);
  if (!created.id) throw new Error('O Asaas não retornou o identificador do cliente.');
  return created.id;
}

function validateCart(lines, allProducts) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) {
    throw new Error('Escolha entre 1 e 100 produtos por pedido.');
  }
  const seen = new Set();
  return lines.map(line => {
    const id = String(line.product_id || '');
    const quantity = Number(line.quantity);
    if (seen.has(id) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) {
      throw new Error('Quantidade inválida ou produto repetido.');
    }
    seen.add(id);
    const product = allProducts.find(p => String(p.id) === id && p.active !== false && p.catalog_visible !== false);
    const price = Number(product?.base_price);
    if (!product || product.base_price == null || !Number.isFinite(price) || price <= 0) {
      throw new Error('Um dos produtos está indisponível para compra.');
    }
    if (product.catalog_allow_backorder === false && Number(product.stock_quantity || 0) < quantity) {
      throw new Error('Um produto não está disponível na quantidade selecionada.');
    }
    const unitCents = Math.round(price * 100);
    if (unitCents < 1) throw new Error('Preço do produto inválido.');
    return {
      product_id: product.id,
      product_sku: product.sku || '',
      product_name: String(product.name || ''),
      quantity,
      unit: product.unit || '',
      unit_price_snapshot: unitCents / 100,
      subtotal: unitCents * quantity / 100,
      stock_snapshot: Number(product.stock_quantity || 0)
    };
  });
}

export default async function handler(request,context) {
  if (request.method !== 'POST') return previousHandler(request,context);
  let body;
  try { body = await request.clone().json(); }
  catch { return json({ok:false,message:'Requisição inválida.'},400); }
  const action = String(body?.action || '');

  if (action === 'submit_order') {
    return json({ok:false,message:'Use a finalização com pagamento integrado ao Asaas.'},409);
  }

  if (action === 'catalog') {
    const base = await previousHandler(request,context);
    const payload = await base.clone().json().catch(() => null);
    if (!payload?.ok) return base;
    const token = String(body.token || '');
    const links = await getJson('data/links',[]);
    const link = links.find(item => item.token === token);
    const clients = await getJson('data/clients',[]);
    const client = clients.find(item => item.id === link?.customer_id);
    const sanitizeMethods = methods => (methods || []).filter(method => method !== 'boleto' || client?.allow_boleto === true);
    return json({
      ...payload,
      ...(link ? {link:{...payload.link, payment_status:link.payment_status || null}} : {}),
      ...(payload.customer ? {customer:{...payload.customer,payment_methods:sanitizeMethods(payload.customer.payment_methods)}} : {}),
      payment_pending: link?.asaas_reference ? publicPayment(link) : null
    });
  }

  if (action === 'payment_status' || action === 'refresh_pix') {
    const token = String(body.token || '');
    if (!token || token.length > 250) return json({ok:false,message:'Link inválido.'},400);
    const links = await getJson('data/links',[]);
    const link = links.find(item => item.token === token);
    if (!link?.asaas_reference) return json({ok:false,message:'Cobrança não encontrada.'},404);

    if (action === 'refresh_pix') {
      if (link.payment_method !== 'pix' || !link.asaas_payment_id) {
        return json({ok:false,message:'Este pedido não possui cobrança PIX.'},400);
      }
      if (link.payment_status === 'pago') {
        return json({ok:true,payment:publicPayment(link),paid:true});
      }
      // Consulta a MESMA cobrança no Asaas, sem gerar duplicatas.
      if (link.asaas_pix_payload && link.asaas_pix_image) {
        return json({ok:true,payment:publicPayment(link)});
      }
      const lastAttempt = new Date(link.asaas_pix_last_attempt_at || 0).getTime();
      if (Date.now() - lastAttempt < 12000) {
        return json({ok:true,payment:publicPayment(link),retry_after:12});
      }
      link.asaas_pix_last_attempt_at = now();
      try {
        const qr = await asaas('/payments/' + encodeURIComponent(link.asaas_payment_id) + '/pixQrCode');
        if (!qr.payload && !qr.encodedImage) throw new Error('O Asaas não forneceu dados de PIX para esta cobrança.');
        link.asaas_pix_payload = qr.payload || null;
        link.asaas_pix_image = qr.encodedImage || null;
        link.asaas_pix_expiration = qr.expirationDate || null;
        link.asaas_pix_error = null;
      } catch(error) {
        const detail = String(error?.message || 'Falha na geração do PIX').slice(0,170);
        link.asaas_pix_error = 'O PIX ainda não está disponível no Asaas Sandbox. Verifique a habilitação da conta e a chave PIX. Detalhe: ' + detail;
        console.warn('Ever Clean: PIX indisponível na cobrança existente',error?.status || '',detail);
      }
      await setJson('data/links',links);
      return json({ok:true,payment:publicPayment(link)});
    }

    // Sincroniza o status diretamente com o Asaas como reforço ao Webhook.
    const lastCheck = new Date(link.asaas_status_checked_at || 0).getTime();
    if (link.asaas_payment_id && link.payment_status !== 'pago' && Date.now()-lastCheck > 30000) {
      link.asaas_status_checked_at = now();
      try {
        const charge = await asaas('/payments/' + encodeURIComponent(link.asaas_payment_id));
        let state = null;
        if (['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(charge.status)) state='pago';
        if (charge.status === 'OVERDUE') state='vencido';
        if (charge.status === 'REFUNDED') state='estornado';
        if (charge.status === 'DELETED') state='cancelado';
        if (state && state !== link.payment_status) {
          link.payment_status=state;
          link.payment_updated_at=now();
          const orders=await getJson('data/orders',[]);
          const order=orders.find(item=>item.asaas_reference===link.asaas_reference);
          if(order) {
            order.payment_status=state;
            order.status=state==='pago'?'pagamento_confirmado':'pagamento_'+state;
            order.payment_updated_at=link.payment_updated_at;
            await setJson('data/orders',orders);
          }
        }
      } catch(error) {
        console.warn('Ever Clean: consulta de status Asaas indisponível',error?.status || '');
      }
      await setJson('data/links',links);
    }
    return json({ok:true,payment:publicPayment(link),paid:link.payment_status === 'pago'});
  }

  if (action !== 'create_payment') return previousHandler(request,context);

  try {
    ensureSandbox();
    const token = String(body.token || '');
    if (!token || token.length > 250) return json({ok:false,message:'Link inválido.'},400);
    const links = await getJson('data/links',[]);
    const link = links.find(item => item.token === token);
    if (!link) return json({ok:false,message:'Link de pedido não localizado.'},404);
    if (link.status === 'cancelado' || new Date(link.expires_at).getTime() < Date.now()) {
      return json({ok:false,message:'Link expirado ou cancelado.'},410);
    }
    if (link.asaas_reference) {
      return json({ok:true,reused:true,payment:publicPayment(link)});
    }
    if (link.status === 'enviado') return json({ok:false,message:'O pedido deste link já foi enviado.'},409);

    const clients = await getJson('data/clients',[]);
    const client = clients.find(item => item.id === link.customer_id);
    if (!client) return json({ok:false,message:'Cliente não localizado. Solicite a atualização do cadastro.'},400);
    const method = String(body.payment_method || '');
    const allowed = ['pix','cartao','link_pagamento',...(client.allow_boleto === true ? ['boleto'] : [])];
    if (!allowed.includes(method)) return json({ok:false,message:'Pagamento não autorizado para este cliente.'},403);

    const allProducts = await getJson('data/products',[]);
    const items = validateCart(body.items,allProducts);
    const totalCents = items.reduce((sum,item) => sum + Math.round(item.subtotal * 100),0);
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error('Total de pedido inválido.');
    const total = totalCents / 100;
    const reference = 'EVERCLEAN-EC-' + String(link.request_number || '0') + '-' + crypto.randomUUID();
    const requestNo = 'EC-' + String(link.request_number || 0).padStart(6,'0');
    const callback = 'https://evercleancatalogo.netlify.app/pedido/' + encodeURIComponent(token);
    let paymentId = null;
    let checkoutId = null;
    let invoiceUrl = null;
    let boletoUrl = null;
    let checkoutUrl = null;
    let pixPayload = null;
    let pixImage = null;
    let pixExpiration = null;
    let pixError = null;
    let dueDate = null;

    if (method === 'pix' || method === 'boleto') {
      const asaasCustomer = await getAsaasCustomer(client);
      dueDate = addDays(new Date(),method === 'boleto' ? 7 : 1);
      const payment = await asaas('/payments',{
        customer: asaasCustomer,
        billingType: method === 'pix' ? 'PIX' : 'BOLETO',
        value: total,
        dueDate,
        description: 'Pedido ' + requestNo + ' - Ever Clean Higiene Profissional',
        externalReference:reference
      });
      if (!payment.id) throw new Error('O Asaas não retornou o identificador da cobrança.');
      paymentId = payment.id;
      invoiceUrl = payment.invoiceUrl || null;
      boletoUrl = payment.bankSlipUrl || null;
      if (method === 'pix') {
        try {
          const code = await asaas('/payments/' + encodeURIComponent(payment.id) + '/pixQrCode');
          pixPayload = code.payload || null;
          pixImage = code.encodedImage || null;
          pixExpiration = code.expirationDate || null;
        } catch(error) {
          const detail=String(error?.message || 'O Asaas não forneceu o QR Code.').slice(0,170);
          pixError='O PIX ainda não está disponível no Asaas Sandbox. Verifique a habilitação da conta e a chave PIX. Detalhe: '+detail;
          console.warn('Asaas: QR Code indisponível:',error?.status || '',detail);
        }
      }
    } else {
      const cpfCnpj = digits(client.document || client.cpf_cnpj || client.cpfCnpj);
      const customerData = (cpfCnpj.length === 11 || cpfCnpj.length === 14)
        ? {name:String(client.trade_name || client.legal_name || link.customer_name || 'Cliente Ever Clean'),cpfCnpj,...(validEmail(client.email)?{email:client.email}:{})}
        : null;
      const checkout = await asaas('/checkouts',{
        billingTypes:method === 'cartao' ? ['CREDIT_CARD'] : ['PIX','CREDIT_CARD'],
        chargeTypes:['DETACHED'],
        minutesToExpire:60,
        externalReference:reference,
        callback:{successUrl:callback,cancelUrl:callback,expiredUrl:callback},
        items:items.map(item=>({name:item.product_name.slice(0,160),quantity:item.quantity,value:item.unit_price_snapshot})),
        ...(customerData ? {customerData} : {})
      });
      if (!checkout.id) throw new Error('O Asaas não retornou o identificador do checkout.');
      checkoutId = checkout.id;
      checkoutUrl = 'https://asaas.com/checkoutSession/show?id=' + encodeURIComponent(checkout.id);
    }

    const issuedAt = now();
    const units = items.reduce((sum,item) => sum + item.quantity,0);
    Object.assign(link,{
      status:'pagamento_pendente',
      payment_status:'aguardando_pagamento',
      payment_method:method,
      known_total:total,
      items_count:items.length,
      units_count:units,
      customer_notes:String(body.notes || '').slice(0,2000),
      invoice_requested:Boolean(body.invoice_requested),
      invoice_channel:body.invoice_requested ? String(body.invoice_channel || '') : null,
      invoice_contact:body.invoice_requested ? String(body.invoice_contact || '').slice(0,200) : null,
      asaas_reference:reference,
      asaas_payment_id:paymentId,
      asaas_checkout_id:checkoutId,
      asaas_checkout_url:checkoutUrl,
      asaas_invoice_url:invoiceUrl,
      asaas_boleto_url:boletoUrl,
      asaas_pix_payload:pixPayload,
      asaas_pix_image:pixImage,
      asaas_pix_expiration:pixExpiration,
      asaas_pix_error:pixError,
      asaas_pix_last_attempt_at:method==='pix'?now():null,
      asaas_due_date:dueDate,
      submitted_at:issuedAt
    });
    const orders = await getJson('data/orders',[]);
    orders.unshift({
      id:crypto.randomUUID(),
      order_number:requestNo,
      request_number:link.request_number,
      customer_id:link.customer_id,
      customer_name:link.customer_name,
      created_at:issuedAt,
      total_amount:total,
      status:'aguardando_pagamento',
      payment_status:'aguardando_pagamento',
      payment_method:method,
      asaas_reference:reference,
      asaas_payment_id:paymentId,
      asaas_checkout_id:checkoutId,
      source:'Catálogo Ever Clean / Asaas Sandbox',
      notes:link.customer_notes,
      invoice_requested:link.invoice_requested,
      invoice_channel:link.invoice_channel,
      invoice_contact:link.invoice_contact,
      items
    });
    // Persistir o pedido antes do link de cobrança, para associar o webhook.
    await setJson('data/orders',orders);
    await setJson('data/links',links);
    return json({ok:true,payment:publicPayment(link)});
  } catch(error) {
    console.error('Ever Clean Asaas:',error?.message || 'Erro');
    return json({ok:false,message:error?.message || 'Falha ao criar a cobrança no Asaas.'},502);
  }
}
