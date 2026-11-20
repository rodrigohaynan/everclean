import crypto from 'node:crypto';
import {env, getJson, setJson, json, eventStatus} from '../shared/everclean-asaas.mjs';

// Recebe exclusivamente os eventos assinados pelo token configurado no Sandbox Asaas.
export default async function handler(request) {
  if (request.method === 'GET') return json({ok:true,service:'Ever Clean Asaas webhook',accepts:'POST'});
  if (request.method !== 'POST') return json({ok:false},405);

  const expected = env('ASAAS_WEBHOOK_TOKEN');
  if (!expected || expected.length < 32) return json({ok:false,message:'Webhook não configurado.'},503);
  const provided = request.headers.get('asaas-access-token') || '';
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) {
    return json({ok:false,message:'Acesso não autorizado.'},401);
  }
  if (Number(request.headers.get('content-length') || 0) > 1024*1024) {
    return json({ok:false,message:'Evento muito grande.'},413);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ok:false,message:'JSON inválido.'},400); }
  if (!body || typeof body.id !== 'string' || !body.event) return json({ok:false,message:'Evento inválido.'},400);

  const digest = crypto.createHash('sha256').update(body.id).digest('hex');
  const eventKey = 'data/asaas_events/' + digest;
  try {
    if (await getJson(eventKey, null)) return json({ok:true,duplicate:true});

    const status = eventStatus(body.event);
    let linkedOrder = null;
    let updatedOrder = false;
    if (status) {
      const paymentId = String(body.payment?.id || '');
      const checkoutId = String(body.checkout?.id || '');
      const reference = String(body.payment?.externalReference || body.checkout?.externalReference || '');
      const orders = await getJson('data/orders',[]);
      const order = orders.find(item =>
        (paymentId && item.asaas_payment_id === paymentId) ||
        (checkoutId && item.asaas_checkout_id === checkoutId) ||
        (reference && item.asaas_reference === reference));
      if (order) {
        linkedOrder=String(order.order_number || '').slice(0,35);
        const links = await getJson('data/links',[]);
        const link = links.find(item => item.asaas_reference === order.asaas_reference);

        // Não retroceder de pago para vencido, nem ignorar estornos.
        const previous = order.payment_status || 'aguardando_pagamento';
        // Cancelamento esperado do checkout antigo não cancela o pedido
        // quando o cliente está migrando para PIX ou boleto.
        const expectedCheckoutCancellation =
          body.event === 'CHECKOUT_CANCELED' &&
          Boolean(link?.asaas_checkout_switch_canceled) &&
          checkoutId === String(link?.asaas_checkout_id || '');
        const shouldChange = !expectedCheckoutCancellation &&
          !(previous === 'pago' && status === 'vencido') &&
          !(['estornado','cancelado'].includes(previous) && status === 'pago');
        if (shouldChange) {
          order.payment_status = status;
          order.status = status === 'pago' ? 'pagamento_confirmado' : 'pagamento_' + status;
          order.payment_updated_at = new Date().toISOString();
          if (link) {
            link.payment_status = status;
            link.status = status === 'pago' ? 'enviado' : 'pagamento_pendente';
            link.payment_updated_at = order.payment_updated_at;
          }
          await setJson('data/orders',orders);
          if (link) await setJson('data/links',links);
          updatedOrder=true;
        }
      }
    }

    // Registra somente metadados de diagnóstico, sem dados de compradores ou segredos.
    // Permite comprovar se o pedido mudou pelo Webhook ou pelo polling de fallback.
    const processedAt = new Date().toISOString();
    const auditEntry = {
      event:String(body.event).slice(0,70),
      order_number:linkedOrder,
      matched:Boolean(linkedOrder),
      updated:updatedOrder,
      processed_at:processedAt
    };
    const recent = await getJson('data/asaas_webhook_recent',[]);
    await setJson('data/asaas_webhook_recent',[auditEntry,...(Array.isArray(recent)?recent:[])].slice(0,15));
    // A chave do evento é gravada após o processamento. Reentregas são idempotentes.
    await setJson(eventKey,{event:body.event,processed_at:processedAt});
    return json({ok:true});
  } catch (error) {
    console.error('Ever Clean webhook: erro ao persistir evento', error?.message || 'Erro');
    return json({ok:false,message:'Não foi possível processar a notificação.'},500);
  }
}
