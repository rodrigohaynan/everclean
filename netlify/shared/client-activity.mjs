// Última compra e histórico dos clientes no admin.
//
// O histórico importado do backup do Bling (last_order_at, order_count,
// historical_revenue) é a base. Por cima entram os pedidos PAGOS pelo
// catálogo. Para não contar duas vezes os pedidos que um backup mais novo do
// Bling já trouxer, só somam ao histórico os pedidos pagos em dia posterior
// ao da última compra do histórico. A data da última compra usa sempre o
// pagamento mais recente.

const ZONE = 'America/Campo_Grande';
const dayKey = value => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('sv-SE', {timeZone: ZONE}) : '';
};

export function mergeCatalogActivity(clients, paidOrders) {
  const byCustomer = new Map();
  for (const order of paidOrders || []) {
    const id = String(order.customer_id || '');
    if (!id || !Number.isFinite(Date.parse(order.paid_at))) continue;
    if (!byCustomer.has(id)) byCustomer.set(id, []);
    byCustomer.get(id).push(order);
  }
  return (clients || []).map(client => {
    const orders = byCustomer.get(String(client.id));
    if (!orders?.length) return client;
    const historyDay = client.last_order_at ? dayKey(client.last_order_at) : '';
    const newer = orders.filter(o => dayKey(o.paid_at) > historyDay);
    const latest = orders.reduce((a, b) => Date.parse(b.paid_at) > Date.parse(a.paid_at) ? b : a);
    const lastPaid = new Date(Date.parse(latest.paid_at)).toISOString();
    const lastOrderAt = client.last_order_at && Date.parse(client.last_order_at) > Date.parse(lastPaid)
      ? client.last_order_at : lastPaid;
    const added = newer.reduce((sum, o) => sum + Number(o.amount_cents || 0), 0) / 100;
    const count = Number(client.order_count || 0) + newer.length;
    const revenue = Number((Number(client.historical_revenue || 0) + added).toFixed(2));
    return {
      ...client,
      last_order_at: lastOrderAt,
      order_count: count,
      historical_revenue: revenue,
      average_ticket: count ? Number((revenue / count).toFixed(2)) : client.average_ticket,
      catalog_order_count: orders.length,
      catalog_last_paid_at: lastPaid,
    };
  });
}
