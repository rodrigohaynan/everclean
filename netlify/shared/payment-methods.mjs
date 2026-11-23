// Formas de pagamento do checkout de produção e o tipo correspondente no Asaas.
//
// "link" usa billingType UNDEFINED: a página segura do Asaas deixa o cliente
// escolher como pagar. Depois do pagamento o Asaas grava no billingType a forma
// realmente usada, por isso a conferência aceita qualquer uma delas.

export const PAYMENT_METHODS = {
  pix: {billingType: 'PIX', label: 'PIX'},
  boleto: {billingType: 'BOLETO', label: 'Boleto'},
  cartao: {billingType: 'CREDIT_CARD', label: 'Cartão de crédito'},
  link: {billingType: 'UNDEFINED', label: 'Link de pagamento'},
};

const LINK_PAID_TYPES = new Set(['UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD']);

export const isPaymentMethod = method => Object.hasOwn(PAYMENT_METHODS, String(method || ''));
export const billingTypeFor = method => PAYMENT_METHODS[method]?.billingType || 'PIX';
export const paymentLabel = method => PAYMENT_METHODS[method]?.label || 'PIX';

// A cobrança no Asaas corresponde à forma gravada no pedido?
export function billingTypeMatches(method, billingType) {
  const actual = String(billingType || '').toUpperCase();
  if ((method || 'pix') === 'link') return LINK_PAID_TYPES.has(actual);
  return actual === billingTypeFor(method || 'pix');
}

// Opções de troca depois que a cobrança existe. Boleto só para clientes com
// boleto liberado no cadastro (decisão comercial: prazo e limite de crédito).
export function changeablePaymentMethods(customer) {
  return ['pix', ...(customer?.allow_boleto === true ? ['boleto'] : []), 'cartao', 'link'];
}
