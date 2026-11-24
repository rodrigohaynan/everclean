import {mappedContactId} from './everclean-bling-payload.mjs';
import {updateClients} from './catalog-store.mjs';

// Vincula um cliente do catálogo a um contato do Bling pelo CPF/CNPJ.
//
// Clientes importados do Bling já têm o vínculo (id "client-<id Bling>").
// Clientes cadastrados direto no admin não têm, e o pedido deles não podia
// ser enviado ao Bling. Aqui:
//   1. procura no Bling um contato com exatamente o mesmo CPF/CNPJ;
//   2. se não existir, cria o contato (uma única vez; a próxima execução
//      encontra o contato pela busca antes de tentar criar de novo);
//   3. grava bling_contact_id no cadastro do cliente.
// Mais de um contato com o mesmo documento => não escolhe sozinho.

const API = 'https://api.bling.com.br/Api/v3';
const digits = value => String(value || '').replace(/\D/g, '');

export class ContactLinkError extends Error {}

async function call(token, path, {method = 'GET', body, fetchImpl = fetch} = {}) {
  const response = await fetchImpl(API + path, {
    method,
    headers: {
      Accept: 'application/json', Authorization: 'Bearer ' + token,
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  return {ok: response.ok, status: response.status, data};
}

async function findByDocument(token, doc, fetchImpl) {
  const found = new Map();
  for (const query of ['numeroDocumento=' + doc, 'pesquisa=' + doc]) {
    const answer = await call(token, '/contatos?pagina=1&limite=100&' + query, {fetchImpl});
    if (!answer.ok) {
      // Filtro não aceito pela API: tenta a próxima forma de busca.
      if (answer.status === 400 || answer.status === 404) continue;
      throw new ContactLinkError('Bling indisponível ao procurar o cliente (HTTP ' + answer.status + ').');
    }
    for (const contact of Array.isArray(answer.data?.data) ? answer.data.data : []) {
      const id = String(contact?.id ?? '');
      if (/^\d{1,15}$/.test(id) && digits(contact?.numeroDocumento) === doc) found.set(id, contact);
    }
    if (found.size) break;
  }
  return [...found.keys()];
}

function newContact(customer, doc) {
  const name = String(customer.legal_name || customer.trade_name || customer.name || '').trim().slice(0, 120);
  if (!name) throw new ContactLinkError('Cliente sem nome; não é possível cadastrá-lo no Bling.');
  const phone = digits(customer.phone);
  const email = String(customer.invoice_email || customer.email || '').trim();
  const fantasy = String(customer.trade_name || '').trim();
  return {
    nome: name,
    ...(fantasy && fantasy !== name ? {fantasia: fantasy.slice(0, 120)} : {}),
    tipo: doc.length === 14 ? 'J' : 'F',
    situacao: 'A',
    numeroDocumento: doc,
    ...(phone.length >= 10 ? {celular: phone} : {}),
    ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? {email} : {}),
  };
}

async function saveLink(customer, contactId, doc) {
  let conflict = null;
  await updateClients(list => {
    const current = list.find(c => String(c.id) === String(customer.id));
    if (!current) { conflict = 'Cliente não encontrado no cadastro.'; return undefined; }
    if (digits(current.document || current.cpf_cnpj) !== doc) {
      conflict = 'CPF/CNPJ do cliente foi alterado durante o vínculo.'; return undefined;
    }
    if (String(current.bling_contact_id || '') === contactId) return undefined;
    return list.map(c => String(c.id) === String(customer.id)
      ? {...c, bling_contact_id: contactId, bling_contact_linked_at: new Date().toISOString()}
      : c);
  });
  if (conflict) throw new ContactLinkError(conflict);
}

// Retorna o cliente com bling_contact_id preenchido, ou lança ContactLinkError
// com um motivo legível para o admin.
export async function ensureBlingContact(customer, token, {fetchImpl = fetch, save = saveLink} = {}) {
  if (!customer) throw new ContactLinkError('Cliente do pedido não encontrado no cadastro.');
  if (mappedContactId(customer)) return {customer, action: 'existing'};
  const doc = digits(customer.document || customer.cpf_cnpj);
  if (![11, 14].includes(doc.length))
    throw new ContactLinkError('Cliente sem CPF/CNPJ válido; complete o cadastro para enviar ao Bling.');
  if (!token) throw new ContactLinkError('Bling desconectado.');

  let ids = await findByDocument(token, doc, fetchImpl);
  let action = 'linked';
  if (ids.length > 1)
    throw new ContactLinkError('Há mais de um contato no Bling com o CPF/CNPJ deste cliente; una os cadastros no Bling.');
  if (!ids.length) {
    const created = await call(token, '/contatos', {method: 'POST', body: newContact(customer, doc), fetchImpl});
    const id = String(created.data?.data?.id ?? '');
    if (!created.ok || !/^\d{1,15}$/.test(id)) {
      const detail = created.data?.error?.fields?.map?.(f => f?.msg).filter(Boolean).join('; ')
        || created.data?.error?.description || created.data?.error?.message || '';
      throw new ContactLinkError(('Bling recusou o cadastro do cliente' +
        (detail ? ': ' + detail : ' (HTTP ' + created.status + ')') + '.').slice(0, 200));
    }
    ids = [id];
    action = 'created';
  }
  await save(customer, ids[0], doc);
  return {customer: {...customer, bling_contact_id: ids[0]}, action};
}
