import crypto from 'node:crypto';
import {getJson} from './everclean-bling.mjs';
import {env} from './everclean-asaas.mjs';
import {asaasProduction,asaasCustomer,safeInvoiceUrl} from './everclean-live-checkout.mjs';
import {reserveCheckoutTx,linkPaymentTx} from './everclean-transactional-checkout.mjs';
import {checkoutDb} from './everclean-transactional-checkout.mjs';
import {readProducts,readClients,updateClients} from './catalog-store.mjs';
import {addressFromClient,addressIssues,isCompleteAddress,normalizeAddress} from '../../src/lib/address.js';
import {billingTypeFor,changeablePaymentMethods,isPaymentMethod} from './payment-methods.mjs';
import {updateJson} from './blob-update.mjs';
import {fulfillmentEventsFor,normalizeStage} from './fulfillment.mjs';
import {invoicesFor,publicInvoice} from './invoices.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
// Bling + PDF comercial + fila transacional aceitam no máximo 50 SKUs por pedido.
// Impede cobrança real de pedidos que não possam concluir a exportação e o PDF.
export const MAX_PRODUCTION_ORDER_ITEMS=50;
export const DELIVERY_MINIMUM_CENTS=10000;
export const ORDER_MINIMUM_CENTS=500; // Regra comercial Ever Clean: R$ 5,00
export function deliveryGuidance(amountCents){
  const cents=Number(amountCents);
  const eligible=Number.isFinite(cents)&&cents>=DELIVERY_MINIMUM_CENTS;
  return {
    minimum_amount:DELIVERY_MINIMUM_CENTS/100,
    delivery_eligible:eligible,
    fulfillment_option:eligible?'delivery_subject_to_confirmation':'pickup_or_arrange',
    message:eligible?
      'Seu pedido atingiu o mínimo para entrega. Prazo e disponibilidade serão confirmados pela Ever Clean.':
      'Para pedidos abaixo de R$ 100,00, a retirada é na empresa ou a entrega deve ser combinada com a Ever Clean.'
  };
}
const trim=value=>String(value||'').trim();
const digits=v=>trim(v).replace(/\D/g,'');
const skuKey=v=>trim(v).toUpperCase();
const blingId=v=>/^\d{1,20}$/.test(String(v||''));
const safeProductImage=value=>{
  const url=trim(value);
  if(!url||url.length>350000)return null;
  if(/^https:\/\/[^\s]+$/i.test(url))return url;
  if(/^\/(?!\/)[a-zA-Z0-9_./?&=%#-]+$/.test(url))return url;
  if(/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/i.test(url))return url;
  return null;
};

const productBling=p=>p.bling_product_id||
  String(p.id||'').match(/^bling-product-(\d+)$/)?.[1];
export async function getGeneralProductionContext(token){
  const text=trim(token);
  if(!/^[a-f0-9]{64}$/.test(text))return null;
  const digest=crypto.createHash('sha256').update(text).digest('hex');
  const {rows}=await checkoutDb().query(
    'SELECT id,request_number,customer_id,customer_name,status,expires_at,'+
    'payment_authorized,payment_authorized_at,payment_max_cents,payment_approved_items,'+
    'source_request_id,created_at '+
    'FROM everclean_private.production_catalog_links WHERE token_digest=$1 AND token=$2 LIMIT 1',
    [digest,text]
  );
  const link=rows[0];
  if(!link)return null;
  if(link.status!=='prepared')throw fail('Este link foi cancelado ou desativado.',410);
  if(Date.parse(link.expires_at)<=Date.now())throw fail('Este link expirou.',410);
  const [clients,products]=await Promise.all([
    readClients(),readProducts()
  ]);
  const customer=Array.isArray(clients)?
    clients.find(c=>String(c.id)===String(link.customer_id)):null;
  if(!customer)throw fail('Cliente não localizado no catálogo.',404);
  return {link,customer,products:Array.isArray(products)?products:[],digest,token:text};
}
// Proteção independente de produção: apenas links NOVOS, criados após o
// marco de ativação. Todos os links Sandbox e os pilotos antigos ficam intocados.
// A flag pode ser desligada no Netlify para interromper novas cobranças.
// Não habilitar sem chave/limite/data explícitos e nunca permitir links usados.
export function generalPublicRelease(){
  const active=String(env('EVERCLEAN_GENERAL_PRODUCTION_CHECKOUT_ENABLE')||'')==='go-live-v1';
  const at=String(env('EVERCLEAN_GENERAL_PRODUCTION_START_AT')||'');
  const cents=Number(env('EVERCLEAN_GENERAL_PRODUCTION_MAX_CENTS')||0);
  const cutoff=/^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(at)?
    Date.parse(at):NaN;
  const configured=Number.isFinite(cutoff)&&cutoff>0&&cutoff<=Date.now()&&
    Number.isSafeInteger(cents)&&cents>=100&&cents<=1000000;
  return {enabled:active&&configured,cutoff:configured?cutoff:null,
    max_cents:configured?cents:0};
}
function singleCartApproved(context){
  // Aprovações de solicitações do portal usam TAMBÉM a trava geral de produção.
  // Pilotos individuais anteriores continuam isolados dessa nova regra.
  const approvedRequest=Boolean(context?.link?.source_request_id);
  return (!approvedRequest||generalPublicRelease().enabled)&&
    String(env('EVERCLEAN_PUBLIC_CHECKOUT_PIX_ENABLE')||'')==='explicit-approval-v1'&&
    context?.link?.status==='prepared'&&context?.link?.payment_authorized===true&&
    Number(context?.link?.payment_max_cents)>0&&
    Array.isArray(context?.link?.payment_approved_items)&&
    context.link.payment_approved_items.length>0&&
    Boolean(context?.link?.payment_authorized_at)&&
    Date.parse(context.link.expires_at)>Date.now()&&
    Date.parse(context.link.payment_authorized_at)<=Date.now();
}
export function generalLinkReleased(context){
  const release=generalPublicRelease();
  return release.enabled&&context?.link?.status==='prepared'&&
    !context.link.payment_authorized&&!context.link.payment_authorized_at&&
    Number(context.link.payment_max_cents||0)===0&&
    Array.isArray(context.link.payment_approved_items)&&
    context.link.payment_approved_items.length===0&&
    Number.isFinite(Date.parse(context.link.created_at))&&
    Date.parse(context.link.created_at)>release.cutoff&&
    Date.parse(context.link.expires_at)>Date.now();
}
export function generalPaymentEnabled(context){
  return singleCartApproved(context)||generalLinkReleased(context);
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
// Prazo padrão de 30 dias corridos; números explícitos no cadastro (1–90)
// substituem apenas o padrão, nunca o status de habilitação do boleto.
export function boletoTerms(customer){
  const enabled=customer?.allow_boleto===true;
  const match=String(customer?.payment_terms||'').match(/\b(\d{1,2})\s*dias?\b/i);
  const days=match?Number(match[1]):30;
  return {enabled,days:days>=1&&days<=90?days:30};
}
export function dueDateInCampoGrande(days,from=new Date()){
  if(!Number.isInteger(days)||days<1||days>90)
    throw fail('Prazo de boleto inválido.',400);
  const pieces=new Intl.DateTimeFormat('en-US',{timeZone:'America/Campo_Grande',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(from);
  const get=name=>Number(pieces.find(x=>x.type===name)?.value);
  const timestamp=Date.UTC(get('year'),get('month')-1,get('day')+days);
  return new Date(timestamp).toISOString().slice(0,10);
}
export function generalProductionCatalog(c){
  const approvedOnly=singleCartApproved(c);
  const released=generalLinkReleased(c);
  const authorized=approvedOnly||released;
  const approved=approvedOnly?c.link.payment_approved_items:[];
  const allowedSkus=new Set(approved.map(x=>String(x.sku||'').trim()));
  const visible=visibleProducts(c).filter(p=>!approvedOnly||allowedSkus.has(String(p.sku||'').trim()));
  const boleto=boletoTerms(c.customer);
  return {
    mode:'general',enabled:authorized,payment_authorized:authorized,
    // Cartão e link pagos na página segura do Asaas; boleto só para autorizados.
    available_payment_methods:['pix',...(boleto.enabled?['boleto']:[]),'cartao','link'],
    default_payment_method:boleto.enabled?'boleto':null,
    // Depois da cobrança criada, o cliente pode trocar a forma de pagamento.
    change_payment_methods:changeablePaymentMethods(c.customer),
    boleto_due_days:boleto.enabled?boleto.days:null,
    delivery_minimum_amount:DELIVERY_MINIMUM_CENTS/100,
    order_minimum_amount:ORDER_MINIMUM_CENTS/100,
    order_minimum_message:'Pedido mínimo para finalizar: R$ 5,00.',
    delivery_policy:'Pedidos a partir de R$ 100,00 podem solicitar entrega, sujeita a confirmação. Abaixo desse valor: retirada na empresa ou a combinar.',
    approved_items:approved.map(x=>({sku:String(x.sku),quantity:Number(x.quantity),
      unit_price_cents:Number(x.unit_price_cents)})),
    approved_amount:approvedOnly?Number(c.link.payment_max_cents)/100:null,
    payment_scope:approvedOnly?(c.link.source_request_id?
      'approved_customer_request':'single_link_exact_cart'):
      released?'new_link_public':'preview_only',
    max_payment_amount:released?generalPublicRelease().max_cents/100:null,
    request_number:c.link.request_number,
    customer_name:trim(c.customer.trade_name||c.customer.legal_name||c.customer.name||
      c.link.customer_name).slice(0,160),
    // Nota fiscal exige endereço completo: o checkout pede se faltar.
    invoice_address:addressFromClient(c.customer),
    invoice_address_complete:isCompleteAddress(c.customer.address),
    expires_at:c.link.expires_at,
    max_items:MAX_PRODUCTION_ORDER_ITEMS,
    products:visible.map(p=>({
      id:p.id,name:trim(p.name).slice(0,160),sku:trim(p.sku),
      price:Math.round(Number(p.base_price)*100)/100,unit:p.unit||'UN',
      brand:trim(p.brand||'').slice(0,80),
      image_url:safeProductImage(p.image_url),
      sales_orders_count:Math.max(0,Number(p.sales_orders_count)||0),
      category:trim(p.category||'').slice(0,60),
      availability:Number(p.stock_quantity||0)>0?'pronta_entrega':'sob_encomenda',
      can_order:Number(p.stock_quantity||0)>0||p.catalog_allow_backorder!==false,
      max_quantity:10000
    })),
    message:approvedOnly?(c.link.source_request_id?
      'Solicitação aprovada: confira os itens e confirme o PIX real somente se desejar pagar.':
      'Pagamento piloto exclusivo autorizado para este carrinho.'):
      released?'Checkout real disponível para este novo link: confira o pedido antes de gerar o PIX.':
      'Catálogo de produção em prévia. Pagamentos reais ainda não liberados.'
  };
}
// Somente histórico de compra do cliente identificado pelo link sigiloso.
// Não faz alterações nem consulta cobranças existentes ao Asaas.
export async function generalProductionLastOrder(c){
  const {rows}=await checkoutDb().query(
    'SELECT request_number,amount_cents,created_at,items FROM everclean_private.checkout_orders '+
    "WHERE customer_id=$1 AND state='paid' ORDER BY created_at DESC LIMIT 1",
    [String(c.customer.id)]
  );
  const latest=rows[0];
  if(!latest||!Array.isArray(latest.items))return null;
  const valid=new Map(visibleProducts(c).map(p=>[String(p.sku).toUpperCase(),p]));
  const items=latest.items.slice(0,MAX_PRODUCTION_ORDER_ITEMS).map(item=>{
    const product=valid.get(trim(item.product_sku||item.sku).toUpperCase());
    const quantity=Number(item.quantity);
    if(!product||!Number.isSafeInteger(quantity)||quantity<=0||quantity>10000)return null;
    return {product_id:String(product.id),quantity};
  }).filter(Boolean);
  if(!items.length)return null;
  return {request_number:String(latest.request_number),
    total_amount:Number(latest.amount_cents)/100,created_at:latest.created_at,items};
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
    meets_order_minimum:amount>=ORDER_MINIMUM_CENTS,
    order_minimum_amount:ORDER_MINIMUM_CENTS/100,
    missing_for_minimum:Math.max(0,ORDER_MINIMUM_CENTS-amount)/100,
    delivery:deliveryGuidance(amount),
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
    eligible_for_future_payment:fresh&&quote.meets_order_minimum,
    order_minimum_amount:ORDER_MINIMUM_CENTS/100,
    meets_order_minimum:quote.meets_order_minimum,
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
      (generalPaymentEnabled(c)?
        'Pedido validado. Confira os produtos e confirme o pagamento PIX real somente se desejar concluir a compra. Nenhuma cobrança foi criada nesta validação.':
        'Validação concluída sem cobrança. O checkout real deste link ainda está bloqueado.'):
      'Já existe um pedido vinculado a este link/referência. Não criar cobrança duplicada.'
  };
}

export async function generalProductionStatus(c){
  const {rows}=await checkoutDb().query(
    'SELECT o.id::text AS id,o.request_number,o.state,o.payment_state,o.paid_at,'+
    'o.amount_cents,o.requires_stock_review,o.payment_method,o.payment_due_date::text AS payment_due_date,'+
    'i.state AS bling_export_state,i.bling_order_id,'+
    'i.origin_reference AS bling_origin_reference,'+
    'f.stage AS fulfillment_stage,f.public_note AS fulfillment_note,'+
    'f.updated_at AS fulfillment_updated_at '+
    'FROM everclean_private.checkout_orders o '+
    'LEFT JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id '+
    'LEFT JOIN everclean_private.order_fulfillment f ON f.checkout_order_id=o.id '+
    'WHERE o.link_digest=$1 LIMIT 2',[c.digest]
  );
  if(rows.length>1)throw fail('Mais de um pedido vinculado ao link.',409);
  const order=rows[0];
  if(!order)return {mode:'general',enabled:generalPaymentEnabled(c),order:null};
  const isPaid=order.state==='paid'&&
    ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(order.payment_state)&&
    Boolean(order.paid_at);
  const blingExported=isPaid&&
    String(order.request_number)===String(c.link.request_number)&&
    ['sent','already_exists'].includes(order.bling_export_state)&&
    /^\d{1,20}$/.test(String(order.bling_order_id||''))&&
    order.bling_origin_reference==='EC-PROD-'+String(order.request_number);
  const paidAt=Date.parse(order.paid_at||'');
  const pdfExpiry=Number.isFinite(paidAt)?paidAt+90*24*3600*1000:null;
  // Resumo comercial em PDF fica disponível IMEDIATAMENTE após o PIX
  // confirmado no Neon. A versão conciliada com Bling continua opcional,
  // sem atrasar a via que o comprador precisa receber.
  const pdfAvailable=isPaid&&pdfExpiry!==null&&Date.now()<=pdfExpiry;
  const exportState=String(order.bling_export_state||'');
  // Acompanhamento visível ao cliente a partir do pagamento confirmado.
  const events=isPaid?((await fulfillmentEventsFor(checkoutDb(),[order.id])).get(order.id)||[]):[];
  // Nota fiscal autorizada no Bling: o cliente baixa PDF e XML por este link.
  const invoice=isPaid?publicInvoice((await invoicesFor(checkoutDb(),[order.id])).get(order.id)):null;
  return {mode:'general',enabled:generalPaymentEnabled(c),order:{
    status:order.state,amount:Number(order.amount_cents)/100,
    delivery:deliveryGuidance(Number(order.amount_cents)),
    payment_method:order.payment_method||'pix',
    payment_due_date:order.payment_due_date||null,
    requires_stock_review:order.requires_stock_review===true,
    bling_exported:blingExported,
    fulfillment_stage:isPaid?normalizeStage(order.fulfillment_stage):null,
    fulfillment_note:isPaid?String(order.fulfillment_note||'').slice(0,240):'',
    fulfillment_updated_at:isPaid?(order.fulfillment_updated_at||null):null,
    fulfillment_events:events,
    paid_at:isPaid?order.paid_at:null,
    bling_review_required:isPaid&&['inconclusive','blocked','manual_review'].includes(exportState),
    pdf_available:pdfAvailable,
    pdf_expired:isPaid&&!pdfAvailable,
    invoice
  }};
}


// Exibição do Pix da cobrança já registrada. SOMENTE LEITURA:
// consulta o Neon e os endpoints GET do Asaas. Nunca chama POST /payments,
// nunca cria outra cobrança, nem confirma pagamento sem webhook autenticado.
export async function getGeneralProductionPix(c){
  const {rows}=await checkoutDb().query(
    'SELECT request_number,checkout_reference,payment_id,amount_cents,payment_method,'+
    'state,payment_state,paid_at FROM everclean_private.checkout_orders '+
    'WHERE link_digest=$1 LIMIT 2',[c.digest]
  );
  if(rows.length!==1)throw fail('Nenhuma cobrança vinculada a este link.',409);
  const order=rows[0];
  if(String(order.payment_method||'pix')!=='pix')
    throw fail('Este pedido não está com pagamento por PIX. Atualize a página.',409);
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


// Consulta a MESMA cobrança de boleto já emitida, sem criar outro título.
export async function getGeneralProductionBoleto(context){
  const {rows}=await checkoutDb().query(
    'SELECT request_number,checkout_reference,payment_id,amount_cents,'+
    'payment_method,payment_due_date::text AS payment_due_date,state,payment_state,paid_at '+
    'FROM everclean_private.checkout_orders WHERE link_digest=$1 LIMIT 2',
    [context.digest]
  );
  if(rows.length!==1)throw fail('Boleto ainda não disponível neste link.',409);
  const order=rows[0],id=String(order.payment_id||'');
  if(String(order.request_number)!==String(context.link.request_number)||
    String(order.payment_method)!=='boleto')
    throw fail('O boleto não corresponde ao pedido.',409);
  if(order.state==='paid'||Boolean(order.paid_at))
    return {available:false,paid:true};
  if(!/^pay_[a-zA-Z0-9_-]{6,100}$/.test(id)||
    !['payment_pending'].includes(String(order.state))||
    !['PENDING'].includes(String(order.payment_state)))
    throw fail('Boleto em conferência. A equipe pode ajudar.',409);
  const detail=await asaasProduction('/payments/'+encodeURIComponent(id));
  if(String(detail.id||'')!==id||
    String(detail.externalReference||'')!==String(order.checkout_reference)||
    String(detail.billingType||'')!=='BOLETO'||
    Math.round(Number(detail.value)*100)!==Number(order.amount_cents))
    throw fail('Boleto em conferência. Solicite atendimento.',409);
  const boletoUrl=safeInvoiceUrl(detail.bankSlipUrl),
    invoiceUrl=safeInvoiceUrl(detail.invoiceUrl),
    dueDate=String(order.payment_due_date||'').slice(0,10);
  return {available:Boolean(boletoUrl||invoiceUrl),
    paid:false,boleto_url:boletoUrl,invoice_url:invoiceUrl,
    due_date:dueDate,
    message:'Acesse o boleto do pedido, com vencimento em '+dueDate+'.'};
}

// Soma dos boletos em aberto do cliente + este valor não pode passar do limite.
// Chamar com a trava 'everclean-boleto-credit-<cliente>' já obtida.
async function assertBoletoCredit(client,customer,amountCents,excludeOrderId=null){
  const {rows:outstanding}=await client.query(
    'SELECT COALESCE(SUM(amount_cents),0)::bigint AS total '+
    'FROM everclean_private.checkout_orders '+
    "WHERE customer_id=$1 AND payment_method='boleto' "+
    "AND state IN ('reserved','creating_payment','payment_pending','manual_review') "+
    'AND ($2::uuid IS NULL OR id<>$2::uuid)',
    [String(customer.id),excludeOrderId]
  );
  const custom=Number(customer.credit_limit||0);
  const customCents=Number.isFinite(custom)&&custom>0?Math.round(custom*100):0;
  const safeLimit=generalPublicRelease().max_cents||amountCents;
  const creditCap=customCents>0?customCents:safeLimit;
  if(!Number.isSafeInteger(creditCap)||creditCap<1||
    Number(outstanding[0]?.total||0)+amountCents>creditCap)
    throw fail('O limite para compras a prazo foi atingido. Entre em contato com a Ever Clean.',409);
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
async function saveCustomerAddress(customer,address){
  await updateClients(list=>{
    const current=list.find(x=>String(x.id)===String(customer.id));
    // Não sobrescreve um endereço completo gravado em paralelo (ex.: pelo admin).
    if(!current||isCompleteAddress(current.address))return undefined;
    return list.map(x=>String(x.id)===String(customer.id)?{...x,address,
      city:[address.city,address.uf].join('/'),
      address_source:'checkout',updated_at:new Date().toISOString()}:x);
  });
}
export async function createGeneralProductionPix(context,lines,options={}){
  const method=String(options?.payment_method||'');
  if(!['pix','boleto','cartao','link'].includes(method))
    throw fail('Selecione uma forma de pagamento disponível.',400);
  const boleto=boletoTerms(context.customer);
  if(method==='boleto'&&!boleto.enabled)
    throw fail('Boleto não autorizado para este cliente. Escolha outra forma de pagamento.',403);
  const dueDate=method==='boleto'?dueDateInCampoGrande(boleto.days):
    method==='pix'?new Date(Date.now()+48*3600*1000).toISOString().slice(0,10):
    dueDateInCampoGrande(2);
  const notes=String(options?.notes||'').trim();
  if(notes.length>2000)
    throw fail('As observações devem ter no máximo 2.000 caracteres.',400);
  const invoiceRequested=options?.invoice_requested===true;
  const invoiceChannel=invoiceRequested?String(options?.invoice_channel||'').trim():'';
  const invoiceContact=invoiceRequested?String(options?.invoice_contact||'').trim():'';
  if(invoiceRequested){
    if(invoiceChannel==='email'){
      if(invoiceContact.length>254||
         !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(invoiceContact))
        throw fail('Informe um e-mail válido para a nota fiscal.',400);
    }else if(invoiceChannel==='whatsapp'){
      const number=invoiceContact.replace(/\D/g,'');
      if(number.length<10||number.length>13)
        throw fail('Informe um WhatsApp válido para a nota fiscal.',400);
    }else throw fail('Selecione e-mail ou WhatsApp para a nota fiscal.',400);
  }
  if(!generalPaymentEnabled(context))
    throw fail('Cobranças reais do catálogo geral ainda não autorizadas.',403);
  // Nota fiscal pedida sem endereço completo no cadastro: o endereço é
  // obrigatório e fica salvo no cliente (vai para o contato do Bling).
  if(invoiceRequested&&!isCompleteAddress(context.customer.address)){
    const provided=normalizeAddress(options?.invoice_address);
    const missing=addressIssues(provided);
    if(missing.length)
      throw fail('Para emitir a nota fiscal, informe o endereço completo. Falta: '+missing.join(', ')+'.',400);
    await saveCustomerAddress(context.customer,provided);
    context.customer={...context.customer,address:provided};
  }
  const quote=generalProductionQuote(context,lines);
  const amountCents=Math.round(quote.amount*100);
  // Bloqueia antes de reservar pedido ou chamar o Asaas. A prévia continua
  // disponível para que o comprador saiba quanto falta no carrinho.
  if(amountCents<ORDER_MINIMUM_CENTS)
    throw fail('Pedido mínimo R$ 5,00. Adicione mais produtos para finalizar.',400);
  // A cobrança deve corresponder exatamente ao total que o cliente confirmou.
  // Se preços mudaram entre a prévia automática e esta transação, bloquear.
  if(options.expected_amount_cents!==undefined){
    const expected=Number(options.expected_amount_cents);
    if(!Number.isSafeInteger(expected)||expected!==amountCents)
      throw fail('O valor do pedido foi atualizado. Revise os produtos e confirme novamente.',409);
  }
  // Aprovação automática só vale enquanto o estoque de TODOS os itens
  // for suficiente. Conferir NOVAMENTE no momento anterior à cobrança.
  if(context.link.source_request_id){
    const gate=await checkoutDb().query(
      'SELECT status,approval_source,amount_cents,customer_id '+
      'FROM everclean_private.customer_portal_order_requests WHERE id=$1 LIMIT 2',
      [context.link.source_request_id]
    );
    const request=gate.rows.length===1?gate.rows[0]:null;
    if(!request||request.status!=='quoted'||
      String(request.customer_id)!==String(context.customer.id)||
      Number(request.amount_cents)!==amountCents)
      throw fail('A solicitação não possui aprovação válida para este pagamento.',409);
    if(request.approval_source==='automatic_stock'&&quote.requires_stock_review)
      throw fail('O estoque mudou. O pedido precisa de confirmação da equipe antes do PIX.',409);
  }
  const publicCheckout=generalLinkReleased(context);
  if(publicCheckout){
    if(amountCents>generalPublicRelease().max_cents)
      throw fail('Pedido acima do limite inicial do checkout de produção. Solicite atendimento.',403);
  }else if(!approvedCartMatches(context.link.payment_approved_items,quote.items)||
    amountCents!==Number(context.link.payment_max_cents))
    throw fail('Pagamento autorizado apenas para o carrinho exato do piloto.',403);
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
      'SELECT payment_authorized,payment_authorized_at,payment_max_cents,payment_approved_items,'+
      'source_request_id,status,created_at,expires_at '+
      'FROM everclean_private.production_catalog_links WHERE token_digest=$1 FOR UPDATE',
      [context.digest]
    );
    const link=current.rows[0];
    const liveContext={...context,link};
    const publicNow=generalLinkReleased(liveContext);
    const pilotNow=singleCartApproved(liveContext)&&
      Number(link.payment_max_cents)===amountCents&&
      approvedCartMatches(link.payment_approved_items,quote.items);
    if(!link||link.status!=='prepared'||Date.parse(link.expires_at)<=Date.now()||
      !(publicCheckout?publicNow&&amountCents<=generalPublicRelease().max_cents:pilotNow))
      throw fail('Autorização de produção revogada ou link expirado.',403);
    const existing=await client.query(
      'SELECT id FROM everclean_private.checkout_orders WHERE request_number=$1 LIMIT 1',
      [String(context.link.request_number)]
    );
    if(existing.rowCount)throw fail('Referência de pedido já utilizada.',409);
    if(method==='boleto'){
      // Serializa cobranças a prazo por cliente para impedir dois checkouts
      // simultâneos de excederem o crédito total em aberto.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
        ['everclean-boleto-credit-'+String(context.customer.id)]);
      await assertBoletoCredit(client,context.customer,amountCents);
    }
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
      // Solicitações do comprador ficam no pedido reservado na mesma transação;
      // não em campos de produto, não em uma venda duplicada no Bling.
      const saved=await client.query(
        'UPDATE everclean_private.checkout_orders SET payment_method=$2,'+
        'customer_notes=$3,invoice_requested=$4,invoice_channel=$5,'+
        'invoice_contact=$6,payment_due_date=$7::date,updated_at=now() '+
        'WHERE id=$1 AND state=$8 RETURNING id',
        [reserved.record.id,method,notes,invoiceRequested,
          invoiceRequested?invoiceChannel:null,
          invoiceRequested?invoiceContact:null,dueDate,'creating_payment']
      );
      if(saved.rowCount!==1)throw fail('Não foi possível registrar as preferências do pedido.',409);
      if(!publicNow){
        const consume=await client.query(
          'UPDATE everclean_private.production_catalog_links '+
          'SET payment_authorized=false WHERE token_digest=$1 AND payment_authorized=true RETURNING id',
          [context.digest]
        );
        if(consume.rowCount!==1)throw fail('Autorização de PIX já consumida.',409);
      }
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
    const charge={
      customer:asaasCustomerId,billingType:billingTypeFor(method),
      value:amountCents/100,dueDate,
      description:'Pedido EC-'+context.link.request_number+' Ever Clean Higiene Profissional',
      externalReference:reference
    };
    const payment=await asaasProduction('/payments',charge);
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
    // Cartão/link: pedir ao Asaas para devolver o cliente ao pedido depois de
    // pagar. Feito à parte (PUT idempotente) para nunca arriscar um segundo
    // POST; se o Asaas recusar o domínio, a cobrança segue normalmente.
    const returnUrl=['cartao','link'].includes(method)?paymentReturnUrl(context.token):null;
    if(returnUrl){
      try{
        await asaasProduction('/payments/'+encodeURIComponent(payment.id),
          {billingType:charge.billingType,value:charge.value,dueDate,
            description:charge.description,externalReference:reference,
            callback:{successUrl:returnUrl,autoRedirect:true}},'PUT');
      }catch{
        console.warn('Ever Clean: Asaas recusou o retorno automático na criação.');
      }
    }
    return {already:false,amount:amountCents/100,status:'payment_pending',
      payment_method:method,due_date:dueDate,
      invoice_url:safeInvoiceUrl(payment.invoiceUrl),
      boleto_url:method==='boleto'?safeInvoiceUrl(payment.bankSlipUrl):null,
      requires_stock_review:quote.requires_stock_review,
      message:method==='boleto'?
        'Boleto disponível com vencimento em '+dueDate+'. O pedido será confirmado após o pagamento.':
        method==='cartao'?'Cobrança pronta. Pague com cartão na página segura do Asaas.':
        method==='link'?'Link de pagamento pronto. Escolha como pagar na página segura do Asaas.':
        'PIX disponível. O pedido será confirmado após o pagamento.'};
  }catch(error){
    await checkoutDb().query(
      "UPDATE everclean_private.checkout_orders SET state='manual_review',updated_at=now() "+
      "WHERE checkout_reference=$1 AND state='creating_payment'",[reference]
    ).catch(()=>{});
    throw fail('Cobrança inconclusiva: não repetir. Verifique o Asaas pela referência '+reference+'.',409);
  }
}


const PENDING_ASAAS=new Set(['PENDING','OVERDUE']);
const PAID_ASAAS=new Set(['RECEIVED','CONFIRMED','RECEIVED_IN_CASH']);

async function pendingOrderFor(db,context){
  const {rows}=await db.query(
    'SELECT id,request_number,checkout_reference,payment_id,amount_cents,payment_method,'+
    'payment_due_date::text AS payment_due_date,state,payment_state,paid_at,customer_id '+
    'FROM everclean_private.checkout_orders WHERE link_digest=$1 LIMIT 2',[context.digest]);
  if(rows.length!==1)throw fail('Nenhuma cobrança vinculada a este link.',409);
  const order=rows[0];
  if(String(order.request_number)!==String(context.link.request_number)||
     String(order.customer_id)!==String(context.customer.id))
    throw fail('O pedido não corresponde ao link.',409);
  return order;
}

function assertChangeable(order){
  if(order.state==='paid'||order.paid_at)
    throw fail('Pagamento já confirmado. Não é possível trocar a forma de pagamento.',409);
  if(order.state!=='payment_pending'||order.payment_state!=='PENDING'||
     !/^pay_[a-zA-Z0-9_-]{6,100}$/.test(String(order.payment_id||''))||
     !String(order.checkout_reference||'').startsWith('EVERCLEAN-PROD-CATALOG-')||
     !Number.isSafeInteger(Number(order.amount_cents))||Number(order.amount_cents)<=0)
    throw fail('Pagamento em conferência. Fale com a Ever Clean para trocar a forma de pagamento.',409);
}

// Cartão ou link: devolve a página segura do Asaas da MESMA cobrança.
// Somente leitura; nunca cria cobrança.
export async function getGeneralProductionInvoice(context){
  const order=await pendingOrderFor(checkoutDb(),context);
  if(order.state==='paid'||order.paid_at)return {available:false,paid:true};
  if(!['cartao','link'].includes(String(order.payment_method)))
    throw fail('Este pedido não está com pagamento por cartão ou link.',409);
  assertChangeable(order);
  const detail=await asaasProduction('/payments/'+encodeURIComponent(order.payment_id));
  if(String(detail.id||'')!==String(order.payment_id)||
     String(detail.externalReference||'')!==String(order.checkout_reference)||
     Math.round(Number(detail.value)*100)!==Number(order.amount_cents))
    throw fail('Dados do pagamento divergentes. Solicite conferência.',409);
  const invoiceUrl=safeInvoiceUrl(detail.invoiceUrl);
  return {available:Boolean(invoiceUrl),paid:PAID_ASAAS.has(String(detail.status||'')),
    payment_method:order.payment_method,invoice_url:invoiceUrl,
    due_date:String(order.payment_due_date||'').slice(0,10)||null};
}

// Endereço para onde o Asaas devolve o cliente depois de pagar com cartão ou
// link. O Asaas só aceita URL do domínio cadastrado nos dados comerciais da
// conta; se recusar, a troca continua sem o retorno automático.
export function paymentReturnUrl(token){
  const base=String(env('EVERCLEAN_SITE_URL')||'https://evercleancatalogo.netlify.app').replace(/\/+$/,'');
  if(!/^https:\/\/[a-z0-9.-]+$/i.test(base)||!/^[a-f0-9]{64}$/.test(String(token||'')))return null;
  return base+'/pedido-producao/'+token+'?pagamento=retorno';
}

// Troca a forma de pagamento da MESMA cobrança no Asaas (PUT /payments/{id}).
// Mesmo ID, mesma referência e mesmo valor: o webhook e o envio ao Bling
// continuam reconhecendo o pedido. Nunca cria uma segunda cobrança.
export async function changeGeneralProductionPayment(context,requested){
  const method=String(requested||'');
  if(!isPaymentMethod(method))throw fail('Forma de pagamento inválida.',400);
  if(!changeablePaymentMethods(context.customer).includes(method))
    throw fail(method==='boleto'?'Boleto não liberado para este cliente. Escolha outra forma.':
      'Forma de pagamento indisponível.',403);
  const db=await checkoutDb().connect();
  try{
    const first=await pendingOrderFor(db,context);
    // Uma troca por pedido de cada vez (cliques repetidos, duas abas).
    await db.query('SELECT pg_advisory_lock(hashtext($1))',['everclean-payment-change-'+first.id]);
    if(method==='boleto')
      await db.query('SELECT pg_advisory_lock(hashtext($1))',
        ['everclean-boleto-credit-'+String(context.customer.id)]);
    const order=await pendingOrderFor(db,context);
    assertChangeable(order);
    const amountCents=Number(order.amount_cents);
    const current=String(order.payment_method||'pix');
    if(current===method)return {changed:false,payment_method:method,
      due_date:String(order.payment_due_date||'').slice(0,10)||null};
    if(method==='boleto')await assertBoletoCredit(db,context.customer,amountCents,order.id);
    // Evita uso abusivo da API do Asaas: no máximo 10 trocas por pedido.
    const counter=await updateJson('payment-changes/'+order.id,{count:0},
      c=>({count:Number(c?.count||0)+1,at:new Date().toISOString()}));
    if(Number(counter.value?.count)>10)
      throw fail('Limite de trocas atingido para este pedido. Fale com a Ever Clean.',429);

    const detail=await asaasProduction('/payments/'+encodeURIComponent(order.payment_id));
    if(String(detail.id||'')!==String(order.payment_id)||
       String(detail.externalReference||'')!==String(order.checkout_reference)||
       Math.round(Number(detail.value)*100)!==amountCents)
      throw fail('Dados do pagamento divergentes. Solicite conferência.',409);
    const remote=String(detail.status||'').toUpperCase();
    if(PAID_ASAAS.has(remote))
      throw fail('O pagamento já foi identificado pelo Asaas. Aguarde a confirmação nesta página.',409);
    if(!PENDING_ASAAS.has(remote))
      throw fail('Esta cobrança não pode mais ser alterada. Fale com a Ever Clean.',409);

    const target=billingTypeFor(method);
    const dueDate=method==='boleto'?dueDateInCampoGrande(boletoTerms(context.customer).days):
      dueDateInCampoGrande(2);
    // Se uma tentativa anterior já trocou no Asaas (ex.: tempo esgotado antes de
    // gravar no banco), não repetir o PUT; só registrar.
    const body={
      billingType:target,value:amountCents/100,dueDate,
      description:'Pedido EC-'+context.link.request_number+' Ever Clean Higiene Profissional',
      externalReference:order.checkout_reference
    };
    const returnUrl=['cartao','link'].includes(method)?paymentReturnUrl(context.token):null;
    let updated=detail,returnConfigured=false;
    if(String(detail.billingType||'').toUpperCase()!==target){
      if(returnUrl){
        // PUT é idempotente: se o Asaas recusar o retorno (domínio não
        // cadastrado), repetir a mesma alteração sem ele.
        try{
          updated=await asaasProduction('/payments/'+encodeURIComponent(order.payment_id),
            {...body,callback:{successUrl:returnUrl,autoRedirect:true}},'PUT');
          returnConfigured=true;
        }catch(error){
          console.warn('Ever Clean: Asaas recusou o retorno automático; trocando sem ele.');
          updated=await asaasProduction('/payments/'+encodeURIComponent(order.payment_id),body,'PUT');
        }
      }else{
        updated=await asaasProduction('/payments/'+encodeURIComponent(order.payment_id),body,'PUT');
      }
    }
    if(String(updated.id||'')!==String(order.payment_id)||
       String(updated.billingType||'').toUpperCase()!==target||
       String(updated.externalReference||'')!==String(order.checkout_reference)||
       Math.round(Number(updated.value)*100)!==amountCents)
      throw fail('O Asaas não confirmou a troca. Atualize a página antes de tentar de novo.',502);
    const finalDue=/^\d{4}-\d{2}-\d{2}$/.test(String(updated.dueDate||''))?updated.dueDate:dueDate;
    const saved=await db.query(
      'UPDATE everclean_private.checkout_orders SET payment_method=$2,payment_due_date=$3::date,'+
      "updated_at=now() WHERE id=$1 AND state='payment_pending' AND payment_id=$4 RETURNING id",
      [order.id,method,finalDue,order.payment_id]);
    if(saved.rowCount!==1)
      throw fail('O pedido mudou durante a troca. Atualize a página para ver a situação.',409);
    console.log('Ever Clean: forma de pagamento alterada',
      String(context.link.request_number),current,'->',method);
    return {changed:true,payment_method:method,due_date:finalDue,return_configured:returnConfigured,
      invoice_url:safeInvoiceUrl(updated.invoiceUrl),
      boleto_url:method==='boleto'?safeInvoiceUrl(updated.bankSlipUrl):null};
  }finally{
    await db.query('SELECT pg_advisory_unlock_all()').catch(()=>{});
    db.release();
  }
}
