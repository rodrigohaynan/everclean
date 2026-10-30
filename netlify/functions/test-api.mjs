import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const ADMIN_EMAIL = 'evercleanhigieneprofissional@gmail.com';
const store = getStore({ name: 'everclean-test', consistency: 'strong' });

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const randomToken = () => crypto.randomBytes(24).toString('hex');

function json(data, status = 200) {
  return Response.json(data, { status });
}

async function getJson(key, fallback = null) {
  const value = await store.get(key, { type: 'json', consistency: 'strong' });
  return value === null ? fallback : value;
}

async function setJson(key, value) {
  await store.setJSON(key, value);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const calculated = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return calculated.length === expected.length && crypto.timingSafeEqual(calculated, expected);
}

function signSession(email, secret) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token, secret) {
  try {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature || !secret) return null;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.email || !data?.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function bearer(request) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

const seedClients = [
  { id: uuid(), trade_name: 'ACADEMIA ADRENALINA', document: '', phone: '', city: 'Campo Grande/MS', seller_name: 'Guilherme Amaral', created_at: now() },
  { id: uuid(), trade_name: 'CLIENTE TESTE HOTEL', document: '', phone: '', city: 'Campo Grande/MS', seller_name: 'Guilherme Amaral', created_at: now() },
  { id: uuid(), trade_name: 'CLIENTE TESTE CLÍNICA', document: '', phone: '', city: 'Campo Grande/MS', seller_name: 'Guilherme Amaral', created_at: now() },
];

const seedProducts = [
  ['EC-001','Detergente Neutro 5L','Limpeza geral','5 L',18.90,24],
  ['EC-002','Desinfetante Concentrado 5L','Desinfecção','5 L',29.90,18],
  ['EC-003','Álcool 70% 5L','Higiene','5 L',42.90,10],
  ['EC-004','Sabonete Líquido 5L','Higiene','5 L',27.50,15],
  ['EC-005','Papel Higiênico Rolão','Papéis','Fardo',74.90,8],
  ['EC-006','Papel Toalha Interfolhado','Papéis','Caixa',89.90,12],
  ['EC-007','Saco para Lixo Reforçado 100L','Descartáveis','Pacote',24.90,30],
  ['EC-008','Limpador Multiuso 5L','Limpeza geral','5 L',31.90,6],
].map(([sku,name,category,unit,base_price,stock_quantity]) => ({
  id: uuid(), sku, name, category, unit, base_price, stock_quantity, brand: '', image_url: '', active: true,
  catalog_visible: true, catalog_show_price: true, catalog_show_stock: true, catalog_allow_backorder: true, created_at: now(),
}));

async function ensureData() {
  let clients = await getJson('data/clients');
  let products = await getJson('data/products');
  let links = await getJson('data/links');
  let orders = await getJson('data/orders');
  if (clients === null) { clients = seedClients; await setJson('data/clients', clients); }
  if (products === null) { products = seedProducts; await setJson('data/products', products); }
  if (links === null) { links = []; await setJson('data/links', links); }
  if (orders === null) { orders = []; await setJson('data/orders', orders); }

  const normalizedProducts = products.map((product) => (
    product.base_price != null && product.catalog_show_price !== true
      ? { ...product, catalog_show_price: true }
      : product
  ));
  const priceFlagsChanged = normalizedProducts.some((product, index) => product !== products[index]);
  if (priceFlagsChanged) {
    products = normalizedProducts;
    await setJson('data/products', products);
  }

  return { clients, products, links, orders };
}

function orderCode(number) {
  return `EC-${String(number || 0).padStart(6, '0')}`;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ ok: false, message: 'Método não permitido.' }, 405);

  let body = {};
  try { body = await request.json(); } catch { return json({ ok: false, message: 'Requisição inválida.' }, 400); }
  const action = String(body.action || '');

  try {
    if (action === 'reset_password') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (email !== ADMIN_EMAIL) return json({ ok: false, message: 'Reset experimental disponível apenas para o administrador principal.' }, 403);
      if (password.length < 8) return json({ ok: false, message: 'A senha deve ter pelo menos 8 caracteres.' }, 400);
      await setJson('auth/config', { email: ADMIN_EMAIL, password_hash: hashPassword(password), updated_at: now() });
      return json({ ok: true, message: 'Senha de teste redefinida com sucesso.' });
    }

    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (email !== ADMIN_EMAIL) return json({ ok: false, message: 'E-mail ou senha inválidos.' }, 401);
      const config = await getJson('auth/config');
      if (!config?.password_hash) return json({ ok: false, message: 'Defina primeiro a senha do ambiente de testes em “Redefinir senha de teste”.' }, 401);
      if (!verifyPassword(password, config.password_hash)) return json({ ok: false, message: 'E-mail ou senha inválidos.' }, 401);
      return json({ ok: true, token: signSession(email, config.password_hash), user: { email } });
    }

    if (action === 'catalog') {
      const token = String(body.token || '');
      const data = await ensureData();
      const index = data.links.findIndex((item) => item.token === token);
      if (index < 0) return json({ ok: false, message: 'Link inválido.' }, 404);
      const link = data.links[index];
      if (new Date(link.expires_at).getTime() < Date.now()) {
        link.status = 'expirado';
        data.links[index] = link;
        await setJson('data/links', data.links);
        return json({ ok: false, message: 'Este link expirou.' }, 410);
      }
      if (link.status === 'cancelado') return json({ ok: false, message: 'Este link foi cancelado.' }, 410);
      if (link.status === 'enviado') return json({ ok: true, link, products: [], already: true });
      if (!link.first_opened_at) link.first_opened_at = now();
      if (link.status === 'gerado') link.status = 'aberto';
      data.links[index] = link;
      await setJson('data/links', data.links);
      const products = data.products
        .filter((p) => p.active !== false && p.catalog_visible !== false && p.base_price != null)
        .map((p) => ({ ...p, catalog_show_price: true }));
      return json({ ok: true, link, products });
    }

    if (action === 'submit_order') {
      const token = String(body.token || '');
      const requested = Array.isArray(body.items) ? body.items : [];
      const data = await ensureData();
      const index = data.links.findIndex((item) => item.token === token);
      if (index < 0) return json({ ok: false, message: 'Link inválido.' }, 404);
      const link = data.links[index];
      if (link.status === 'enviado') return json({ ok: true, request_number: link.request_number, known_total: link.known_total || 0, already: true });
      if (link.status === 'cancelado') return json({ ok: false, message: 'Este link foi cancelado.' }, 410);
      if (new Date(link.expires_at).getTime() < Date.now()) return json({ ok: false, message: 'Este link expirou.' }, 410);
      const items = requested.map((item) => {
        const product = data.products.find((p) => p.id === item.product_id);
        const quantity = Math.max(0, Number(item.quantity || 0));
        if (!product || quantity <= 0 || product.base_price == null) return null;
        const unitPrice = Number(product.base_price || 0);
        return {
          product_id: product.id, product_sku: product.sku, product_name: product.name, quantity,
          unit: product.unit || '', stock_snapshot: Number(product.stock_quantity || 0), price_visible: true,
          unit_price_snapshot: unitPrice,
          subtotal: unitPrice * quantity,
          fulfillment_status: Number(product.stock_quantity || 0) >= quantity ? 'pronta_entrega' : Number(product.stock_quantity || 0) > 0 ? 'parcial' : 'sob_encomenda',
        };
      }).filter(Boolean);
      if (!items.length) return json({ ok: false, message: 'Selecione ao menos um produto com preço cadastrado.' }, 400);
      const knownTotal = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
      const units = items.reduce((sum, item) => sum + item.quantity, 0);
      link.status = 'enviado'; link.submitted_at = now(); link.known_total = knownTotal; link.items_count = items.length; link.units_count = units; link.customer_notes = String(body.notes || '');
      data.links[index] = link;
      data.orders.unshift({ id: uuid(), order_number: orderCode(link.request_number), request_number: link.request_number, customer_id: link.customer_id, customer_name: link.customer_name, created_at: now(), total_amount: knownTotal, status: 'recebido', notes: link.customer_notes, items });
      await Promise.all([setJson('data/links', data.links), setJson('data/orders', data.orders)]);
      return json({ ok: true, request_number: link.request_number, known_total: knownTotal });
    }

    const authConfig = await getJson('auth/config');
    const session = verifySession(bearer(request), authConfig?.password_hash);
    if (!session) return json({ ok: false, message: 'Sessão de teste expirada. Entre novamente.' }, 401);
    if (action === 'session') return json({ ok: true, user: { email: session.email } });

    const data = await ensureData();

    if (action === 'bootstrap') return json({ ok: true, ...data });

    if (action === 'save_client') {
      const input = body.client || {};
      const id = input.id || uuid();
      const client = { id, trade_name: String(input.trade_name || input.name || '').trim(), document: String(input.document || '').trim(), phone: String(input.phone || '').trim(), city: String(input.city || '').trim(), seller_name: 'Guilherme Amaral', created_at: input.created_at || now() };
      if (!client.trade_name) return json({ ok: false, message: 'Informe o nome do cliente.' }, 400);
      const index = data.clients.findIndex((c) => c.id === id);
      if (index >= 0) data.clients[index] = client; else data.clients.unshift(client);
      await setJson('data/clients', data.clients);
      return json({ ok: true, client });
    }

    if (action === 'save_product') {
      const input = body.product || {};
      const id = input.id || uuid();
      const old = data.products.find((p) => p.id === id) || {};
      const parsedPrice = input.base_price === '' || input.base_price == null ? null : Number(input.base_price);
      const product = {
        ...old, id, name: String(input.name || '').trim(), sku: String(input.sku || old.sku || '').trim(), brand: String(input.brand || '').trim(), category: String(input.category || '').trim(), unit: String(input.unit || '').trim(), image_url: String(input.image_url || '').trim(),
        base_price: parsedPrice, stock_quantity: Number(input.stock_quantity || 0), active: input.active !== false, catalog_visible: input.catalog_visible !== false,
        catalog_show_price: parsedPrice != null, catalog_show_stock: input.catalog_show_stock !== false, catalog_allow_backorder: input.catalog_allow_backorder !== false, created_at: old.created_at || now(),
      };
      if (!product.name) return json({ ok: false, message: 'Informe o nome do produto.' }, 400);
      const index = data.products.findIndex((p) => p.id === id);
      if (index >= 0) data.products[index] = product; else data.products.unshift(product);
      await setJson('data/products', data.products);
      return json({ ok: true, product });
    }

    if (action === 'create_link') {
      const client = data.clients.find((c) => c.id === body.customer_id);
      if (!client) return json({ ok: false, message: 'Cliente não encontrado.' }, 404);
      const nextNumber = data.links.reduce((max, item) => Math.max(max, Number(item.request_number || 0)), 0) + 1;
      const link = { id: uuid(), token: randomToken(), request_number: nextNumber, customer_id: client.id, customer_name: client.trade_name, seller_name: 'Guilherme Amaral', status: 'gerado', created_at: now(), expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), first_opened_at: null, submitted_at: null, known_total: 0, items_count: 0, units_count: 0, customer_notes: '' };
      data.links.unshift(link);
      await setJson('data/links', data.links);
      return json({ ok: true, link });
    }

    if (action === 'cancel_link') {
      const index = data.links.findIndex((item) => item.id === body.id);
      if (index < 0) return json({ ok: false, message: 'Link não encontrado.' }, 404);
      data.links[index].status = 'cancelado';
      await setJson('data/links', data.links);
      return json({ ok: true });
    }

    return json({ ok: false, message: 'Ação inválida.' }, 400);
  } catch (error) {
    console.error('Ever Clean test-api:', error);
    return json({ ok: false, message: 'Erro interno no ambiente de testes.' }, 500);
  }
};
