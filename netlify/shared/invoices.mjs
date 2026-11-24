// Nota fiscal (NF-e) emitida no Bling e entregue ao cliente pelo catálogo.
//
// A nota é gerada e enviada à SEFAZ no Bling a partir do pedido de venda que
// o catálogo registrou. Aqui só LEMOS o Bling (nenhum POST/PUT):
//   GET /pedidos/vendas/{id}   -> notaFiscal.id
//   GET /nfe/{id}              -> situação, número, série, chave, links
//   GET /nfe/documento/{chave} -> arquivo PDF ou XML (formato=pdf|xml)
// O cliente só vê a nota autorizada (situação 5 ou 6) e baixa os arquivos
// pelo link do pedido ou pelo portal; nunca acessa o Bling diretamente.

const API = 'https://api.bling.com.br/Api/v3';
const digits = value => String(value ?? '').replace(/\D/g, '');

// Situações da NF-e no Bling.
export const NFE_SITUATIONS = {
  1: 'Pendente', 2: 'Cancelada', 3: 'Aguardando recibo', 4: 'Rejeitada', 5: 'Autorizada',
  6: 'Emitida DANFE', 7: 'Registrada', 8: 'Aguardando protocolo', 9: 'Denegada',
  10: 'Consulta situação', 11: 'Bloqueada',
};
export function invoiceStatusFrom(situation) {
  const s = Number(situation);
  if (s === 5 || s === 6) return 'authorized';
  if (s === 2) return 'cancelled';
  if ([4, 9, 11].includes(s)) return 'problem';
  return 'pending';
}

async function getJsonFrom(token, path, fetchImpl) {
  const response = await fetchImpl(API + path, {
    headers: {Accept: 'application/json', Authorization: 'Bearer ' + token},
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object')
    throw Object.assign(Error('Bling indisponível (HTTP ' + response.status + ').'), {status: response.status});
  return data;
}

// Lê no Bling a nota do pedido e devolve o registro a gravar.
export async function readInvoiceFromBling(blingOrderId, token, {fetchImpl = fetch} = {}) {
  if (!/^\d{1,20}$/.test(String(blingOrderId || ''))) throw Error('Pedido Bling inválido.');
  const sale = await getJsonFrom(token, '/pedidos/vendas/' + blingOrderId, fetchImpl);
  const invoiceId = String(sale?.data?.notaFiscal?.id ?? '');
  if (!/^\d{1,20}$/.test(invoiceId) || /^0+$/.test(invoiceId))
    return {status: 'none', bling_invoice_id: null, bling_status: null,
      number: null, series: null, access_key: null, issued_at: null};
  const nfe = (await getJsonFrom(token, '/nfe/' + invoiceId, fetchImpl))?.data || {};
  const situation = Number(nfe.situacao);
  const key = digits(nfe.chaveAcesso);
  let status = invoiceStatusFrom(situation);
  // Sem chave de acesso válida não há documento para o cliente.
  if (status === 'authorized' && key.length !== 44) status = 'pending';
  const issued = Date.parse(String(nfe.dataEmissao || '').replace(' ', 'T'));
  return {
    status, bling_invoice_id: invoiceId,
    bling_status: Number.isInteger(situation) ? situation : null,
    number: String(nfe.numero ?? '').trim().slice(0, 20) || null,
    series: String(nfe.serie ?? '').trim().slice(0, 10) || null,
    access_key: key.length === 44 ? key : null,
    issued_at: Number.isFinite(issued) ? new Date(issued).toISOString() : null,
  };
}

const label = invoice => 'Nota fiscal nº ' + (invoice.number || '—') +
  (invoice.series ? ' (série ' + invoice.series + ')' : '');

// Consulta o Bling e grava o resultado. Ao ser autorizada (ou cancelada), a
// nota vira uma atualização no acompanhamento do pedido. Retorna a mudança.
export async function syncOrderInvoice(db, order, token, {fetchImpl = fetch} = {}) {
  const found = await readInvoiceFromBling(order.bling_order_id, token, {fetchImpl});
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      'SELECT status FROM everclean_private.order_invoices WHERE checkout_order_id=$1 FOR UPDATE', [order.id]);
    const previous = before.rows[0]?.status || null;
    await client.query(
      'INSERT INTO everclean_private.order_invoices (checkout_order_id,status,bling_invoice_id,bling_status,' +
      'number,series,access_key,issued_at,checked_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now()) ' +
      'ON CONFLICT (checkout_order_id) DO UPDATE SET status=EXCLUDED.status,bling_invoice_id=EXCLUDED.bling_invoice_id,' +
      'bling_status=EXCLUDED.bling_status,number=EXCLUDED.number,series=EXCLUDED.series,' +
      'access_key=EXCLUDED.access_key,issued_at=EXCLUDED.issued_at,checked_at=now(),' +
      'updated_at=CASE WHEN order_invoices.status IS DISTINCT FROM EXCLUDED.status ' +
      'OR order_invoices.bling_invoice_id IS DISTINCT FROM EXCLUDED.bling_invoice_id THEN now() ELSE order_invoices.updated_at END',
      [order.id, found.status, found.bling_invoice_id, found.bling_status, found.number,
        found.series, found.access_key, found.issued_at]);
    let note = null;
    if (found.status === 'authorized' && previous !== 'authorized')
      note = label(found) + ' emitida. O PDF e o XML estão disponíveis na página do pedido.';
    else if (found.status === 'cancelled' && previous === 'authorized')
      note = label(found) + ' cancelada. Em caso de dúvida, fale com a Ever Clean.';
    if (note) {
      const stage = await client.query(
        'SELECT stage FROM everclean_private.order_fulfillment WHERE checkout_order_id=$1', [order.id]);
      const current = stage.rows[0]?.stage && stage.rows[0].stage !== 'awaiting_review'
        ? stage.rows[0].stage : 'received';
      await client.query(
        'INSERT INTO everclean_private.order_fulfillment_events ' +
        '(checkout_order_id,previous_stage,new_stage,public_note) VALUES ($1,$2,$2,$3)',
        [order.id, current, note.slice(0, 240)]);
    }
    await client.query('COMMIT');
    return {...found, previous, changed: previous !== found.status};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Dados públicos da nota (somente autorizada) por pedido.
export async function invoicesFor(db, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))];
  const map = new Map();
  if (!ids.length) return map;
  const {rows} = await db.query(
    'SELECT checkout_order_id::text AS id,status,bling_invoice_id,number,series,issued_at,access_key,bling_status,shared_at ' +
    'FROM everclean_private.order_invoices WHERE checkout_order_id::text = ANY($1)', [ids]);
  for (const row of rows) map.set(row.id, row);
  return map;
}
export function publicInvoice(row) {
  if (!row || row.status !== 'authorized') return null;
  return {number: row.number, series: row.series, issued_at: row.issued_at,
    access_key: row.access_key};
}

export const invoiceFileName = (number, format) =>
  'EverClean-NotaFiscal-' + (String(number || '').replace(/\D/g, '') || 'nfe') + '.' + format;

const fileHeaders = (type, name, inline = false) => ({
  'Content-Type': type, 'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + name + '"',
  'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
});
const looksLike = (format, contentType, bytes) => format === 'pdf'
  ? /pdf/i.test(contentType) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
  : /xml/i.test(contentType) || String.fromCharCode(...bytes.slice(0, 5)).trim().startsWith('<');

async function fetchFile(url, headers, format, fetchImpl) {
  const response = await fetchImpl(url, {headers, redirect: 'follow', signal: AbortSignal.timeout(20000)});
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
  return looksLike(format, response.headers.get('content-type') || '', bytes) ? bytes : null;
}

// Baixa o PDF (DANFE) ou o XML da nota autorizada. Primeiro pela rota de
// documento do Bling; se não vier um arquivo, pelos links da própria nota.
export async function invoiceDocument(invoice, format, token, {fetchImpl = fetch, inline = false} = {}) {
  if (!['pdf', 'xml'].includes(format)) throw Object.assign(Error('Formato inválido.'), {status: 400});
  if (!invoice || invoice.status !== 'authorized' || !/^\d{44}$/.test(String(invoice.access_key || '')))
    throw Object.assign(Error('Nota fiscal ainda não disponível.'), {status: 404});
  const type = format === 'pdf' ? 'application/pdf' : 'application/xml; charset=utf-8';
  const name = invoiceFileName(invoice.number, format);
  const auth = {Authorization: 'Bearer ' + token};
  let bytes = await fetchFile(API + '/nfe/documento/' + invoice.access_key + '?formato=' + format,
    {...auth, Accept: format === 'pdf' ? 'application/pdf' : 'application/xml'}, format, fetchImpl).catch(() => null);
  if (!bytes && /^\d{1,20}$/.test(String(invoice.bling_invoice_id || ''))) {
    const nfe = (await getJsonFrom(token, '/nfe/' + invoice.bling_invoice_id, fetchImpl))?.data || {};
    if (digits(nfe.chaveAcesso) !== invoice.access_key)
      throw Object.assign(Error('Nota fiscal divergente no Bling.'), {status: 409});
    if (format === 'xml' && String(nfe.xml || '').trim().startsWith('<'))
      bytes = new TextEncoder().encode(String(nfe.xml));
    else {
      const link = String((format === 'pdf' ? (nfe.linkPDF || nfe.linkDanfe) : nfe.xml) || '');
      if (/^https:\/\/([a-z0-9-]+\.)*bling\.com\.br\//i.test(link))
        bytes = await fetchFile(link, {}, format, fetchImpl).catch(() => null);
    }
  }
  if (!bytes) throw Object.assign(Error('Não foi possível obter o arquivo da nota no Bling. Tente novamente.'), {status: 502});
  return new Response(bytes, {status: 200, headers: fileHeaders(type, name, inline && format === 'pdf')});
}
