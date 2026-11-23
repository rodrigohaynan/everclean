import crypto from 'node:crypto';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {blingAccessToken,getJson} from '../shared/everclean-bling.mjs';
import {generateOrderPdf} from '../shared/everclean-customer-order-pdf.mjs';
import {readProducts,readClients} from '../shared/catalog-store.mjs';

// Endpoint público APENAS com token secreto do link. Sem credenciais do Bling no navegador.
// Somente GET; nunca cria pedido, cobrança, movimentação ou NF-e.
const fail=(message,status)=>Object.assign(new Error(message),{status});
const err=(message,status=403)=>Response.json({ok:false,message},{status,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
}});
// Resumo do pedido: pode ser baixado assim que o pagamento é confirmado,
// independentemente da conclusão da integração logística. Sem chamadas POST.
export async function loadVerifiedPaidOrder(token){
  if(!/^[a-f0-9]{64}$/.test(String(token||'')))
    throw fail('Link do pedido inválido.',404);
  const digest=crypto.createHash('sha256').update(token).digest('hex');
  const {rows}=await checkoutDb().query(
    'SELECT o.request_number,o.state,o.payment_state,o.amount_cents,o.items,'+
    'o.requires_stock_review,o.paid_at,o.customer_notes,o.payment_method,o.customer_id,l.customer_name,'+
    'i.state AS export_state,i.bling_order_id,i.origin_reference '+
    'FROM everclean_private.production_catalog_links l '+
    'JOIN everclean_private.checkout_orders o ON o.link_digest=l.token_digest '+
    'LEFT JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id '+
    'WHERE l.token_digest=$1 AND l.token=$2 LIMIT 2',[digest,token]
  );
  if(rows.length!==1)throw fail('Documento não encontrado para este pedido.',404);
  const o=rows[0];
  if(o.state!=='paid'||!['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(o.payment_state)||
    !o.paid_at)throw fail('Documento disponível após a confirmação do pagamento.',409);
  if(Date.now()-Date.parse(o.paid_at)>90*86400000)
    throw fail('O acesso a este documento expirou. Solicite uma nova via.',410);
  const items=Array.isArray(o.items)?o.items:[];
  const cents=Number(o.amount_cents);
  if(!/^[0-9]{1,12}$/.test(String(o.request_number||''))||
    !Number.isSafeInteger(cents)||cents<=0||
    items.length<1||items.length>50||
    items.some(i=>{
      const qty=Number(i.quantity),unit=Number(i.unit_price_cents),
        subtotal=Number(i.subtotal_cents);
      return !String(i.product_name||'').trim()||
        !Number.isSafeInteger(qty)||qty<1||
        !Number.isSafeInteger(unit)||unit<1||
        !Number.isSafeInteger(subtotal)||subtotal!==qty*unit;
    })||
    items.reduce((sum,i)=>sum+Number(i.subtotal_cents),0)!==cents)
    throw fail('Dados do pedido em conferência. Solicite atendimento.',409);
  const origin='EC-PROD-'+String(o.request_number);
  return {...o,items,amount_cents:cents,
    export_ready:['sent','already_exists'].includes(String(o.export_state))&&
      /^[0-9]{1,20}$/.test(String(o.bling_order_id||''))&&
      String(o.origin_reference||'')===origin};
}

// A via antecipada e a via conciliada usam o MESMO modelo comercial.
// O PDF nasce do pedido efetivamente pago; nenhuma cobrança ou pedido é criado.
async function generateCustomerOrderSummary(order){
  let customer=null;
  let products=[];
  try{
    const [clients,stock]=await Promise.all([
      readClients(),readProducts()
    ]);
    customer=(Array.isArray(clients)?clients:[]).find(c=>
      String(c?.id||'')===String(order.customer_id||''))||null;
    products=Array.isArray(stock)?stock:[];
  }catch{
    // Dados complementares do cadastro são opcionais; não impedem a via
    // comercial nem permitem mostrar dados de outro cliente.
  }
  const cityRaw=String(customer?.city||'').trim().slice(0,100);
  const cityParts=cityRaw.split(/\s*[\/-]\s*/);
  const city=String(cityParts[0]||'').trim().slice(0,80);
  const state=String(cityParts[1]||'').trim().toUpperCase().slice(0,2);
  const doc=String(customer?.document||customer?.cpf_cnpj||'').replace(/\D/g,'');
  const productMap=new Map(products.map(p=>[String(p.id),p]));
  const skuMap=new Map(products.map(p=>[String(p.sku||''),p]));
  const items=order.items.map(item=>{
    const original=productMap.get(String(item.product_id))||
      skuMap.get(String(item.product_sku||''));
    return {
      sku:String(item.product_sku||'').trim().slice(0,50),
      name:String(item.product_name||'').trim().slice(0,140),
      unit:String(original?.unit||'UN').trim().slice(0,6)||'UN',
      quantity:Number(item.quantity),
      unit_price_cents:Number(item.unit_price_cents)
    };
  });
  const paidDate=new Intl.DateTimeFormat('sv-SE',{
    timeZone:'America/Campo_Grande',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date(order.paid_at));
  return generateOrderPdf({
    number:String(order.request_number),
    reference:'EC-PROD-'+String(order.request_number),
    source:'checkout_paid',
    date:paidDate,
    customer:String(order.customer_name||'Cliente Ever Clean').trim(),
    customer_document:[11,14].includes(doc.length)?doc:'',
    customer_address:String(customer?.address||'').trim().slice(0,200),
    customer_city:city,
    customer_state:/^[A-Z]{2}$/.test(state)?state:'',
    customer_zip:String(customer?.zip||customer?.postal_code||'').trim().slice(0,15),
    customer_phone:String(customer?.phone||'').trim().slice(0,50),
    customer_email:String(customer?.email||'').trim().slice(0,130),
    customer_notes:String(order.customer_notes||'').trim().slice(0,500),
    amount_cents:Number(order.amount_cents),
    payment_method:String(order.payment_method||'pix'),
    requires_stock_review:order.requires_stock_review===true,
    items
  });
}

function pdfResponse(bytes,filename){
  return new Response(bytes,{status:200,headers:{
    'Content-Type':'application/pdf',
    'Content-Disposition':'attachment; filename="'+filename+'"',
    'Content-Length':String(bytes.byteLength),
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'none'; sandbox"
  }});
}
export async function loadPaidBlingOrder(token){
  if(!/^[a-f0-9]{64}$/.test(String(token||'')))
    throw fail('Link de pedido inválido.',404);
  const digest=crypto.createHash('sha256').update(token).digest('hex');
  const {rows}=await checkoutDb().query(
    'SELECT o.request_number,o.state,o.payment_state,o.amount_cents,o.items,'+
      'o.requires_stock_review,o.paid_at,o.payment_method,i.state AS export_state,'+
      'i.bling_order_id,i.origin_reference,l.customer_name '+
    'FROM everclean_private.production_catalog_links l '+
    'JOIN everclean_private.checkout_orders o ON o.link_digest=l.token_digest '+
    'JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id '+
    'WHERE l.token_digest=$1 AND l.token=$2 LIMIT 2',[digest,token]
  );
  if(rows.length!==1)throw fail('Documento ainda não disponível para este link.',404);
  const o=rows[0];
  if(o.state!=='paid'||!['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(o.payment_state)||
    !o.paid_at)throw fail('O documento é liberado após a confirmação do pagamento.',409);
  if(Date.now()-Date.parse(o.paid_at)>90*24*3600*1000)
    throw fail('O prazo do link do documento terminou. Solicite uma nova via.',410);
  if(!['sent','already_exists'].includes(o.export_state)||
      !/^\d{1,20}$/.test(String(o.bling_order_id||'')))
    throw fail('Aguardando o pedido ser registrado no Bling. Consulte novamente.',409);
  const origin='EC-PROD-'+String(o.request_number);
  if(o.origin_reference!==origin)throw fail('Referência do Bling não conciliada.',409);
  const items=Array.isArray(o.items)?o.items:[];
  if(!items.length||items.length>50)throw fail('Itens do pedido inválidos.',409);
  const amount=Number(o.amount_cents);
  if(!Number.isSafeInteger(amount)||amount<=0||
     items.some(item=>Number(item.quantity)*Number(item.unit_price_cents)!==
       Number(item.subtotal_cents))||
     items.reduce((total,item)=>total+Number(item.subtotal_cents),0)!==amount)
    throw fail('Os valores do pedido não estão conciliados.',409);
  return {...o,origin,items};
}
function checkRemote(remote,local,contact){
  // Campos opcionais do cadastro do próprio contato vinculado ao pedido no Bling.
  const location=contact?.endereco?.geral||contact?.endereco||{};
  const address=[
    String(location.endereco||location.logradouro||'').trim(),
    String(location.numero||'').trim(),
    String(location.complemento||'').trim(),
    String(location.bairro||'').trim()
  ].filter(Boolean).join(', ').slice(0,240);
  const customerInfo={
    customer_document:String(contact?.numeroDocumento||'').replace(/\D/g,'').slice(0,14),
    customer_address:address,
    customer_city:String(location.municipio||location.cidade||'').slice(0,100),
    customer_state:String(location.uf||'').slice(0,2),
    customer_zip:String(location.cep||'').slice(0,15),
    customer_phone:String(contact?.celular||contact?.telefone||'').slice(0,50),
    customer_email:String(contact?.email||'').slice(0,130)
  };
  if(!remote||String(remote.id)!==String(local.bling_order_id)||
     String(remote.numeroLoja||'')!==local.origin)
    throw fail('A identidade do pedido no Bling não pôde ser verificada.',409);
  const amount=Number(local.amount_cents);
  const amountRemote=Number(remote.total);
  if(!Number.isFinite(amountRemote)||Math.round(amountRemote*100)!==amount)
    throw fail('O total do pedido no Bling não corresponde ao pagamento.',409);
  const remoteItems=Array.isArray(remote.itens)?remote.itens:[];
  if(remoteItems.length!==local.items.length)
    throw fail('Os itens do Bling não conferem com o pedido pago.',409);
  const used=new Set();
  const verified=[];
  for(const item of local.items){
    const productId=String(item.product_id||'').match(/^bling-product-(\d{1,20})$/)?.[1]||'';
    let found=-1;
    for(let j=0;j<remoteItems.length;j++){
      if(used.has(j))continue;
      const remoteItem=remoteItems[j];
      const sku=String(remoteItem.codigo||remoteItem.produto?.codigo||'').trim();
      const id=String(remoteItem.produto?.id||'');
      if((sku&&sku===String(item.product_sku))||
        (productId&&id===productId)){
        found=j;break;
      }
    }
    if(found<0)throw fail('SKU não localizado entre os itens do Bling.',409);
    used.add(found);
    const r=remoteItems[found];
    if(Number(r.quantidade)!==Number(item.quantity)||
       Math.round(Number(r.valor)*100)!==Number(item.unit_price_cents))
      throw fail('Quantidade ou preço no Bling diverge do pedido pago.',409);
    verified.push({
      sku:String(item.product_sku),
      name:String(r.descricao||item.product_name).slice(0,140),
      quantity:Number(item.quantity),
      unit_price_cents:Number(item.unit_price_cents),
      unit:String(r.unidade||r.produto?.unidade||'UN').slice(0,6)
    });
  }
  return {
    number:String(remote.numero),
    reference:local.origin,
    customer:String(remote.contato?.nome||local.customer_name||'Cliente Ever Clean'),
    amount_cents:amount,items:verified,
    date:String(remote.data||local.paid_at).slice(0,10),
    requires_stock_review:local.requires_stock_review===true,
    payment_method:local.payment_method||'pix',
    ...customerInfo
  };
}
export default async function handler(request){
  if(request.method!=='GET')return err('Método não permitido.',405);
  const token=new URL(request.url).searchParams.get('token')||'';
  try{
    const paidOrder=await loadVerifiedPaidOrder(token);
    if(!paidOrder.export_ready){
      const summary=await generateCustomerOrderSummary(paidOrder);
      return pdfResponse(summary,'EverClean-Pedido-'+paidOrder.request_number+'.pdf');
    }
    // Documento do Bling quando houver conciliação; indisponibilidade
    // externa NÃO impede o cliente de baixar o resumo do pedido já pago.
    try{
      const local=await loadPaidBlingOrder(token);
      const access=await blingAccessToken();
      if(!access)throw fail('Integração Bling temporariamente indisponível.',503);
      const result=await fetch('https://api.bling.com.br/Api/v3/pedidos/vendas/'+
        encodeURIComponent(local.bling_order_id),{
        method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+access},
        signal:AbortSignal.timeout(16000)
      });
      if(!result.ok)throw fail('Não foi possível consultar o pedido no Bling.',502);
      const response=await result.json().catch(()=>null);
      // Segunda consulta apenas de leitura, para complementar os dados do cliente.
      // Se o cadastro não estiver disponível, o pedido continua acessível
      // com o nome já confirmado. Nunca retorna dados de outro contato.
      let contact=null;
      const contactId=String(response?.data?.contato?.id||'');
      if(/^\d{1,20}$/.test(contactId)){
        try{
          const detail=await fetch('https://api.bling.com.br/Api/v3/contatos/'+
            encodeURIComponent(contactId),{
              method:'GET',
              headers:{Accept:'application/json',Authorization:'Bearer '+access},
              signal:AbortSignal.timeout(10000)
            });
          if(detail.ok){
            const info=await detail.json().catch(()=>null);
            if(String(info?.data?.id||'')===contactId)contact=info.data;
          }
        }catch{
          // A consulta complementar nunca cria, altera ou retém o pedido.
        }
      }
      const info=checkRemote(response?.data,local,contact);
      if(!/^\d{1,12}$/.test(info.number))
        throw fail('O Bling ainda não informou o número do pedido.',409);
      const bytes=await generateOrderPdf(info);
      return pdfResponse(bytes,'EverClean-Pedido-'+paidOrder.request_number+'.pdf');
    }catch(blingError){
      console.warn('Pedido comercial externo indisponível; oferecendo resumo do pedido confirmado.',
        String(blingError?.message||'').slice(0,90));
      const summary=await generateCustomerOrderSummary(paidOrder);
      return pdfResponse(summary,'EverClean-Pedido-'+paidOrder.request_number+'.pdf');
    }
  }catch(error){
    const status=Number(error?.status);
    console.warn('PDF pedido Bling indisponível:',String(error?.message||'').slice(0,110));
    return err(String(error?.message||'Não foi possível gerar o PDF do pedido.').slice(0,190),
      Number.isInteger(status)&&status>=400&&status<600?status:502);
  }
}
