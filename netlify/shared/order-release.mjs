// Pedido "liberado": vale como pago para a operação (acompanhamento,
// documentos, Bling, nota fiscal), sem mudar o financeiro.
//   - pago (state 'paid'); ou
//   - boleto a prazo de cliente autorizado, ainda aguardando pagamento
//     (state 'payment_pending' com released_at preenchido).
// Boleto cancelado ou estornado muda o state e deixa de valer.

export const RELEASE_BOLETO = 'boleto_prazo';

export const operationalSql = (alias = 'o') =>
  `(${alias}.state='paid' OR (${alias}.state='payment_pending' AND ${alias}.released_at IS NOT NULL))`;

export const isOperational = order => order?.state === 'paid' ||
  (order?.state === 'payment_pending' && Boolean(order?.released_at));

// Liberado mas ainda não pago (boleto a prazo em aberto).
export const isReleasedUnpaid = order => order?.state === 'payment_pending' && Boolean(order?.released_at);
