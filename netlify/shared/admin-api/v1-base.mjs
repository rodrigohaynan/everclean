import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { readClients, readProducts, updateClients, updateProducts } from '../catalog-store.mjs';

const ADMIN_EMAIL = 'evercleanhigieneprofissional@gmail.com';
// Netlify fornece credenciais temporárias a cada invocação; não manter o cliente Blobs em cache.
const getDataStore = () => getStore({name: 'everclean-test', consistency: 'strong'});

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const randomToken = () => crypto.randomBytes(24).toString('hex');

function json(data, status = 200) {
  return Response.json(data, { status });
}

async function getJson(key, fallback = null) {
  const value = await getDataStore().get(key, { type: 'json', consistency: 'strong' });
  return value === null ? fallback : value;
}

async function setJson(key, value) {
  await getDataStore().setJSON(key, value);
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

// Limite de tentativas de login por IP: 5 falhas em 15 min bloqueiam por 15 min.
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
function loginAttemptsKey(request, context) {
  const ip = String(context?.ip || request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0] || 'desconhecido').trim();
  return 'auth/login-attempts/' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

function bearer(request) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function ensureData() {
  // Produtos e clientes ficam no PostgreSQL (catalog-store); sem dados de exemplo.
  let clients = await readClients();
  let products = await readProducts();
  let links = await getJson('data/links');
  let orders = await getJson('data/orders');
  if (links === null) { links = []; await setJson('data/links', links); }
  if (orders === null) { orders = []; await setJson('data/orders', orders); }

  const needsPriceFlag = (product) => product.base_price != null && product.catalog_show_price !== true;
  if (products.some(needsPriceFlag)) {
    const result = await updateProducts((list) => (list.some(needsPriceFlag)
      ? list.map((product) => (needsPriceFlag(product) ? { ...product, catalog_show_price: true } : product))
      : undefined));
    products = result.value;
  }

  return { clients, products, links, orders };
}

function orderCode(number) {
  return `EC-${String(number || 0).padStart(6, '0')}`;
}

export default async (request, context) => {
  if (request.method !== 'POST') return json({ ok: false, message: 'Método não permitido.' }, 405);

  let body = {};
  try { body = await request.json(); } catch { return json({ ok: false, message: 'Requisição inválida.' }, 400); }
  const action = String(body.action || '');
  if (action === 'submit_order') return json({ok:false,message:'Envie o pedido pelo checkout seguro Asaas da Ever Clean.'},409);

  try {
    // O antigo reset sem autenticação foi desabilitado em todas as versões da API.
    if (action === 'reset_password') {
      return json({ok:false,message:'Redefinição antiga desativada por segurança. Use o código de recuperação configurado no Netlify.'},403);
    }

    if (action === 'secure_set_password') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const supplied = String(body.setup_key || '');
      const configured = String(process.env.EVERCLEAN_ADMIN_SETUP_KEY || '');
      if (email !== ADMIN_EMAIL) return json({ok:false,message:'Usuário inválido.'},403);
      if (password.length < 12 || password.length > 256) return json({ok:false,message:'A senha deve ter entre 12 e 256 caracteres.'},400);
      if (configured.length < 32) return json({ok:false,message:'Configure EVERCLEAN_ADMIN_SETUP_KEY no Netlify com uma chave aleatória de pelo menos 32 caracteres.'},503);
      if (supplied.length < 32 || supplied.length > 512) return json({ok:false,message:'Código de recuperação inválido.'},403);
      const expected = crypto.createHash('sha256').update(configured).digest();
      const provided = crypto.createHash('sha256').update(supplied).digest();
      if (!crypto.timingSafeEqual(expected,provided)) return json({ok:false,message:'Código de recuperação inválido.'},403);
      const used = await getJson('auth/setup-used',null);
      const fingerprint = expected.toString('hex');
      if (used?.fingerprint === fingerprint) return json({ok:false,message:'Este código já foi utilizado. Para recuperar o acesso novamente, gere um novo código no Netlify.'},409);
      const timestamp = now();
      await setJson('auth/config',{email:ADMIN_EMAIL,password_hash:hashPassword(password),updated_at:timestamp,secure_setup_at:timestamp});
      await setJson('auth/setup-used',{fingerprint,used_at:timestamp});
      return json({ok:true,message:'Senha administrativa configurada com segurança. Entre usando sua nova senha.'});
    }

    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const attemptsKey = loginAttemptsKey(request, context);
      const attempts = await getJson(attemptsKey, null);
      const lockedFor = Number(attempts?.locked_until || 0) - Date.now();
      if (lockedFor > 0) {
        const minutes = Math.ceil(lockedFor / 60000);
        return json({ ok: false, message: `Muitas tentativas de acesso. Tente novamente em ${minutes} minuto(s).` }, 429);
      }
      const failed = async () => {
        const recent = attempts && Date.now() - Number(attempts.first_at || 0) < LOGIN_WINDOW_MS;
        const failures = (recent ? Number(attempts.failures || 0) : 0) + 1;
        await setJson(attemptsKey, {
          failures,
          first_at: recent ? attempts.first_at : Date.now(),
          locked_until: failures >= LOGIN_MAX_FAILURES ? Date.now() + LOGIN_LOCK_MS : 0,
        });
        return json({ ok: false, message: 'E-mail ou senha inválidos.' }, 401);
      };
      if (email !== ADMIN_EMAIL) return failed();
      const config = await getJson('auth/config');
      if (!config?.password_hash) return json({ ok: false, message: 'Defina primeiro a senha do ambiente de testes em “Redefinir senha de teste”.' }, 401);
      if (!verifyPassword(password, config.password_hash)) return failed();
      if (attempts) await getDataStore().delete(attemptsKey).catch(() => {});
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
      await updateClients((list) => {
        const index = list.findIndex((c) => c.id === id);
        if (index >= 0) list[index] = client; else list.unshift(client);
        return list;
      });
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
      await updateProducts((list) => {
        const index = list.findIndex((p) => p.id === id);
        if (index >= 0) list[index] = product; else list.unshift(product);
        return list;
      });
      return json({ ok: true, product });
    }

    if (action === 'create_link') {
      return json({ok:false,sandbox_closed:true,
        message:'Homologação encerrada. Gere um link real na área Clientes da Ever Clean.'},410);
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
