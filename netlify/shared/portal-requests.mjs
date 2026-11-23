// Uma solicitação aprovada no portal ainda pode seguir para pagamento?
// Sim: aprovada e sem cobrança, ou com pagamento pendente e link válido.
// Não: pedido pago, cancelado, estornado, em conferência ou link vencido;
// nesses casos o cliente deve poder fazer um pedido novo com os mesmos itens.
export function requestReusable(row,now=Date.now()){
  if(row?.status!=='quoted')return false;
  if(row.checkout_payment_state&&row.checkout_payment_state!=='payment_pending')return false;
  if(row.checkout_number&&(row.checkout_link_status!=='prepared'||
    !(Date.parse(row.checkout_link_expires_at)>now)))return false;
  return true;
}
