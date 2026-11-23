import crypto from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {checkoutDb, databaseConfigured} from './everclean-transactional-checkout.mjs';
import {updateJson} from './blob-update.mjs';

// Produtos e clientes no PostgreSQL (schema everclean_private).
//
// Cada registro é uma linha com o objeto completo em JSONB, no mesmo formato
// que o código sempre usou; a ordem da lista é guardada em `position`.
// Gravações são transacionais e serializadas por coleção (advisory lock), então
// duas operações simultâneas nunca apagam uma à outra.
//
// Carga inicial: no primeiro acesso a coleção é copiada do Netlify Blobs uma
// única vez (registrado em catalog_meta). Depois de cada gravação a lista
// completa também é copiada para o Blobs, para que a versão anterior do site
// continue funcionando se for preciso voltar.
//
// Sem EVERCLEAN_DATABASE_URL (desenvolvimento local), usa o Blobs como antes.

const COLLECTIONS = {
  products: {table: 'everclean_private.catalog_products', blobKey: 'data/products', lock: 7311001},
  clients: {table: 'everclean_private.catalog_clients', blobKey: 'data/clients', lock: 7311002},
};
const STORE_NAME = 'everclean-test';
const blobs = () => getStore({name: STORE_NAME, consistency: 'strong'});

let testDb = null;
// Somente para testes automatizados.
export function __setCatalogTestDb(db) { testDb = db; }

const db = () => testDb || checkoutDb();
const usingDatabase = () => Boolean(testDb) || databaseConfigured();

function spec(name) {
  const value = COLLECTIONS[name];
  if (!value) throw Error('Coleção inválida: ' + name);
  return value;
}

// Garante ID único e texto em cada registro antes de gravar no banco.
export function normalizeRecords(list, name = 'registro') {
  if (!Array.isArray(list)) throw Error(`Lista de ${name} inválida.`);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    let id = String(item.id ?? '').trim();
    if (!id) {
      id = 'sem-id-' + crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 16);
      console.warn(`Catálogo: ${name} sem ID recebeu ${id}.`);
    }
    if (id.length > 300) throw Error(`ID de ${name} muito longo.`);
    let unique = id, n = 2;
    while (seen.has(unique)) unique = `${id}~dup-${n++}`;
    if (unique !== id) console.warn(`Catálogo: ${name} com ID repetido (${id}) gravado como ${unique}.`);
    seen.add(unique);
    out.push(unique === item.id ? item : {...item, id: unique});
  }
  return out;
}

async function seedIfNeeded(client, name) {
  const {table, blobKey, lock} = spec(name);
  const seeded = await client.query('SELECT 1 FROM everclean_private.catalog_meta WHERE collection=$1', [name]);
  if (seeded.rowCount) return false;
  await client.query('SELECT pg_advisory_xact_lock($1)', [lock]);
  const again = await client.query('SELECT 1 FROM everclean_private.catalog_meta WHERE collection=$1', [name]);
  if (again.rowCount) return false;
  const source = await blobs().get(blobKey, {type: 'json', consistency: 'strong'});
  const items = normalizeRecords(Array.isArray(source) ? source : [], name);
  await writeRows(client, table, [], items);
  await client.query(
    'INSERT INTO everclean_private.catalog_meta (collection, seeded_from, seeded_count) VALUES ($1,$2,$3)',
    [name, source === null ? 'vazio' : 'netlify-blobs', items.length]);
  console.log(`Catálogo: ${items.length} ${name} copiados do Blobs para o PostgreSQL.`);
  return true;
}

async function readRows(client, table) {
  const result = await client.query(`SELECT data FROM ${table} ORDER BY position, id`);
  return result.rows.map(row => row.data);
}

// Grava só o que mudou: remove os que saíram, insere/atualiza o resto.
async function writeRows(client, table, previous, next) {
  const before = new Map(previous.map((item, index) => [String(item.id), {json: JSON.stringify(item), index}]));
  const nextIds = new Set(next.map(item => String(item.id)));
  const removed = [...before.keys()].filter(id => !nextIds.has(id));
  if (removed.length) await client.query(`DELETE FROM ${table} WHERE id = ANY($1::text[])`, [removed]);
  const changed = [];
  next.forEach((item, index) => {
    const old = before.get(String(item.id));
    const json = JSON.stringify(item);
    if (!old || old.json !== json || old.index !== index) changed.push({id: String(item.id), index, json});
  });
  for (let i = 0; i < changed.length; i += 200) {
    const chunk = changed.slice(i, i + 200);
    await client.query(
      `INSERT INTO ${table} (id, position, data, updated_at)
       SELECT x.id, x.position, x.data, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, position integer, data jsonb)
       ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, data = EXCLUDED.data, updated_at = now()`,
      [JSON.stringify(chunk.map(c => ({id: c.id, position: c.index, data: JSON.parse(c.json)})))]);
  }
  return {removed: removed.length, written: changed.length};
}

async function mirrorToBlobs(name, items) {
  try {
    await blobs().setJSON(spec(name).blobKey, items);
  } catch (error) {
    console.warn(`Catálogo: cópia de ${name} para o Blobs falhou`, String(error?.message || '').slice(0, 120));
  }
}

export async function readCatalog(name) {
  const {table, blobKey} = spec(name);
  if (!usingDatabase()) {
    const value = await blobs().get(blobKey, {type: 'json', consistency: 'strong'});
    return Array.isArray(value) ? value : [];
  }
  const client = await db().connect();
  try {
    const meta = await client.query('SELECT 1 FROM everclean_private.catalog_meta WHERE collection=$1', [name]);
    if (!meta.rowCount) {
      await client.query('BEGIN');
      try {
        await seedIfNeeded(client, name);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
    return await readRows(client, table);
  } finally {
    client.release();
  }
}

export const readProducts = () => readCatalog('products');
export const readClients = () => readCatalog('clients');

// Altera a coleção numa transação. `mutate` recebe a lista atual e devolve a
// nova lista, ou `undefined` para não gravar. Retorna {written, value}.
export async function updateCatalog(name, mutate) {
  const {table, blobKey, lock} = spec(name);
  if (!usingDatabase()) return updateJson(blobKey, [], mutate);
  const client = await db().connect();
  let result;
  try {
    await client.query('BEGIN');
    await seedIfNeeded(client, name);
    await client.query('SELECT pg_advisory_xact_lock($1)', [lock]);
    const current = await readRows(client, table);
    const next = await mutate(structuredClone(current));
    if (next === undefined) {
      await client.query('COMMIT');
      return {written: false, value: current};
    }
    const items = normalizeRecords(next, name);
    await writeRows(client, table, current, items);
    await client.query('UPDATE everclean_private.catalog_meta SET updated_at=now() WHERE collection=$1', [name]);
    await client.query('COMMIT');
    result = {written: true, value: items};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await mirrorToBlobs(name, result.value);
  return result;
}

export const updateProducts = mutate => updateCatalog('products', mutate);
export const updateClients = mutate => updateCatalog('clients', mutate);

// Substitui a coleção inteira (usado apenas na criação de dados de exemplo).
export const replaceCatalog = (name, items) => updateCatalog(name, () => items);
