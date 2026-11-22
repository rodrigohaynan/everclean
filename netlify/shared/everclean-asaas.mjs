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

export async function asaas(path, payload, httpMethod, options={}) {
  const base = ensureSandbox();
  const method = httpMethod || (payload === undefined ? 'GET' : 'POST');
  if (!['GET','POST','PUT','DELETE'].includes(method)) throw new Error('Método Asaas não permitido.');
  // Preserva consultas ao histórico do Sandbox, mas bloqueia novas mutações.
  // Produção usa exclusivamente asaasProduction() em API isolada.
  if(method!=='GET'&&String(env('EVERCLEAN_SANDBOX_CLOSED')||'').toLowerCase()==='true'){
    const error=new Error('Sandbox encerrado. Novas cobranças devem usar o Asaas Produção.');
    error.status=410;
    throw error;
  }
  // Prazo opcional para consultas e mutações explicitamente selecionadas.
  // Nenhuma chamada é repetida automaticamente após timeout: resultado pode ser incerto.
  const timeoutMs=Number(options?.timeoutMs)||0;
  if(timeoutMs && (timeoutMs<1500||timeoutMs>20000))
    throw new Error('Prazo de consulta do Asaas inválido.');
  const controller=timeoutMs?new AbortController():null;
  const timeout=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'access_token': env('ASAAS_API_KEY'),
    'User-Agent': 'EverCleanCatalogo/1.0'
  };
  try{
    const response = await fetch(base + path, {
      method,headers,
      ...(controller?{signal:controller.signal}:{}),
      ...(payload === undefined || method==='GET' ? {} : {body: JSON.stringify(payload)})
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
  }catch(error){
    if(controller?.signal.aborted){
      const qrRequest=String(path||'').includes('/pixQrCode');
      const timeoutError=new Error(qrRequest?
        'Consulta do QR Code demorou demais. Atualize o QR Code desta cobrança.':
        'O Asaas demorou a responder. Consulte o pagamento antes de tentar novamente.');
      timeoutError.status=504;
      throw timeoutError;
    }
    throw error;
  }finally{
    if(timeout!==null)clearTimeout(timeout);
  }
}

export const paidEvents = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'CHECKOUT_PAID']);
export function eventStatus(event) {
  if (paidEvents.has(event)) return 'pago';
  if (event === 'PAYMENT_OVERDUE' || event === 'CHECKOUT_EXPIRED') return 'vencido';
  if (event === 'PAYMENT_DELETED' || event === 'CHECKOUT_CANCELED') return 'cancelado';
  if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED' || event === 'PAYMENT_RECEIVED_IN_CASH_UNDONE') return 'estornado';
  return null;
}

export function publicPayment(link, allowedMethods = null) {
  if (!link?.asaas_reference) return null;
  const legacyCheckout = Boolean(
    link.asaas_checkout_id &&
    String(link.asaas_checkout_url || '').startsWith('https://asaas.com/checkoutSession/show?id=')
  );
  return {
    method: link.payment_method,
    allowed_methods: allowedMethods || link.payment_allowed_methods || ['pix','cartao'],
    can_change_method: Boolean(link.asaas_payment_id || link.asaas_checkout_id),
    checkout_switch_pending: Boolean(link.asaas_checkout_switch_canceled),
    checkout_switch_target: link.asaas_checkout_switch_canceled ? (link.asaas_checkout_switch_target || null) : null,
    needs_checkout_repair: legacyCheckout,
    status: link.payment_status || 'aguardando_pagamento',
    request_number: link.request_number,
    known_total: Number(link.known_total || 0),
    checkout_url: legacyCheckout ? null : (link.asaas_checkout_url || null),
    invoice_url: link.asaas_invoice_url || null,
    boleto_url: link.asaas_boleto_url || null,
    pix_payload: link.asaas_pix_payload || null,
    pix_image: link.asaas_pix_image || null,
    pix_expiration: link.asaas_pix_expiration || null,
    pix_error: link.asaas_pix_error || null,
    due_date: link.asaas_due_date || null,
  };
}
