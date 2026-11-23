import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {readProducts,readClients} from '../shared/catalog-store.mjs';

// Fila de leitura/auditoria. NÃO cria pedido Bling, cobrança PIX, nota ou baixa de estoque.
// O envio automático de produção requer uma implementação transacional independente
// e homologação expressa; este endpoint não contém qualquer operação de escrita.
const BLING='https://api.bling.com.br/Api/v3';
const numberId=value=>{
  const str=String(value??'');
  return /^\d{1,20}$/.test(str)?str:null;
};
const contactId=c=>numberId(c?.bling_contact_id)||
  numberId(String(c?.id||'').match(/^client-(\d+)$/)?.[1]);
const productId=p=>numberId(p?.bling_product_id)||
  numberId(String(p?.id||'').match(/^bling-product-(\d+)$/)?.[1]);
const digits=value=>String(value||'').replace(/\D/g,'');
const safePayment=value=>/^pay_[a-z0-9_-]{6,}$/i.test(String(value||''));
const safeAsaasReference=value=>/^EVERCLEAN-PROD-CATALOG-[a-f0-9]{32}$/i.test(String(value||''));
const referenceFor=request=>{
  const n=String(request||'').trim();
  if(n==='HOMOLOG-01')return 'EC-HOMOLOG-01';
  if(!/^[0-9]{1,10}$/.test(n))return null;
  return 'EC-PROD-'+n;
};
const wait=duration=>new Promise(resolve=>setTimeout(resolve,duration));

async function remote(path,token){
  const response=await fetch(BLING+path,{
    headers:{Accept:'application/json',Authorization:'Bearer '+token,'enable-jwt':'1'},
    signal:AbortSignal.timeout(14000)
  });
  if(!response.ok){
    const error=new Error('Consulta do Bling indisponível (HTTP '+response.status+').');
    error.status=response.status;
    throw error;
  }
  const result=await response.json().catch(()=>null);
  if(!result||typeof result!=='object')throw Error('Resposta inválida do Bling.');
  return result;
}

function reviewPaidOrder(order,clients,products,legacyExport){
  const reasons=[];
  const ref=referenceFor(order.request_number);
  if(!ref)reasons.push('Número do pedido fora do padrão seguro para referência.');
  if(order.state!=='paid'||!['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(order.payment_state)||
    !safePayment(order.payment_id)||!safeAsaasReference(order.checkout_reference)||!order.paid_at)
    reasons.push('Pagamento não está integralmente conciliado no Neon.');
  const items=Array.isArray(order.items)?order.items:[];
  if(items.length<1||items.length>50)reasons.push('Quantidade de produtos fora do limite.');
  const catalog=new Map((Array.isArray(products)?products:[]).map(p=>[String(p.id),p]));
  const seenSkus=new Set();
  let total=0;
  let validItems=true;
  let linkedProducts=0;
  for(const item of items){
    const sku=String(item.product_sku||'').trim();
    const qty=Number(item.quantity);
    const unit=Number(item.unit_price_cents);
    const subtotal=Number(item.subtotal_cents);
    const product=catalog.get(String(item.product_id||''));
    if(!sku||seenSkus.has(sku)||!Number.isSafeInteger(qty)||qty<=0||qty>10000||
      !Number.isSafeInteger(unit)||unit<=0||
      !Number.isSafeInteger(subtotal)||subtotal!==qty*unit||
      !product||String(product.sku||'').trim()!==sku){
      validItems=false;
    }
    if(productId(product))linkedProducts++;
    seenSkus.add(sku);
    total+=subtotal;
  }
  if(!validItems||!Number.isSafeInteger(total)||total!==Number(order.amount_cents))
    reasons.push('Itens, preços ou produtos divergentes do catálogo.');
  if(linkedProducts!==items.length)
    reasons.push('Há produtos sem identificação única no Bling.');
  const customer=(Array.isArray(clients)?clients:[]).find(c=>String(c.id)===String(order.customer_id));
  const contact=contactId(customer);
  if(!customer||!contact||![11,14].includes(digits(customer.document||customer.cpf_cnpj).length))
    reasons.push('Cliente sem vínculo validado no Bling.');
  const marked=order.request_number==='HOMOLOG-01'&&
    legacyExport?.reference==='EC-HOMOLOG-01'&&
    ['enviado','ja_existente'].includes(String(legacyExport.state||''))&&
    !!legacyExport.bling_order_id;
  return {
    request_number:String(order.request_number),
    origin_reference:ref,
    customer_name:String(customer?.trade_name||customer?.legal_name||customer?.name||'Cliente').slice(0,110),
    amount:Number(order.amount_cents)/100,
    item_count:items.length,
    requires_stock_review:order.requires_stock_review===true,
    payment_state:order.state,
    linked_products:linkedProducts,
    bling_status:marked?'registrado':'nao_verificado',
    bling_number:marked?String(legacyExport.bling_order_number||''):null,
    status:marked?'ja_enviado':reasons.length?'pendente_cadastro':'aguardando_verificacao',
    issues:reasons
  };
}
async function loadQueue(){
  const [result,clients,products,pilot]=await Promise.all([
    checkoutDb().query(
      'SELECT request_number,customer_id,amount_cents,state,payment_state,payment_id,'+
      'checkout_reference,items,requires_stock_review,paid_at,created_at '+
      "FROM everclean_private.checkout_orders WHERE state='paid' ORDER BY paid_at DESC LIMIT 50"),
    readClients(),readProducts(),
    getJson('integrations/bling/exports/homolog-01',null)
  ]);
  const orders=result.rows.map(order=>reviewPaidOrder(order,clients,products,pilot));
  return {orders,raw:result.rows};
}
async function verifyOne(number){
  const {orders,raw}=await loadQueue();
  const order=orders.find(o=>o.request_number===String(number||''));
  if(!order)return json({ok:false,message:'Pedido pago não encontrado no Neon.'},404);
  if(order.status==='pendente_cadastro')return json({ok:true,order,
    message:'Conferência de cadastro pendente. Nenhum pedido enviado ao Bling.'});
  const token=await blingAccessToken();
  if(!token)return json({ok:false,message:'Bling não está conectado para consulta.'},503);
  const query=new URLSearchParams({pagina:'1',limite:'100'});
  query.append('numerosLojas[]',order.origin_reference);
  const lookup=await remote('/pedidos/vendas?'+query,token);
  if(!Array.isArray(lookup.data)||
    lookup.data.some(p=>String(p.numeroLoja||'')!==order.origin_reference))
    return json({ok:false,message:'Resposta de referência não confiável; nenhuma exportação autorizada.'},409);
  if(lookup.data.length>1)return json({ok:true,order:{...order,
    status:'duplicidade_detectada',bling_status:'multiplos_registros'},
    message:'Múltiplos pedidos com a mesma referência no Bling. Verificação manual obrigatória.'});
  if(lookup.data.length===1){
    const found=lookup.data[0];
    return json({ok:true,order:{...order,status:'ja_enviado',bling_status:'registrado',
      bling_number:String(found.numero||'')},
      message:'Pedido já existe no Bling. Nenhuma nova venda foi criada.'});
  }
  // Somente validação de leitura; consulta Asaas por ID já armazenado no Neon.
  const record=raw.find(x=>String(x.request_number)===order.request_number);
  const secret=String(env('ASAAS_PROD_API_KEY')||'');
  if(secret.length<20)return json({ok:false,message:'Chave de produção do Asaas indisponível.'},503);
  const response=await fetch('https://api.asaas.com/v3/payments/'+
    encodeURIComponent(record.payment_id),{
      headers:{Accept:'application/json',access_token:secret,
        'User-Agent':'EverCleanCatalogo/1.0'},
      signal:AbortSignal.timeout(14000)
    });
  if(!response.ok)return json({ok:false,message:'Não foi possível reconfirmar pagamento no Asaas.'},502);
  const payment=await response.json().catch(()=>null);
  if(!payment||payment.id!==record.payment_id||
    payment.externalReference!==record.checkout_reference||
    payment.billingType!=='PIX'||
    !['RECEIVED','CONFIRMED'].includes(String(payment.status))||
    Math.round(Number(payment.value)*100)!==Number(record.amount_cents))
    return json({ok:false,message:'Pagamento divergente no Asaas. Exportação bloqueada.'},409);
  // Simulação é propositalmente sem POST para o Bling, mesmo com PIX confirmado.
  return json({ok:true,order:{...order,status:'validado_para_planejamento',
      bling_status:'referencia_ausente',needs_manual_fulfillment:order.requires_stock_review},
    message:'Pagamento confirmado e referência ausente no Bling. A fila automática segue DESATIVADA.'});
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const body=await request.json().catch(()=>null);
  if(!['preview','verify'].includes(body?.action))
    return json({ok:false,message:'Esta etapa permite apenas consultas, nunca envio.'},403);
  try{
    if(body.action==='verify')return await verifyOne(body.request_number);
    const {orders}=await loadQueue();
    return json({ok:true,automatic_export_enabled:false,
      automatic_stock_enabled:false,automatic_invoices_enabled:false,
      orders,
      total_paid:orders.length,
      already_exported:orders.filter(o=>o.status==='ja_enviado').length,
      awaiting_checks:orders.filter(o=>o.status!=='ja_enviado').length,
      message:'Prévia de automação concluída sem modificar Neon, Bling ou Asaas.'});
  }catch(error){
    console.warn('Ever Clean automation preflight:',String(error?.message||'Erro').slice(0,150));
    return json({ok:false,message:'Não foi possível auditar a fila de pedidos. Nenhuma alteração executada.'},502);
  }
}
