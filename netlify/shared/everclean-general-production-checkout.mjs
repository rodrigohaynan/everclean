import crypto from 'node:crypto';
import {getJson} from './everclean-bling.mjs';
import {checkoutDb} from './everclean-transactional-checkout.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const trim=value=>String(value||'').trim();
const digits=v=>trim(v).replace(/\D/g,'');
const skuKey=v=>trim(v).toUpperCase();
const blingId=v=>/^\d{1,20}$/.test(String(v||''));
const productBling=p=>p.bling_product_id||
  String(p.id||'').match(/^bling-product-(\d+)$/)?.[1];
export async function getGeneralProductionContext(token){
  const text=trim(token);
  if(!/^[a-f0-9]{64}$/.test(text))return null;
  const digest=crypto.createHash('sha256').update(text).digest('hex');
  const {rows}=await checkoutDb().query(
    'SELECT request_number,customer_id,customer_name,status,expires_at '+
    'FROM everclean_private.production_catalog_links WHERE token_digest=$1 AND token=$2 LIMIT 1',
    [digest,text]
  );
  const link=rows[0];
  if(!link)return null;
  if(link.status!=='prepared')throw fail('Este link foi cancelado ou desativado.',410);
  if(Date.parse(link.expires_at)<=Date.now())throw fail('Este link expirou.',410);
  const [clients,products]=await Promise.all([
    getJson('data/clients',[]),getJson('data/products',[])
  ]);
  const customer=Array.isArray(clients)?
    clients.find(c=>String(c.id)===String(link.customer_id)):null;
  if(!customer)throw fail('Cliente não localizado no catálogo.',404);
  return {link,customer,products:Array.isArray(products)?products:[],digest};
}
function enabledProduct(p){
  return p&&p.active!==false&&p.catalog_visible!==false&&
    Number.isFinite(Number(p.base_price))&&Number(p.base_price)>0&&
    trim(p.sku)&&blingId(productBling(p));
}
function visibleProducts(c){
  const skuCounts=new Map();
  for(const p of c.products)if(enabledProduct(p))
    skuCounts.set(skuKey(p.sku),(skuCounts.get(skuKey(p.sku))||0)+1);
  return c.products.filter(p=>enabledProduct(p)&&skuCounts.get(skuKey(p.sku))===1);
}
export function generalProductionCatalog(c){
  return {
    mode:'general',enabled:false,payment_authorized:false,
    request_number:c.link.request_number,
    customer_name:trim(c.customer.trade_name||c.customer.legal_name||c.customer.name||
      c.link.customer_name).slice(0,160),
    expires_at:c.link.expires_at,
    max_items:100,
    products:visibleProducts(c).map(p=>({
      id:p.id,name:trim(p.name).slice(0,160),sku:trim(p.sku),
      price:Math.round(Number(p.base_price)*100)/100,unit:p.unit||'UN',
      category:trim(p.category||'').slice(0,60),
      availability:Number(p.stock_quantity||0)>0?'pronta_entrega':'sob_encomenda',
      can_order:Number(p.stock_quantity||0)>0||p.catalog_allow_backorder!==false,
      max_quantity:10000
    })),
    message:'Catálogo de produção em prévia. Pagamentos reais ainda não liberados.'
  };
}
export function generalProductionQuote(c,lines){
  if(!Array.isArray(lines)||!lines.length||lines.length>100)
    throw fail('Selecione entre 1 e 100 produtos por pedido.');
  if(![11,14].includes(digits(c.customer.document||c.customer.cpf_cnpj).length))
    throw fail('Atualize CPF/CNPJ do cliente antes da compra.');
  const products=visibleProducts(c),seen=new Set();
  let amount=0,requiresReview=false,units=0;
  const items=lines.map(line=>{
    const id=trim(line.product_id),quantity=Number(line.quantity);
    if(seen.has(id)||!Number.isSafeInteger(quantity)||quantity<1||quantity>10000)
      throw fail('Produto repetido ou quantidade inválida.');
    seen.add(id);
    const product=products.find(p=>String(p.id)===id);
    if(!product)throw fail('Produto não disponível no catálogo de produção.');
    const stock=Number(product.stock_quantity||0);
    if(stock<quantity&&product.catalog_allow_backorder===false)
      throw fail('Produto sem estoque suficiente e com encomenda desabilitada.');
    const unit=Math.round(Number(product.base_price)*100),subtotal=unit*quantity;
    if(!Number.isSafeInteger(unit)||unit<=0||!Number.isSafeInteger(subtotal)||subtotal<=0)
      throw fail('Preço ou quantidade inválidos.');
    amount+=subtotal;units+=quantity;
    if(stock<quantity)requiresReview=true;
    return {product_id:id,product_sku:trim(product.sku),
      product_name:trim(product.name).slice(0,150),
      quantity,unit_price_cents:unit,subtotal_cents:subtotal,
      fulfillment_status:stock<quantity?'sob_encomenda':'pronta_entrega'};
  });
  if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000)
    throw fail('Valor total fora do limite do catálogo de produção.');
  return {
    ok:true,mode:'general',payment_authorized:false,
    request_number:c.link.request_number,amount:amount/100,
    item_count:items.length,units,requires_stock_review:requiresReview,items,
    message:'Prévia calculada no servidor sem criar PIX ou pedido.'
  };
}
// Pré-finalização somente LEITURA. Revalida itens/preços no servidor,
// verifica unicidade do link no Neon e não reserva pedido nem gera PIX.
export async function validateGeneralProductionCompletion(c,lines){
  const quote=generalProductionQuote(c,lines);
  const [byLink,byNumber]=await Promise.all([
    checkoutDb().query(
      'SELECT id,state FROM everclean_private.checkout_orders WHERE link_digest=$1 LIMIT 2',
      [c.digest]),
    checkoutDb().query(
      'SELECT id,state FROM everclean_private.checkout_orders WHERE request_number=$1 LIMIT 2',
      [String(c.link.request_number)])
  ]);
  const fresh=byLink.rows.length===0&&byNumber.rows.length===0;
  return {
    ok:true,action:'validate_checkout',preview_only:true,
    eligible_for_future_payment:fresh,
    request_number:String(c.link.request_number),
    amount:quote.amount,item_count:quote.item_count,
    quantity_total:quote.units,
    requires_stock_review:quote.requires_stock_review,
    items:quote.items,
    checks:{
      validated_prices_and_quantities:true,
      valid_customer_document:true,
      unique_origin:fresh,
      valid_unexpired_link:true,
      checked_backorders:true,
      pix_generated:false,
      sale_created:false,
      payment_automation_authorized:false
    },
    message:fresh?
      'Validação final concluída sem cobrança. O checkout público real permanece bloqueado.':
      'Já existe um pedido vinculado a este link/referência. Não criar cobrança duplicada.'
  };
}

export async function generalProductionStatus(c){
  const {rows}=await checkoutDb().query(
    'SELECT state,amount_cents,requires_stock_review FROM everclean_private.checkout_orders '+
    'WHERE link_digest=$1 LIMIT 1',[c.digest]
  );
  const order=rows[0];
  return {mode:'general',enabled:false,order:order?{
    status:order.state,amount:Number(order.amount_cents)/100,
    requires_stock_review:order.requires_stock_review===true
  }:null};
}
