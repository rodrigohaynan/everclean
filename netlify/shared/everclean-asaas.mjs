import { getStore } from '@netlify/blobs';

// Recriar o cliente por acesso: o token Blobs é renovado pelo Netlify a cada invocação.
const getDataStore = () => getStore({name: 'everclean-test', consistency: 'strong'});
export const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
export const getJson = async (key, fallback = null) => {
  const value = await getDataStore().get(key, {type: 'json', consistency: 'strong'});
  return value === null ? fallback : value;
};
export const setJson = (key, value) => getDataStore().setJSON(key, value);
export const env = (name) => globalThis.Netlify?.env?.get?.(name) || process.env[name] || '';

export function ensureSandbox() {
  const base = String(env('ASAAS_BASE_URL')).replace(/\/+$/, '');
  if (base !== 'https://api-sandbox.asaas.com/v3') {
    throw new Error('Ambiente Asaas não configurado para testes. Nenhuma cobrança foi criada.');
  }
  if (!env('ASAAS_API_KEY')) {
    throw new Error('A chave de API do Asaas não está configurada no Netlify.');
  }
  return base;
}

export async function asaas(path, payload) {
  const base = ensureSandbox();
  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'access_token': env('ASAAS_API_KEY'),
    'User-Agent': 'EverCleanCatalogo/1.0'
  };
  const response = await fetch(base + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers,
    ...(payload === undefined ? {} : {body: JSON.stringify(payload)})
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(body.errors)
      ? body.errors.map(item => String(item.description || '')).filter(Boolean).join('; ')
      : '';
    const error = new Error(detail || 'O Asaas não conseguiu concluir esta solicitação.');
    error.status = response.status;
    throw error;
  }
  return body;
}

export const paidEvents = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'CHECKOUT_PAID']);
export function eventStatus(event) {
  if (paidEvents.has(event)) return 'pago';
  if (event === 'PAYMENT_OVERDUE' || event === 'CHECKOUT_EXPIRED') return 'vencido';
  if (event === 'PAYMENT_DELETED' || event === 'CHECKOUT_CANCELED') return 'cancelado';
  if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED' || event === 'PAYMENT_RECEIVED_IN_CASH_UNDONE') return 'estornado';
  return null;
}

export function publicPayment(link) {
  if (!link?.asaas_reference) return null;
  return {
    method: link.payment_method,
    status: link.payment_status || 'aguardando_pagamento',
    request_number: link.request_number,
    known_total: Number(link.known_total || 0),
    checkout_url: link.asaas_checkout_url || null,
    invoice_url: link.asaas_invoice_url || null,
    boleto_url: link.asaas_boleto_url || null,
    pix_payload: link.asaas_pix_payload || null,
    pix_image: link.asaas_pix_image || null,
    pix_expiration: link.asaas_pix_expiration || null,
    pix_error: link.asaas_pix_error || null,
    due_date: link.asaas_due_date || null,
  };
}
