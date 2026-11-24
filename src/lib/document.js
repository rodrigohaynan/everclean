// CPF/CNPJ: validação dos dígitos verificadores e formatação.
// Mesmo módulo no navegador e nas funções Netlify.

export const documentDigits = value => String(value ?? '').replace(/\D/g, '');

export function validDocument(raw) {
  const value = documentDigits(raw);
  if (![11, 14].includes(value.length) || /^(\d)\1+$/.test(value)) return false;
  if (value.length === 11) {
    for (let pos = 9; pos <= 10; pos++) {
      const sum = value.slice(0, pos).split('').reduce((acc, d, i) => acc + Number(d) * (pos + 1 - i), 0);
      const expected = (sum * 10) % 11 === 10 ? 0 : (sum * 10) % 11;
      if (Number(value[pos]) !== expected) return false;
    }
    return true;
  }
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const len of [12, 13]) {
    const used = len === 12 ? weights.slice(1) : weights;
    const sum = value.slice(0, len).split('').reduce((acc, d, i) => acc + Number(d) * used[i], 0);
    const digit = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (Number(value[len]) !== digit) return false;
  }
  return true;
}

export function formatDocument(raw) {
  const v = documentDigits(raw);
  if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
}

// Máscara progressiva para o campo (CPF até 11 dígitos, depois CNPJ).
export function maskDocument(raw) {
  const v = documentDigits(raw).slice(0, 14);
  if (v.length <= 11) return v
    .replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return v.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}
