// Mesclagem do backup do Bling com o catálogo atual.
//
// Antes, a importação substituía a lista inteira: produtos e clientes
// cadastrados à mão sumiam e os casados com o backup ganhavam um ID novo.
// Links de produção, portal do cliente e pedidos no Postgres guardam esses IDs,
// então um ID trocado deixava pedidos e acessos órfãos.
//
// Regras:
// - registro casado mantém o ID atual e as configurações feitas no painel;
// - registro que não está no backup é mantido;
// - o mapa ID-do-backup → ID-final é devolvido para remapear o histórico.

export const norm = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const skuKey = value => String(value || '').trim().toUpperCase();
const docKey = value => String(value || '').replace(/\D/g, '');
const blingIdFrom = product => {
  const own = String(product?.bling_product_id || '');
  if (/^\d{1,20}$/.test(own)) return own;
  return String(product?.id || '').match(/^bling-product-(\d{1,20})$/)?.[1] || '';
};

// Campos de produto que o painel administra e o backup não deve sobrescrever.
const PRODUCT_LOCAL_FIELDS = [
  'image_url', 'featured', 'on_sale', 'active', 'catalog_visible', 'catalog_show_stock',
  'catalog_allow_backorder', 'stock_source', 'stock_synced_at',
];
// Condições comerciais decididas pela Ever Clean (crédito/boleto) e vínculos externos.
const CLIENT_LOCAL_FIELDS = [
  'allow_boleto', 'payment_methods', 'preferred_payment_method', 'payment_terms', 'credit_limit',
  // Endereço e vínculo com o Bling mantidos no painel.
  'address', 'state_registration', 'bling_contact_id', 'bling_contact_linked_at', 'bling_address_synced',
];

function uniqueIndex(list, keyOf) {
  const counts = new Map(), index = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    index.set(key, item);
  }
  // Chaves repetidas são ambíguas: não usar para casar.
  for (const [key, count] of counts) if (count > 1) index.delete(key);
  return index;
}

export function mergeProducts(existing, incoming, now = new Date().toISOString()) {
  const current = Array.isArray(existing) ? existing : [];
  const bySku = uniqueIndex(current, p => skuKey(p.sku));
  const byBling = uniqueIndex(current, blingIdFrom);
  const byName = uniqueIndex(current, p => norm(p.name));
  const used = new Set(), idMap = {};
  const merged = [];
  let matched = 0, added = 0;

  for (const input of incoming) {
    const candidates = [bySku.get(skuKey(input.sku)), byBling.get(blingIdFrom(input)), byName.get(norm(input.name))];
    const old = candidates.find(c => c && !used.has(c.id));
    if (old) {
      used.add(old.id);
      matched++;
      const local = {};
      for (const field of PRODUCT_LOCAL_FIELDS) if (old[field] !== undefined) local[field] = old[field];
      // Estoque sincronizado ao vivo é mais recente que o do backup.
      if (old.stock_source === 'bling') local.stock_quantity = old.stock_quantity;
      const blingId = blingIdFrom(old) || blingIdFrom(input);
      const product = {
        ...old, ...input, ...local,
        id: old.id,
        ...(blingId ? {bling_product_id: blingId} : {}),
        image_url: String(old.image_url || input.image_url || ''),
        created_at: old.created_at || input.created_at || now,
        updated_at: now,
      };
      if (input.id && input.id !== old.id) idMap[input.id] = old.id;
      merged.push(product);
    } else {
      added++;
      merged.push({...input, created_at: input.created_at || now, updated_at: now});
    }
  }
  // Produto vindo do Bling que não aparece mais entre os ativos do backup fica
  // oculto (antes era apagado). Cadastros manuais permanecem como estão.
  let hidden = 0;
  const kept = current.filter(p => !used.has(p.id)).map(p => {
    if (!blingIdFrom(p) || p.catalog_visible === false) return p;
    hidden++;
    return {...p, catalog_visible: false, hidden_by_backup_at: now, updated_at: now};
  });
  return {items: [...merged, ...kept], idMap, stats: {matched, added, kept: kept.length, hidden}};
}

export function mergeClients(existing, incoming, now = new Date().toISOString()) {
  const current = Array.isArray(existing) ? existing : [];
  const byDoc = uniqueIndex(current, c => {
    const d = docKey(c.document || c.cpf_cnpj);
    return d.length === 11 || d.length === 14 ? d : '';
  });
  const byName = uniqueIndex(current, c => norm(c.trade_name));
  const byLegal = uniqueIndex(current, c => norm(c.legal_name));
  const used = new Set(), idMap = {};
  const merged = [];
  let matched = 0, added = 0;

  for (const input of incoming) {
    const doc = docKey(input.document);
    const candidates = [
      doc.length === 11 || doc.length === 14 ? byDoc.get(doc) : null,
      byName.get(norm(input.trade_name)),
      byLegal.get(norm(input.legal_name)),
    ];
    const old = candidates.find(c => c && !used.has(c.id));
    if (old) {
      used.add(old.id);
      matched++;
      const local = {};
      for (const field of CLIENT_LOCAL_FIELDS) if (old[field] !== undefined) local[field] = old[field];
      merged.push({
        ...old, ...input, ...local,
        id: old.id,
        document: input.document || old.document || '',
        phone: input.phone || old.phone || '',
        email: input.email || old.email || '',
        invoice_email: input.invoice_email || old.invoice_email || input.email || old.email || '',
        created_at: old.created_at || input.created_at || now,
        updated_at: now,
      });
      if (input.id && input.id !== old.id) idMap[input.id] = old.id;
    } else {
      added++;
      merged.push({...input, updated_at: now});
    }
  }
  const kept = current.filter(c => !used.has(c.id));
  return {items: [...merged, ...kept], idMap, stats: {matched, added, kept: kept.length}};
}

// Ajusta IDs de produtos e clientes nos pedidos históricos do backup.
export function remapOrders(orders, productMap = {}, clientMap = {}) {
  return orders.map(order => ({
    ...order,
    customer_id: clientMap[order.customer_id] || order.customer_id,
    items: Array.isArray(order.items)
      ? order.items.map(item => ({...item, product_id: productMap[item.product_id] || item.product_id}))
      : order.items,
  }));
}
