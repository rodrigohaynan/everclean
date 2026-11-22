import crypto from 'node:crypto';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {blingAccessToken} from '../shared/everclean-bling.mjs';
import {generateOrderPdf} from '../shared/everclean-customer-order-pdf.mjs';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';

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
    'o.requires_stock_review,o.paid_at,o.customer_notes,o.payment_method,l.customer_name,'+
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

async function generateCustomerOrderSummary(order){
  // Os dados exibidos vêm exclusivamente do pedido pago, validado no Neon.
  // Este resumo não se apresenta como documento oficial do Bling ou NF-e.
  const pdf=await PDFDocument.create();
  pdf.setTitle('Resumo do pedido EC-'+order.request_number+' - Ever Clean');
  pdf.setAuthor('Ever Clean Higiene Profissional');
  pdf.setSubject('Resumo comercial de pedido pago, nao fiscal');
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const green=rgb(0.03,0.34,0.29),ink=rgb(0.13,0.20,0.22),
    muted=rgb(0.39,0.46,0.48),soft=rgb(0.93,0.97,0.95);
  const ascii=value=>String(value??'').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,' ')
    .replace(/\s+/g,' ').trim();
  const money=cents=>'R$ '+(Number(cents)/100).toLocaleString('pt-BR',{
    minimumFractionDigits:2,maximumFractionDigits:2
  });
  let page,y;
  const write=(value,x,size=10,font=regular,color=ink)=>{
    const line=ascii(value);
    if(line)page.drawText(line,{x,y,size,font,color});
  };
  function createPage(){
    page=pdf.addPage([595,842]);y=775;
    page.drawRectangle({x:0,y:826,width:595,height:16,color:green});
    write('EVER CLEAN',42,22,bold,green);y-=25;
    write('Higiene Profissional | Resumo comercial do pedido',42,10,regular,muted);
    y-=22;page.drawLine({start:{x:42,y},end:{x:553,y},thickness:1,color:soft});
    y-=30;
  }
  function wrapped(value,x,maxWidth,size=10,font=regular,step=15){
    const words=ascii(value).split(' ');
    let line='';
    for(const word of words){
      let next=line?line+' '+word:word;
      if(font.widthOfTextAtSize(next,size)<=maxWidth){line=next;continue;}
      if(line){write(line,x,size,font);y-=step;line='';}
      // SKU e nomes extensos não podem invadir a coluna de valores.
      let rest=word;
      while(rest.length&&font.widthOfTextAtSize(rest,size)>maxWidth){
        let n=1;
        while(n<rest.length&&font.widthOfTextAtSize(rest.slice(0,n+1),size)<=maxWidth)n++;
        write(rest.slice(0,n),x,size,font);y-=step;rest=rest.slice(n);
      }
      line=rest;
    }
    if(line){write(line,x,size,font);y-=step;}
  }
  createPage();
  write('Pedido EC-'+order.request_number,42,16,bold,ink);y-=26;
  write('Cliente: '+ascii(order.customer_name||'Cliente Ever Clean'),42,10);y-=18;
  const paidDate=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',
    timeZone:'America/Campo_Grande'}).format(new Date(order.paid_at));
  write('Pagamento confirmado em: '+paidDate,42,10,regular,muted);y-=27;
  page.drawRectangle({x:42,y:y-25,width:511,height:30,color:soft});
  write('PRODUTOS E QUANTIDADES',52,11,bold,green);y-=45;
  for(const [index,item] of order.items.entries()){
    if(y<137)createPage();
    const base=y;
    wrapped((index+1)+'. '+item.product_name,48,358,10,bold,15);
    write('Codigo: '+ascii(item.product_sku||'--'),48,9,regular,muted);
    y-=15;
    write('Quantidade: '+Number(item.quantity)+' | Valor unitario: '+
      money(item.unit_price_cents),48,9,regular,muted);
    const value=money(item.subtotal_cents);
    page.drawText(value,{x:548-bold.widthOfTextAtSize(value,10),
      y:base-3,size:10,font:bold,color:green});
    y-=18;
    page.drawLine({start:{x:42,y},end:{x:553,y},thickness:0.6,color:soft});
    y-=17;
  }
  if(y<175)createPage();
  write('TOTAL PAGO',42,12,bold,green);
  const total=money(order.amount_cents);
  page.drawText(total,{x:549-bold.widthOfTextAtSize(total,15),y,
    size:15,font:bold,color:green});
  y-=28;
  write('Forma de pagamento: '+(order.payment_method==='boleto'?'Boleto':'PIX'),42,10);y-=20;
  if(order.requires_stock_review){
    wrapped('Disponibilidade e prazo de entrega sujeitos a confirmacao.',
      42,505,9,regular,14);
    y-=5;
  }
  if(order.customer_notes){
    write('Observacoes do pedido:',42,10,bold);y-=16;
    wrapped(order.customer_notes.slice(0,400),42,505,9,regular,14);
  }
  for(const [index,p] of pdf.getPages().entries()){
    p.drawLine({start:{x:42,y:63},end:{x:553,y:63},thickness:0.5,color:muted});
    p.drawText('Documento comercial nao fiscal. Nao substitui NF-e ou comprovante bancario.',{
      x:42,y:46,size:8,font:regular,color:muted});
    p.drawText((index+1)+' / '+pdf.getPageCount(),{
      x:517,y:46,size:8,font:regular,color:muted});
  }
  return pdf.save();
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
