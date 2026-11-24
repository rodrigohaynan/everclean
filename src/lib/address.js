// Endereço completo do cliente: usado no cadastro (admin), no checkout quando o
// cliente pede nota fiscal e no contato do Bling (a NF-e usa o endereço do contato).
// Mesmo módulo no navegador e nas funções Netlify.

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export const ADDRESS_FIELDS = [
  ['cep', 'CEP'], ['street', 'Rua / avenida'], ['number', 'Número'], ['complement', 'Complemento'],
  ['district', 'Bairro'], ['city', 'Cidade'], ['uf', 'UF'],
];

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const digits = value => String(value ?? '').replace(/\D/g, '');

export function normalizeAddress(input) {
  const a = input && typeof input === 'object' ? input : {};
  return {
    cep: digits(a.cep).slice(0, 8),
    street: text(a.street, 120),
    number: text(a.number, 20),
    complement: text(a.complement, 80),
    district: text(a.district, 80),
    city: text(a.city, 80),
    uf: text(a.uf, 2).toUpperCase(),
  };
}

// Campos que faltam para emitir nota (complemento é opcional).
export function addressIssues(input) {
  const a = normalizeAddress(input);
  const missing = [];
  if (a.cep.length !== 8) missing.push('CEP');
  if (a.street.length < 3) missing.push('rua');
  if (!a.number) missing.push('número');
  if (a.district.length < 2) missing.push('bairro');
  if (a.city.length < 2) missing.push('cidade');
  if (!UFS.includes(a.uf)) missing.push('UF');
  return missing;
}

export const isCompleteAddress = input => addressIssues(input).length === 0;

export function formatAddress(input) {
  const a = normalizeAddress(input);
  if (!a.street) return '';
  const cep = a.cep.length === 8 ? a.cep.slice(0, 5) + '-' + a.cep.slice(5) : a.cep;
  return [
    [a.street, a.number].filter(Boolean).join(', ') + (a.complement ? ' — ' + a.complement : ''),
    a.district, [a.city, a.uf].filter(Boolean).join('/'), cep,
  ].filter(Boolean).join(' · ');
}

// Cadastros antigos têm só "Cidade/UF" em client.city: aproveita para pré-preencher.
export function addressFromClient(client) {
  const base = normalizeAddress(client?.address);
  if (!base.city && client?.city) {
    const [city, uf] = String(client.city).split('/');
    base.city = text(city, 80);
    if (!base.uf && UFS.includes(text(uf, 2).toUpperCase())) base.uf = text(uf, 2).toUpperCase();
  }
  return base;
}

// Inscrição estadual: vazio = não contribuinte; "ISENTO" = isento; números = contribuinte.
export function normalizeStateRegistration(value) {
  const raw = text(value, 20).toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('ISENT')) return 'ISENTO';
  return digits(raw).slice(0, 14);
}

// Endereço no formato do contato do Bling (endereco.geral).
export function blingAddress(input) {
  const a = normalizeAddress(input);
  return {
    endereco: a.street, numero: a.number, complemento: a.complement,
    bairro: a.district, municipio: a.city, uf: a.uf, cep: a.cep,
  };
}

// Consulta de CEP no navegador (ViaCEP). Falha silenciosa: o cliente digita.
export async function lookupCep(cep, fetchImpl = globalThis.fetch) {
  const value = digits(cep);
  if (value.length !== 8 || typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl('https://viacep.com.br/ws/' + value + '/json/',
      {signal: AbortSignal.timeout(5000)});
    const data = await response.json();
    if (!response.ok || data?.erro) return null;
    return {street: text(data.logradouro, 120), district: text(data.bairro, 80),
      city: text(data.localidade, 80), uf: text(data.uf, 2).toUpperCase()};
  } catch {
    return null;
  }
}
