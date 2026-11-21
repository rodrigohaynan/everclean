import legacy from './test-api-v7.mjs';
import {json,getJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';

// Auditoria estritamente de leitura do pedido HOMOLOG-01.
// Não cria pedido, não lança estoque, não gera contas e não emite NF-e.
const API='https://api.bling.com.br/Api/v3';
const ORDER_NUMBER='HOMOLOG-01';
const ORIGIN='EC-HOMOLOG-01';
const SKU='100388';
const onlyDigits=value=>String(value||'').replace(/\D/g,'');
const numId=value=>/^\d{1,20}$/.test(String(value||''))?String(value):null;
const productId=product=>numId(product?.bling_product_id)||
  numId(String(product?.id||'').match(/^bling-product-(\d+)$/)?.[1]);
const contactId=customer=>numId(customer?.bling_contact_id)||
  numId(String(customer?.id||'').match(/^client-(\d+)$/)?.[1]);

// O limite do Bling é compartilhado por toda a conta. Espaçar chamadas
// desta auditoria reduz o risco de 429; nunca tentar repetir escritas.
let nextBlingReadSlot=0;
async function waitForBlingRead(){
  const wait=Math.max(0,nextBlingReadSlot-Date.now());
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  nextBlingReadSlot=Date.now()+800;
}
async function getRemote(path,token){
  await waitForBlingRead();
  const response=await fetch(API+path,{
    headers:{Accept:'application/json',Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(14000)
  });
  if(!response.ok)throw Error('Consulta ao Bling falhou (HTTP '+response.status+').');
  const data=await response.json().catch(()=>null);
  if(!data||typeof data!=='object')throw Error('Resposta do Bling inválida.');
  return data;
}
export async function inspectNeonBling(){
  const [query,clients,products]=await Promise.all([
    checkoutDb().query(
      'SELECT request_number,customer_id,amount_cents,state,payment_state,payment_id,checkout_reference,items,paid_at '+
      'FROM everclean_private.checkout_orders WHERE request_number=$1 ORDER BY created_at DESC LIMIT 2',
      [ORDER_NUMBER]),
    getJson('data/clients',[]),getJson('data/products',[])
  ]);
  const reasons=[];
  const records=query.rows||[];
  if(records.length!==1)reasons.push('O pedido HOMOLOG-01 deve existir uma única vez no Neon.');
  const order=records[0]||null;
  if(order?.state!=='paid'||order?.payment_state!=='PAYMENT_RECEIVED'||!order?.payment_id||
     !/^EVERCLEAN-PROD-CATALOG-[0-9a-f]{32}$/i.test(String(order?.checkout_reference||''))||
     Number(order?.amount_cents)!==700||!order?.paid_at)
    reasons.push('A conciliação financeira do HOMOLOG-01 não está integralmente confirmada.');
  const items=Array.isArray(order?.items)?order.items:[];
  if(items.length!==1||String(items[0]?.product_sku||items[0]?.sku||'')!==SKU||
    Number(items[0]?.quantity)!==1||Number(items[0]?.unit_price_cents)!==700)
    reasons.push('O pedido deve conter 1 unidade do SKU 100388, valor R$ 7,00.');
  const customer=Array.isArray(clients)?
    clients.find(c=>String(c.id)===String(order?.customer_id)):null;
  const catalogProduct=Array.isArray(products)?
    products.find(p=>String(p.sku||'').trim()===SKU):null;
  const cid=contactId(customer),pid=productId(catalogProduct);
  if(!customer||!cid)reasons.push('Contato local sem vínculo verificável no Bling.');
  if(!catalogProduct||!pid)reasons.push('Produto local sem vínculo verificável no Bling.');
  const result={
    ok:true,request_number:ORDER_NUMBER,origin_reference:ORIGIN,
    neon_paid:order?.state==='paid',amount:7,quantity:1,sku:SKU,
    linked_contact:Boolean(cid),linked_product:Boolean(pid),
    existing_bling_order_id:null,existing_bling_order_number:null,
    automatic_bling_export_enabled:false,
    automatic_invoices_enabled:false,
    automatic_stock_movements_enabled:false,
    approved:false,reasons,
    checked_at:new Date().toISOString(),
    // Dados necessários ao envio, disponíveis somente após autenticação administrativa.
    contact_id:cid,product_id:pid,payment_id:order?.payment_id||null,
    asaas_reference:order?.checkout_reference||null
  };
  if(reasons.length)return result;
  const token=await blingAccessToken();
  if(!token){result.reasons.push('O Bling não está conectado.');return result;}
  const contact=await getRemote('/contatos/'+encodeURIComponent(cid),token);
  const product=await getRemote('/produtos/'+encodeURIComponent(pid),token);
  if(onlyDigits(contact?.data?.numeroDocumento)!==onlyDigits(customer.document))
    result.reasons.push('CPF/CNPJ do contato não coincide com o cadastro local.');
  if(String(product?.data?.codigo||'').trim()!==SKU)
    result.reasons.push('O SKU do produto não coincide com o cadastro Bling.');
  // Busca pela referência única da origem; não confundir com o antigo pedido 1237.
  const params=new URLSearchParams({pagina:'1',limite:'100'});
  params.append('numerosLojas[]',ORIGIN);
  const orders=await getRemote('/pedidos/vendas?'+params.toString(),token);
  if(!Array.isArray(orders?.data)){
    result.reasons.push('O Bling não retornou uma lista de pedidos válida.');
    return result;
  }
  if(orders.data.some(o=>String(o.numeroLoja||'')!==ORIGIN)){
    result.reasons.push('O filtro por referência de origem não foi respeitado; não é possível excluir duplicidade.');
    return result;
  }
  if(orders.data.length>1){
    result.reasons.push('Mais de um pedido no Bling com a referência HOMOLOG-01.');
  }else if(orders.data.length===1){
    result.existing_bling_order_id=String(orders.data[0].id||'');
    result.existing_bling_order_number=String(orders.data[0].numero||'');
    result.reasons.push('O pedido já existe no Bling; não gerar uma segunda venda.');
  }
  result.approved=result.reasons.length===0;
  return result;
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const input=await request.json().catch(()=>null);
  if(input?.action!=='audit')return json({ok:false,message:'Somente conferência de leitura disponível. Nenhum envio autorizado.'},403);
  try{
    const result=await inspectNeonBling();
    return json({...result,message:result.approved?
      'Pedido HOMOLOG-01 pago e vinculado. Nenhum registro com a mesma referência foi encontrado na consulta do Bling. Envio permanece desligado.':
      'Conferência concluída com ressalvas. Nenhum pedido foi criado ou alterado.'});
  }catch(error){
    console.error('Ever Clean Neon-Bling audit:',String(error?.message||'Falha').slice(0,100));
    return json({ok:false,message:'Consulta Neon/Bling não concluída: '+String(error?.message||'Falha').slice(0,100)+'. Nenhum pedido foi enviado.'},502);
  }
}
