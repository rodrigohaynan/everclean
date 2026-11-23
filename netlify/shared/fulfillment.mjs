// Acompanhamento do pedido: etapas, rótulos e histórico de movimentações.
//
// Pedido pago começa em "Pedido recebido". A equipe avança as etapas no admin
// e pode publicar um comentário em cada movimentação (ou só um comentário,
// sem mudar de etapa). O cliente vê a etapa atual e o histórico completo.

export const FULFILLMENT_STAGES = {
  received: 'Pedido recebido',
  preparing: 'Em separação',
  ready_for_delivery: 'Pedido separado',
  out_for_delivery: 'Em rota para entrega',
  delivered: 'Pedido entregue',
  on_hold: 'Aguardando disponibilidade',
};

// Pedidos antigos sem registro (ou com o valor legado awaiting_review)
// estão em "Pedido recebido".
export const normalizeStage = stage =>
  Object.hasOwn(FULFILLMENT_STAGES, String(stage || '')) ? String(stage) : 'received';

export const isStage = stage => Object.hasOwn(FULFILLMENT_STAGES, String(stage || ''));

export const MAX_NOTE = 240;
export const cleanNote = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);

// Histórico de vários pedidos numa consulta. Devolve Map(checkout_order_id → eventos),
// do mais antigo para o mais recente.
export async function fulfillmentEventsFor(db, orderIds, perOrder = 30) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))];
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length) return out;
  const {rows} = await db.query(
    'SELECT checkout_order_id::text AS order_id,previous_stage,new_stage,public_note,created_at ' +
    'FROM (SELECT e.*,row_number() OVER (PARTITION BY checkout_order_id ORDER BY id DESC) AS n ' +
    'FROM everclean_private.order_fulfillment_events e WHERE checkout_order_id = ANY($1::uuid[])) x ' +
    'WHERE n <= $2 ORDER BY id ASC', [ids, perOrder]);
  for (const row of rows) {
    out.get(row.order_id)?.push({
      stage: normalizeStage(row.new_stage),
      label: FULFILLMENT_STAGES[normalizeStage(row.new_stage)],
      stage_changed: normalizeStage(row.previous_stage) !== normalizeStage(row.new_stage),
      note: cleanNote(row.public_note),
      at: row.created_at,
    });
  }
  return out;
}
