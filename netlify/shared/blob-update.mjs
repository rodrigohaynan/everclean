import {getStore} from '@netlify/blobs';

// Atualização atômica de um documento JSON no Netlify Blobs.
//
// Produtos e clientes ficam em um único documento cada (data/products,
// data/clients). Ler, alterar e gravar sem controle fazia uma gravação apagar a
// outra quando duas aconteciam ao mesmo tempo (ex.: sincronização de estoque
// durante a edição de um produto). Aqui a gravação só acontece se o documento
// não mudou desde a leitura (ETag); se mudou, relê e aplica a alteração de novo.
//
// `mutate(current)` recebe uma cópia do valor atual e devolve o próximo valor.
// Devolver `undefined` encerra sem gravar. A função pode ser chamada mais de uma
// vez, então não deve ter efeitos colaterais além de preencher variáveis locais.

const STORE_NAME = 'everclean-test';
const store = () => getStore({name: STORE_NAME, consistency: 'strong'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class BlobConflictError extends Error {
  constructor(key) {
    super('Os dados foram alterados ao mesmo tempo por outra operação. Tente novamente.');
    this.name = 'BlobConflictError';
    this.status = 409;
    this.key = key;
  }
}

async function readWithEtag(blobs, key) {
  if (typeof blobs.getWithMetadata === 'function') {
    const entry = await blobs.getWithMetadata(key, {type: 'json', consistency: 'strong'});
    if (!entry) return {exists: false, value: null, etag: null};
    return {exists: true, value: entry.data, etag: entry.etag || null};
  }
  const value = await blobs.get(key, {type: 'json', consistency: 'strong'});
  return {exists: value !== null, value, etag: null};
}

export async function updateJson(key, fallback, mutate, {attempts = 6, blobs = null} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const target = blobs || store();
    const {exists, value, etag} = await readWithEtag(target, key);
    const current = exists && value !== null ? value : structuredClone(fallback);
    const next = await mutate(current);
    if (next === undefined) return {written: false, value: current};

    // Sem ETag (biblioteca antiga), cai no comportamento anterior.
    const conditions = etag ? {onlyIfMatch: etag} : (!exists ? {onlyIfNew: true} : undefined);
    const result = conditions
      ? await target.setJSON(key, next, conditions)
      : await target.setJSON(key, next);
    if (result && result.modified === false) {
      await sleep(40 + Math.floor(Math.random() * 120) * (attempt + 1));
      continue;
    }
    return {written: true, value: next};
  }
  throw new BlobConflictError(key);
}
