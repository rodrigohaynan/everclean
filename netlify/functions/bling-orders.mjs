import legacy from './test-api-v7.mjs';
import {json,getJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';

// Homologação somente de leitura. Nunca envia pagamentos Sandbox para o Bling real.
const BASE='https://api.bling.com.br/Api/v3';
const digits=value=>String(value||'').replace(/\D/g,'');
const sku=value=>String(value||'').trim().toUpperCase();
const cents=value=>Math.round(Number(value)*100);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function idFromProduct(product){
  const explicit=String(product?.bling_product_id||'');
  const old=String(product?.id||'').match(/^bling-product-(\d+)$/);
  const id=explicit||old?.[1]||'';
  return /^\d{1,20}$/.test(id)?id:null;
}
function idFromClient(client){
  const explicit=String(client?.bling_contact_id||'');
  const old=String(client?.id||'').match(/^client-(\d+)$/);
  const id=explicit||old?.[1]||'';
  return /^\d{1,20}$/.test(id)?id:null;
}
async function getBling(path,token){
  await sleep(370);
  const response=await fetch(BASE+path,{
    headers:{Accept:'application/json',Authorization:'Bearer '+token,'enable-jwt':'1'},
    signal:AbortSignal.timeout(9000)
  });
  if(!response.ok)throw new Error(response.status===401||response.status===403
    ?'Sem autorização para consultar clientes/produtos no Bling (HTTP '+response.status+').'
    :'O Bling não retornou o cadastro solicitado (HTTP '+response.status+').');
  const body=await response.json().catch(()=>null);
  if(!body?.data||typeof body.data!=='object')throw new Error('Resposta inesperada do Bling.');
  return body.data;
}
function orderChecks(order,clients,products,sentMap){
  const reasons=[];
  const number=String(order?.order_number||'').slice(0,35);
  const reference=String(order?.asaas_reference||'');
  const sandbox=String(order?.source||'').toLowerCase().includes('sandbox')||
    String(process.env.ASAAS_BASE_URL||'').includes('api-sandbox.asaas.com');
  const customer=clients.find(c=>String(c.id)===String(order.customer_id));
  const document=digits(customer?.document);
  const contactId=idFromClient(customer);
  const lines=Array.isArray(order.items)?order.items:[];
  const mapped=lines.map(item=>{
    const local=products.find(p=>String(p.id)===String(item.product_id));
    const blingId=idFromProduct(local);
    const sameSku=Boolean(local&&sku(local.sku)&&sku(local.sku)===sku(item.product_sku));
    const quantity=Number(item.quantity);
    const unit=Number(item.unit_price_snapshot);
    const valid=Boolean(blingId&&sameSku&&Number.isFinite(quantity)&&quantity>0&&
      Number.isFinite(unit)&&unit>0&&cents(unit)*quantity===cents(Number(item.subtotal)));
    if(!valid)reasons.push('Produto '+String(item.product_sku||'?')+' sem vínculo único ou com valor inconsistente.');
    return {sku:String(item.product_sku||''),name:String(item.product_name||'').slice(0,90),
      quantity,unit_price:unit,bling_product_id:blingId,valid};
  });
  const totalCents=cents(order.total_amount);
  const sumCents=lines.reduce((sum,item)=>sum+cents(item.subtotal),0);
  if(!number||!reference.startsWith('EVERCLEAN-EC-'))reasons.push('Identificação do pedido/cobrança inválida.');
  if(!Number.isSafeInteger(totalCents)||totalCents<=0||sumCents!==totalCents)reasons.push('Total do pedido não corresponde aos itens.');
  if(!customer||!contactId||![11,14].includes(document.length))reasons.push('Cliente sem ID e documento verificáveis no Bling.');
  if(lines.length===0||lines.length>100)reasons.push('Quantidade de itens inválida.');
  if(String(order.payment_status||'')!=='pago')reasons.push('Pagamento não confirmado.');
  if(sentMap?.bling_order_id||order.bling_order_id)reasons.push('Pedido já possui vínculo de envio ao Bling.');
  if(sandbox)reasons.push('Pagamento realizado no Asaas Sandbox; proibido lançar como venda real.');
  return {order_number:number,order_id:String(order.id||''),source: sandbox?'Asaas Sandbox':'Asaas',
    payment_status:String(order.payment_status||''),reference,amount:Number(order.total_amount)||0,
    customer_name:String(customer?.trade_name||order.customer_name||'').slice(0,120),
    customer_id:contactId,document_last4:document.slice(-4),items:mapped,
    preflight_ok:reasons.length===0,blocked:reasons.length>0,reasons,
    provider_checked:false};
}
async function preview(){
  const [orders,clients,products]=await Promise.all([
    getJson('data/orders',[]),getJson('data/clients',[]),getJson('data/products',[])
  ]);
  const paid=Array.isArray(orders)?orders.filter(o=>o.payment_status==='pago'&&
    String(o.asaas_reference||'').startsWith('EVERCLEAN-EC-')&&
    !String(o.source||'').startsWith('Bling backup')):[];
  const recent=paid.slice(0,15);
  const rows=[];
  for(const order of recent){
    const reference=String(order.asaas_reference);
    const marker=await getJson('integrations/bling/order-export/'+reference,null);
    rows.push(orderChecks(order,Array.isArray(clients)?clients:[],Array.isArray(products)?products:[],marker));
  }
  const blocked=rows.filter(o=>o.blocked).length;
  let providerCheck={checked:0,contact_validated:0,products_validated:0,issues:[]};
  // Consulta de leitura limitada aos primeiros vínculos para validar a API real.
  try{
    const token=await blingAccessToken();
    if(token){
      const contactPairs=[...new Map(rows.filter(o=>o.customer_id).map(o=>[o.customer_id,o])).entries()].slice(0,6);
      const productPairs=[...new Map(rows.flatMap(o=>o.items).filter(i=>i.valid&&i.bling_product_id).map(i=>[i.bling_product_id,i])).entries()].slice(0,10);
      for(const [id,row] of contactPairs){
        try{
          const contact=await getBling('/contatos/'+encodeURIComponent(id),token);
          providerCheck.checked++;
          const found=digits(contact.numeroDocumento);
          if(found&&found.slice(-4)===row.document_last4&&
             [11,14].includes(found.length))providerCheck.contact_validated++;
          else providerCheck.issues.push('Cliente do pedido '+row.order_number+': CPF/CNPJ precisa ser conferido.');
        }catch(error){providerCheck.issues.push('Cliente '+row.order_number+': '+String(error.message).slice(0,105));}
      }
      for(const [id,item] of productPairs){
        try{
          const product=await getBling('/produtos/'+encodeURIComponent(id),token);
          providerCheck.checked++;
          if(sku(product.codigo)===sku(item.sku))providerCheck.products_validated++;
          else providerCheck.issues.push('Produto com SKU '+item.sku+' diferente no Bling.');
        }catch(error){providerCheck.issues.push('Produto '+item.sku+': '+String(error.message).slice(0,105));}
      }
    }
  }catch(error){providerCheck.issues.push('Não foi possível verificar os vínculos em tempo real: '+String(error.message).slice(0,100));}
  return json({ok:true,mode:'homologacao_sem_envio',orders_found:paid.length,
    reviewed:rows.length,blocked,ready:rows.filter(r=>r.preflight_ok).length,
    orders:rows,provider_check:providerCheck,
    automatic_orders:false,automatic_invoices:false,
    message:'Prévia concluída. Nenhum pedido, cliente, cobrança ou nota fiscal foi criado no Bling.'});
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  let body={};try{body=await request.json()}catch{return json({ok:false,message:'JSON inválido.'},400)}
  if(body.action!=='preview')return json({ok:false,message:'Somente a prévia está habilitada. O envio está bloqueado durante a homologação.'},403);
  try{return await preview();}
  catch(error){
    console.error('Ever Clean Bling order preflight:',String(error?.message||'Erro').slice(0,120));
    return json({ok:false,message:'Não foi possível conferir os pedidos. Nenhum dado foi enviado ao Bling.'},500);
  }
}
