import crypto from 'node:crypto';
import {getJson,env} from './everclean-asaas.mjs';
import {checkoutDb,reserveCheckoutTx,linkPaymentTx} from './everclean-transactional-checkout.mjs';
import {enforceEmailOnlyNotifications} from './everclean-asaas-notifications.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const digits=value=>String(value||'').replace(/\D/g,'');
const normalizedToken=value=>String(value||'').trim();
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
// Liberação exclusiva do primeiro PIX de homologação. NÃO altera a geração dos
// links normais e NÃO habilita o checkout público geral.
const isEnabled=()=>String(env('ASAAS_PROD_PILOT_PIX_ENABLED')||'').toLowerCase()==='true';
const PILOT_KEY='integrations/asaas-prod/controlled-first-checkout';
const hashToken=value=>sha(String(value||'').trim());
const pilotMatches=(pilot,token)=>Boolean(
  pilot?.token_hash&&pilot.token_hash===hashToken(token)&&
  Number(pilot.max_amount_cents)===700&&
  pilot.sku==='100388'&&Number(pilot.quantity)===1&&
  pilot.expires_at&&new Date(pilot.expires_at).getTime()>Date.now()
);
// A autorização recebida para este teste só abre o PIX do link exclusivo já
// preparado; o segundo fator é a flag privada de implantação. A unicidade de
// link_digest no Neon impede a criação de outra cobrança para esse mesmo piloto.
const pilotCanBill=(pilot,token)=>pilotMatches(pilot,token)&&
  pilot.state==='prepared'&&pilot.billing_authorized===false&&isEnabled();
export const productionCheckoutEnabled=isEnabled;

export const safeInvoiceUrl=value=>{
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&
      (url.hostname==='asaas.com'||url.hostname.endsWith('.asaas.com'))?url.toString():null;
  }catch{return null;}
};
export async function asaasProduction(path,payload,httpMethod){
  const key=String(env('ASAAS_PROD_API_KEY')||'');
  if(key.length<20)throw bad('Conta Asaas Produção não configurada.',503);
  const method=httpMethod||(payload===undefined?'GET':'POST');
  if(!['GET','POST','PUT'].includes(method))throw bad('Método Asaas não permitido.',400);
  const response=await fetch('https://api.asaas.com/v3'+path,{
    method,
    headers:{Accept:'application/json','Content-Type':'application/json',
      access_token:key,'User-Agent':'EverCleanCatalogo/1.0'},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
    signal:AbortSignal.timeout(14000)
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw bad('O Asaas não confirmou a operação. Conferência manual necessária.',502);
  return body||{};
}

async function getContext(token){
  const raw=normalizedToken(token);
  if(!/^[a-z0-9]{24,250}$/i.test(raw))throw bad('Link inválido.',404);
  const pilot=await getJson(PILOT_KEY,null);
  if(!pilotMatches(pilot,raw))throw bad('Este endereço não está autorizado para a homologação controlada.',403);
  const link={
    token:raw,checkout_mode:'production',customer_id:pilot.customer_id,
    customer_name:pilot.customer_name,request_number:pilot.request_number,
    expires_at:pilot.expires_at,status:'gerado'
  };
  const [clients,products]=await Promise.all([
    getJson('data/clients',[]),getJson('data/products',[])
  ]);
  const customer=Array.isArray(clients)?clients.find(c=>String(c.id)===String(link.customer_id)):null;
  if(!customer)throw bad('Cliente não localizado.',400);
  return {link,customer,products:Array.isArray(products)?products:[],token:raw,pilot};
}

export async function catalogProductionPreview(token){
  const {link,customer,products,pilot}=await getContext(token);
  const visible=products.filter(p=>String(p.id)===String(pilot.product_id)&&
    String(p.sku||'')==='100388'&&p?.active!==false&&p?.catalog_visible!==false&&
    p?.base_price!=null&&Number(p.base_price)>0&&String(p.sku||'').trim());
  return {
    enabled:pilotCanBill(pilot,token),
    pilot_prepared:true,
    payment_authorized:pilotCanBill(pilot,token),
    request_number:link.request_number,
    customer_name:String(customer.trade_name||customer.legal_name||link.customer_name||'Cliente').slice(0,160),
    expires_at:link.expires_at,
    products:visible.map(p=>({
      id:p.id,name:String(p.name||'').slice(0,160),sku:p.sku,
      price:Math.round(Number(p.base_price)*100)/100,
      unit:p.unit||'UN',
      availability:Number(p.stock_quantity||0)>0?'pronta_entrega':'sob_encomenda',
      can_order:p.catalog_allow_backorder!==false||Number(p.stock_quantity||0)>0,
      max_quantity:1
    }))
  };
}

export async function validateProductionCart(token,lines){
  const context=await getContext(token),{link,customer,products}=context;
  if(!Array.isArray(lines)||lines.length<1||lines.length>100)
    throw bad('Selecione produtos para o pedido.');
  const seen=new Set();
  let amount=0,backorder=false;
  const items=lines.map(item=>{
    const id=String(item?.product_id||''),qty=Number(item?.quantity);
    if(seen.has(id)||!Number.isSafeInteger(qty)||qty<1||qty>10000)
      throw bad('Produto ou quantidade inválida.');
    seen.add(id);
    const product=products.find(p=>String(p.id)===id&&p.active!==false&&p.catalog_visible!==false);
    if(!product||!String(product.sku||'').trim())throw bad('Produto indisponível.');
    const unitCents=Math.round(Number(product.base_price)*100);
    if(!Number.isSafeInteger(unitCents)||unitCents<1)throw bad('Preço inválido.');
    const stock=Number(product.stock_quantity||0);
    if(product.catalog_allow_backorder===false&&stock<qty)
      throw bad('Quantidade indisponível em estoque.');
    const cents=unitCents*qty;
    if(!Number.isSafeInteger(cents))throw bad('Quantidade fora do limite.');
    amount+=cents;
    if(stock<qty)backorder=true;
    return {product_id:id,product_sku:String(product.sku),product_name:String(product.name||'').slice(0,150),
      quantity:qty,unit_price_cents:unitCents,subtotal_cents:cents,
      fulfillment_status:stock<qty?'sob_encomenda':'pronta_entrega'};
  });
  if(!Number.isSafeInteger(amount)||amount!==700||items.length!==1||
    String(items[0].product_id)!==String(context.pilot.product_id)||
    String(items[0].product_sku)!=='100388'||Number(items[0].quantity)!==1)
    throw bad('Homologação limitada a 1 unidade do SKU 100388, no valor de R$ 7,00.');
  return {context,items,amount_cents:amount,requires_stock_review:backorder};
}

export async function asaasCustomer(customer){
  const document=digits(customer.document||customer.cpf_cnpj);
  if(![11,14].includes(document.length))
    throw bad('Cadastro sem CPF/CNPJ válido para pagamento real.');
  const found=await asaasProduction('/customers?cpfCnpj='+
    encodeURIComponent(document)+'&limit=100');
  const matches=Array.isArray(found?.data)?found.data.filter(row=>
    digits(row?.cpfCnpj)===document&&
    /^cus_[a-zA-Z0-9_-]{5,100}$/.test(String(row?.id||''))):[];
  if(found?.hasMore===true||matches.length>1)
    throw bad('Existem cadastros duplicados no Asaas. '+
      'A associação do cliente precisa ser conferida antes de criar PIX.',409);
  if(matches.length===1){
    const id=String(matches[0].id);
    // Ao reutilizar clientes, impor a mesma política antes de cada cobrança.
    await enforceEmailOnlyNotifications(id,asaasProduction);
    return id;
  }
  const created=await asaasProduction('/customers',{
    name:String(customer.trade_name||customer.legal_name||customer.name||'Cliente Ever Clean').slice(0,200),
    cpfCnpj:document,
    ...(String(customer.email||'').includes('@')?{email:String(customer.email)}:{})
  });
  if(!created?.id)throw bad('Não foi possível vincular cliente à conta Asaas.',502);
  await enforceEmailOnlyNotifications(String(created.id),asaasProduction);
  return String(created.id);
}

async function currentForToken(token){
  const key=sha(normalizedToken(token));
  const {rows}=await checkoutDb().query(
    'SELECT checkout_reference,amount_cents,state,payment_id,request_number,requires_stock_review '+
    'FROM everclean_private.checkout_orders WHERE link_digest=$1',[key]);
  const entry=rows[0];
  if(!entry)return null;
  return {reference:entry.checkout_reference,amount:Number(entry.amount_cents)/100,
    status:entry.state,payment_registered:Boolean(entry.payment_id),
    request_number:entry.request_number,requires_stock_review:entry.requires_stock_review};
}

export async function publicProductionStatus(token){
  const context=await getContext(token);
  return {enabled:pilotCanBill(context.pilot,token),order:await currentForToken(token)};
}

export async function createProductionPix(token,lines){
  if(!isEnabled())throw bad('Checkout de produção ainda bloqueado. Nenhuma cobrança criada.',403);
  const draft=await validateProductionCart(token,lines);
  if(!pilotCanBill(draft.context.pilot,token))throw bad('Piloto ainda não autorizado para receber pagamento real.',403);
  // Falhas de dados de cliente não devem consumir uma reserva.
  if(![11,14].includes(digits(draft.context.customer.document||
    draft.context.customer.cpf_cnpj).length))throw bad('CPF/CNPJ do cliente precisa ser atualizado.');
  // Nunca criar outra cobrança se este link já foi usado.
  const prior=await currentForToken(draft.context.token);
  if(prior)return {already:true,blocked:true,reference:prior.reference,
    message:'Esta solicitação já possui pagamento registrado. Não gere novo PIX.'};
  // Validar notificações ANTES da reserva transacional e ANTES de criar PIX,
  // para evitar consumir o único link quando a API de notificações falhar.
  const customerId=await asaasCustomer(draft.context.customer);
  const ref='EVERCLEAN-PROD-CATALOG-'+crypto.randomBytes(16).toString('hex');
  const tx=await checkoutDb().connect();
  let reservation;
  try{
    await tx.query('BEGIN');
    reservation=await reserveCheckoutTx(tx,{
      id:crypto.randomUUID(),link_digest:sha(draft.context.token),
      reference:ref,request_number:draft.context.link.request_number,
      customer_id:draft.context.customer.id,
      amount_cents:draft.amount_cents,items:draft.items,
      requires_stock_review:draft.requires_stock_review
    });
    if(reservation.created){
      const mark=await tx.query(
        "UPDATE everclean_private.checkout_orders SET state='creating_payment',updated_at=now() "+
        "WHERE id=$1 AND state='reserved' AND payment_id IS NULL RETURNING id",
        [reservation.record.id]);
      if(mark.rowCount!==1)throw bad('Conflito na reserva de pagamento.',409);
    }
    await tx.query('COMMIT');
  }catch(error){
    await tx.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{tx.release();}
  // Se a mesma solicitação já foi registrada, NUNCA criar outra cobrança.
  if(!reservation.created){
    return {already:true,blocked:true,reference:reservation.record.checkout_reference,
      message:'Esta solicitação já possui uma tentativa registrada. Consulte o pedido antes de nova cobrança.'};
  }
  try{
    const dueDate=new Date(Date.now()+48*3600*1000).toISOString().slice(0,10);
    const payment=await asaasProduction('/payments',{
      customer:customerId,billingType:'PIX',value:draft.amount_cents/100,dueDate,
      description:'Pedido EC-'+draft.context.link.request_number+' Ever Clean Higiene Profissional',
      externalReference:ref
    });
    if(!/^pay_[a-z0-9_-]{6,}$/i.test(String(payment.id||'')))
      throw bad('Cobrança sem identificador confirmado. Conferência manual necessária.',502);
    const tx2=await checkoutDb().connect();
    try{
      await tx2.query('BEGIN');
      await linkPaymentTx(tx2,ref,payment.id);
      await tx2.query('COMMIT');
    }catch(error){
      await tx2.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{tx2.release();}
    return {already:false,reference:ref,payment_id_registered:true,
      amount:draft.amount_cents/100,status:'payment_pending',
      invoice_url:safeInvoiceUrl(payment.invoiceUrl),
      requires_stock_review:draft.requires_stock_review,
      message:'Cobrança PIX registrada. A confirmação financeira ocorrerá via Asaas.'};
  }catch(error){
    // Erros inconclusivos podem significar que o Asaas gerou a cobrança.
    // Não tentar POST de criação novamente: manter o mesmo pedido em conferência manual.
    await checkoutDb().query(
      "UPDATE everclean_private.checkout_orders SET state='manual_review',updated_at=now() "+
      "WHERE checkout_reference=$1 AND state='creating_payment'",[ref]).catch(()=>{});
    throw bad('Operação inconclusiva. Consulte o suporte Ever Clean; não repita o pagamento.',409);
  }
}
