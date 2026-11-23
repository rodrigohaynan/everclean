// Uma solicitação aprovada só pode ser reaproveitada para o carrinho atual se
// ainda estiver aberta: sem cobrança, ou com pagamento pendente, e com o link
// válido. Pedido já pago, cancelado, estornado ou com link vencido não serve:
// o cliente deve conseguir fazer um pedido NOVO com os mesmos itens.
export function findReusableApprovedRequest(requests, selected, qty) {
  if (!Array.isArray(requests) || !selected?.length) return null;
  return requests.find(request => {
    if (request?.status !== 'quoted' || request.checkout_reusable !== true) return false;
    if (!Array.isArray(request.items) || request.items.length !== selected.length) return false;
    return request.items.every(item => {
      const product = selected.find(p => String(p.sku) === String(item.sku));
      return product && Number(qty[product.id]) === Number(item.quantity) &&
        Math.round(Number(product.price) * 100) === Number(item.unit_price_cents);
    });
  }) || null;
}
