import crypto from 'node:crypto';
import {getJson} from './everclean-bling.mjs';
import {env} from './everclean-asaas.mjs';
import {asaasProduction,asaasCustomer,safeInvoiceUrl} from './everclean-live-checkout.mjs';
import {reserveCheckoutTx,linkPaymentTx} from './everclean-transactional-checkout.mjs';
import {checkoutDb} from './everclean-transactional-checkout.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
// Bling + PDF comercial + fila transacional aceitam no máximo 50 SKUs por pedido.
// Impede cobrança real de pedidos que não possam concluir a exportação e o PDF.
export const MAX_PRODUCTION_ORDER_ITEMS=50;
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
    'SELECT id,request_number,customer_id,customer_name,status,expires_at,'+
    'payment_authorized,payment_authorized_at,payment_max_cents,payment_approved_items '+
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
// Duas autorizações independentes: flag privada + aprovação no link
// com valor máximo e data registrada. Nenhuma delas foi habilitada por este código.
export function generalPaymentEnabled(context){
  return String(env('EVERCLEAN_PUBLIC_CHECKOUT_PIX_ENABLE')||'')==='explicit-approval-v1'&&
    context?.link?.status==='prepared'&&context?.link?.payment_authorized===true&&
    Number(context?.link?.payment_max_cents)>0&&
    Array.isArray(context?.link?.payment_approved_items)&&
    context.link.payment_approved_items.length>0&&
    Boolean(context?.link?.payment_authorized_at)&&
    Date.parse(context.link.expires_at)>Date.now()&&
    Date.parse(context.link.payment_authorized_at)<=Date.now();
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
  const authorized=generalPaymentEnabled(c);
  const approved=authorized?c.link.payment_approved_items:[];
  const allowedSkus=new Set(approved.map(x=>String(x.sku||'').trim()));
  const visible=visibleProducts(c).filter(p=>!authorized||allowedSkus.has(String(p.sku||'').trim()));
  return {
    mode:'general',enabled:authorized,payment_authorized:authorized,
    approved_items:approved.map(x=>({sku:String(x.sku),quantity:Number(x.quantity),
      unit_price_cents:Number(x.unit_price_cents)})),
    approved_amount:authorized?Number(c.link.payment_max_cents)/100:null,
    payment_scope:authorized?'single_link_exact_cart':'preview_only',
    request_number:c.link.request_number,
    customer_name:trim(c.customer.trade_name||c.customer.legal_name||c.customer.name||
      c.link.customer_name).slice(0,160),
    expires_at:c.link.expires_at,
    max_items:MAX_PRODUCTION_ORDER_ITEMS,
    products:visible.map(p=>({
      id:p.id,name:trim(p.name).slice(0,160),sku:trim(p.sku),
      price:Math.round(Number(p.base_price)*100)/100,unit:p.unit||'UN',
      category:trim(p.category||'').slice(0,60),
      availability:Number(p.stock_quantity||0)>0?'pronta_entrega':'sob_encomenda',
      can_order:Number(p.stock_quantity||0)>0||p.catalog_allow_backorder!==false,
      max_quantity:10000
    })),
    message:authorized?'Pagamento piloto exclusivo autorizado: confira os itens e confirme antes de gerar o PIX.':
      'Catálogo de produção em prévia. Pagamentos reais ainda não liberados.'
  };
}
export function generalProductionQuote(c,lines){
  if(!Array.isArray(lines)||!lines.length||lines.length>MAX_PRODUCTION_ORDER_ITEMS)
    throw fail('Selecione entre 1 e 50 produtos diferentes por pedido.');
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
    'SELECT o.state,o.amount_cents,o.requires_stock_review,'+
    'i.state AS bling_export_state,i.bling_order_id '+
    'FROM everclean_private.checkout_orders o '+
    'LEFT JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id '+
    'WHERE o.link_digest=$1 LIMIT 1',[c.digest]
  );
  const order=rows[0];
  return {mode:'general',enabled:generalPaymentEnabled(c),order:order?{
    status:order.state,amount:Number(order.amount_cents)/100,
    requires_stock_review:order.requires_stock_review===true,
    bling_exported:order.state==='paid'&&
      ['sent','already_exists'].includes(order.bling_export_state)&&
      /^\d{1,20}$/.test(String(order.bling_order_id||''))
  }:null};
}


// Exibição do Pix da cobrança já registrada. SOMENTE LEITURA:
// consulta o Neon e os endpoints GET do Asaas. Nunca chama POST /payments,
// nunca cria outra cobrança, nem confirma pagamento sem webhook autenticado.
export async function getGeneralProductionPix(c){
  const {rows}=await checkoutDb().query(
    'SELECT request_number,checkout_reference,payment_id,amount_cents,'+
    'state,payment_state,paid_at FROM everclean_private.checkout_orders '+
    'WHERE link_digest=$1 LIMIT 2',[c.digest]
  );
  if(rows.length!==1)throw fail('Nenhuma cobrança vinculada a este link.',409);
  const order=rows[0];
  if(String(order.request_number)!==String(c.link.request_number))
    throw fail('O pedido não corresponde ao link.',409);
  if(order.state==='paid'||Boolean(order.paid_at))
    return {available:false,paid:true,message:'Pagamento já confirmado pelo sistema.'};
  const id=String(order.payment_id||'');
  const amount=Number(order.amount_cents);
  if(order.state!=='payment_pending'||order.payment_state!=='PENDING'||
    !/^pay_[a-zA-Z0-9_-]{6,100}$/.test(id)||
    !Number.isSafeInteger(amount)||amount<=0||
    !String(order.checkout_reference||'').startsWith('EVERCLEAN-PROD-CATALOG-'))
    throw fail('Pagamento em conferência. Não criar outra cobrança.',409);

  const detail=await asaasProduction('/payments/'+encodeURIComponent(id));
  if(String(detail.id||'')!==id||
     String(detail.externalReference||'')!==String(order.checkout_reference)||
     String(detail.billingType||'')!=='PIX'||
     Math.round(Number(detail.value)*100)!==amount)
    throw fail('Dados do pagamento divergentes. Solicite conferência.',409);
  const fallback=safeInvoiceUrl(detail.invoiceUrl);
  if(String(detail.status||'')!=='PENDING')
    return {available:false,paid:false,
      invoice_url:fallback,
      message:'O Asaas já alterou o estado do pagamento. Atualize a situação antes de pagar.'};

  // GET somente leitura: QR dinâmico da cobrança existente, nunca QR estático.
  const qr=await asaasProduction('/payments/'+encodeURIComponent(id)+'/pixQrCode');
  const image=String(qr.encodedImage||'').replace(/^data:image\/png;base64,/i,'');
  const payload=String(qr.payload||'').trim();
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(image)||image.length>250000||
     image.length<100||image.length%4!==0||
     !/^[\x20-\x7e]+$/.test(payload)||payload.length<25||payload.length>4000)
    throw fail('QR Code indisponível. Utilize a página segura do Asaas.',502);
  const expires=String(qr.expirationDate||'');
  return {available:true,paid:false,amount:amount/100,
    image_base64:image,copy_paste:payload,
    expiration_date:/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+\-Z]+)?$/.test(expires)?expires:null,
    invoice_url:fallback,
    message:'PIX da cobrança existente. A confirmação só ocorre pelo webhook autenticado.'};
}


// Compara quantidade, SKU e preço autorizado, independentemente da ordem da tela.
// Não basta atingir o mesmo total com produtos diferentes.
function approvedCartMatches(approved,quoted){
  if(!Array.isArray(approved)||!Array.isArray(quoted)||approved.length===0||
     approved.length!==quoted.length)return false;
  const entry=(item,key)=>{
    const sku=String(item?.[key]||'').trim();
    const qty=Number(item?.quantity),cents=Number(item?.unit_price_cents);
    if(!sku||!Number.isSafeInteger(qty)||qty<1||
       !Number.isSafeInteger(cents)||cents<1)return null;
    return sku+'|'+qty+'|'+cents;
  };
  const a=approved.map(x=>entry(x,'sku'));
  const b=quoted.map(x=>entry(x,'product_sku'));
  if(a.some(x=>x===null)||b.some(x=>x===null))return false;
  return a.sort().every((value,index)=>value===b.sort()[index]);
}

// Criação de PIX real preparada, porém NEGADA por padrão. Não atende clientes
// até existir autorização específica do link e a variável privada de produção.
// O único ponto com POST /payments fica depois da reserva única no Neon.
export async function createGeneralProductionPix(context,lines){
  if(!generalPaymentEnabled(context))
    throw fail('Cobranças reais do catálogo geral ainda não autorizadas.',403);
  const quote=generalProductionQuote(context,lines);
  const amountCents=Math.round(quote.amount*100);
  if(!approvedCartMatches(context.link.payment_approved_items,quote.items)||
    amountCents!==Number(context.link.payment_max_cents))
    throw fail('Pagamento autorizado apenas para os produtos, quantidades e valor exatos do piloto.',403);
  const validated=await validateGeneralProductionCompletion(context,lines);
  if(!validated.eligible_for_future_payment)
    return {already:true,blocked:true,message:'Pedido já registrado. Não criar outra cobrança.'};
  // Valida e configura notificações do cliente antes da reserva financeira.
  const asaasCustomerId=await asaasCustomer(context.customer);
  const reference='EVERCLEAN-PROD-CATALOG-'+crypto.randomBytes(16).toString('hex');
  const client=await checkoutDb().connect();
  let reserved;
  try{
    await client.query('BEGIN');
    const current=await client.query(
      'SELECT payment_authorized,payment_authorized_at,payment_max_cents,payment_approved_items,status,expires_at '+
      'FROM everclean_private.production_catalog_links WHERE token_digest=$1 FOR UPDATE',
      [context.digest]
    );
    const link=current.rows[0];
    if(!link||link.payment_authorized!==true||
      !link.payment_authorized_at||
      Number(link.payment_max_cents)!==amountCents||
      !approvedCartMatches(link.payment_approved_items,quote.items)||
      link.status!=='prepared'||Date.parse(link.expires_at)<=Date.now()||
      !generalPaymentEnabled({...context,link}))
      throw fail('Autorização financeira revogada ou link expirado.',403);
    const existing=await client.query(
      'SELECT id FROM everclean_private.checkout_orders WHERE request_number=$1 LIMIT 1',
      [String(context.link.request_number)]
    );
    if(existing.rowCount)throw fail('Referência de pedido já utilizada.',409);
    reserved=await reserveCheckoutTx(client,{
      id:crypto.randomUUID(),link_digest:context.digest,reference,
      request_number:String(context.link.request_number),
      customer_id:String(context.customer.id),
      amount_cents:amountCents,items:quote.items,
      requires_stock_review:quote.requires_stock_review
    });
    if(reserved.created){
      const lock=await client.query(
        "UPDATE everclean_private.checkout_orders SET state='creating_payment',updated_at=now() "+
        "WHERE id=$1 AND state='reserved' AND payment_id IS NULL RETURNING id",
        [reserved.record.id]
      );
      if(lock.rowCount!==1)throw fail('Não foi possível reservar a cobrança única.',409);
      const consume=await client.query(
        'UPDATE everclean_private.production_catalog_links '+
        'SET payment_authorized=false WHERE token_digest=$1 AND payment_authorized=true RETURNING id',
        [context.digest]
      );
      if(consume.rowCount!==1)throw fail('Autorização de PIX já consumida.',409);
    }
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
  if(!reserved.created)return {already:true,blocked:true,
    message:'Este link já tem uma tentativa de cobrança. Não repetir.'};
  // Falha ou timeout no POST é INCONCLUSIVO: nunca fazer novo POST com o mesmo link.
  try{
    const dueDate=new Date(Date.now()+48*3600*1000).toISOString().slice(0,10);
    const payment=await asaasProduction('/payments',{
      customer:asaasCustomerId,billingType:'PIX',value:amountCents/100,dueDate,
      description:'Pedido EC-'+context.link.request_number+' Ever Clean Higiene Profissional',
      externalReference:reference
    });
    if(!/^pay_[a-z0-9_-]{6,}$/i.test(String(payment?.id||'')))
      throw fail('Cobrança Asaas sem identificador válido.',502);
    const second=await checkoutDb().connect();
    try{
      await second.query('BEGIN');
      await linkPaymentTx(second,reference,String(payment.id));
      await second.query('COMMIT');
    }catch(error){
      await second.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{second.release();}
    return {already:false,amount:amountCents/100,status:'payment_pending',
      invoice_url:safeInvoiceUrl(payment.invoiceUrl),
      requires_stock_review:quote.requires_stock_review,
      message:'PIX criado. Pagamento só é confirmado pelo webhook autenticado Asaas.'};
  }catch(error){
    await checkoutDb().query(
      "UPDATE everclean_private.checkout_orders SET state='manual_review',updated_at=now() "+
      "WHERE checkout_reference=$1 AND state='creating_payment'",[reference]
    ).catch(()=>{});
    throw fail('Cobrança inconclusiva: não repetir. Verifique o Asaas pela referência '+reference+'.',409);
  }
}
