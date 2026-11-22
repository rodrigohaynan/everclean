// Construtor de prévia estritamente local (Neon -> payload de venda Bling v3).
// Não aciona a API do Bling, não envia cobrança, não gera NF-e nem movimenta estoque.
const asId=value=>{
  const raw=String(value??'');
  return /^\d{1,15}$/.test(raw)&&Number.isSafeInteger(Number(raw))?
    Number(raw):null;
};
const catalogId=value=>String(value??'').trim();
export const mappedContactId=customer=>
  asId(customer?.bling_contact_id)||
  asId(String(customer?.id||'').match(/^client-(\d+)$/)?.[1]);
export const mappedProductId=product=>
  asId(product?.bling_product_id)||
  asId(String(product?.id||'').match(/^bling-product-(\d+)$/)?.[1]);
export const blingOrigin=request=>{
  const code=String(request??'').trim();
  if(code==='HOMOLOG-01')return 'EC-HOMOLOG-01';
  return /^[1-9][0-9]{0,9}$/.test(code)?'EC-PROD-'+code:null;
};
const digits=value=>String(value||'').replace(/\D/g,'');
const money=value=>Number((value/100).toFixed(2));

export function buildSafeBlingPreview(order,customer,products,{today}={}){
  const reasons=[];
  const origin=blingOrigin(order?.request_number);
  if(!origin)reasons.push('Referência do pedido inválida.');
  const paid=order?.state==='paid'&&
    ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(String(order?.payment_state||''))&&
    /^pay_[a-z0-9_-]{6,}$/i.test(String(order?.payment_id||''))&&
    /^EVERCLEAN-PROD-CATALOG-[0-9a-f]{32}$/i.test(String(order?.checkout_reference||''))&&
    Boolean(order?.paid_at);
  if(!paid)reasons.push('Pagamento não conciliado completamente no Neon.');
  const clientId=mappedContactId(customer);
  if(!clientId||![11,14].includes(digits(customer?.document||customer?.cpf_cnpj).length))
    reasons.push('Cliente não está vinculado corretamente ao Bling.');
  const entries=Array.isArray(order?.items)?order.items:[];
  if(entries.length===0||entries.length>50)reasons.push('Quantidade de itens inválida.');
  const index=new Map((Array.isArray(products)?products:[])
    .map(p=>[catalogId(p?.id),p]));
  const usedSku=new Set();
  let total=0;
  const items=[];
  for(const item of entries){
    const sku=String(item?.product_sku||'').trim();
    const qty=Number(item?.quantity);
    const unit=Number(item?.unit_price_cents);
    const subtotal=Number(item?.subtotal_cents);
    const prod=index.get(catalogId(item?.product_id));
    const remoteId=mappedProductId(prod);
    const consistent=sku.length>0&&sku.length<=100&&!usedSku.has(sku)&&
      prod&&String(prod.sku||'').trim()===sku&&remoteId&&
      Number.isSafeInteger(qty)&&qty>0&&qty<=10000&&
      Number.isSafeInteger(unit)&&unit>0&&unit<=100000000&&
      Number.isSafeInteger(subtotal)&&subtotal===unit*qty&&
      Number.isSafeInteger(subtotal);
    if(!consistent){
      reasons.push('Produto/SKU, preço ou quantidade sem vínculo válido no Bling.');
    }else{
      items.push({produto:{id:remoteId},quantidade:qty,valor:money(unit)});
      total+=subtotal;
    }
    usedSku.add(sku);
  }
  if(!Number.isSafeInteger(Number(order?.amount_cents))||
    Number(order?.amount_cents)!==total||Number(order?.amount_cents)<1)
    reasons.push('O valor total não coincide com o pagamento registrado.');
  const date=String(today||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))reasons.push('Data local inválida.');
  const uniqueIssues=[...new Set(reasons)];
  // Nunca construir a estrutura exportável quando houver inconsistências.
  if(uniqueIssues.length)return {valid:false,origin_reference:origin,issues:uniqueIssues,payload:null};
  const backorder=order?.requires_stock_review===true;
  const payload={
    data:date,numeroLoja:origin,
    contato:{id:clientId},
    itens:items,
    observacoes:'Ever Clean | pedido '+String(order.request_number)+' | '+
      (String(order.payment_method||'pix')==='boleto'?'Boleto bancario recebido.':'PIX confirmado.'),
    observacoesInternas:'Origem única '+origin+'. '+(backorder?
      'Encomenda: confirmar prazo e disponibilidade. ':
      'Conferir separação e disponibilidade. ')+
      'Estoque, contas e NF-e somente após conferência manual.'
  };
  return {valid:true,origin_reference:origin,amount:money(total),
    item_count:items.length,backorder,issues:[],payload};
}
