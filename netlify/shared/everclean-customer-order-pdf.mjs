import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {paymentLabel} from './payment-methods.mjs';

// Documento comercial não fiscal montado a partir do pedido de venda
// confirmado pela API do Bling. O Bling não fornece um endpoint oficial
// confirmado de download da impressão nativa via API v3.
// Logomarca original extraída da impressão do Bling fornecida pelo usuário.
const BRAND_LOGO = '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';
const clean=value=>String(value??'').replace(/[\r\n\t]+/g,' ')
  .replace(/[^\u0020-\u00ff]/g,' ').replace(/\s+/g,' ').trim();
const real=value=>'R$ '+(Number(value)||0).toLocaleString('pt-BR',{
  minimumFractionDigits:2,maximumFractionDigits:2
});
const date=value=>{
  const raw=String(value??'');
  const parts=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return parts?parts[3]+'/'+parts[2]+'/'+parts[1]:clean(raw).slice(0,25);
};
export async function generateOrderPdf(data){
  const number=clean(data?.number);
  const reference=clean(data?.reference);
  const client=clean(data?.customer);
  const items=Array.isArray(data?.items)?data.items:[];
  const expectedCents=Number(data?.amount_cents);
  if(!/^\d{1,12}$/.test(number)||!/^EC-PROD-\d{1,10}$/.test(reference)||
     !client||items.length<1||items.length>50||
     !Number.isSafeInteger(expectedCents)||expectedCents<=0)
    throw Error('Dados do pedido incompletos para gerar documento.');
  let total=0;
  for(const item of items){
    if(!clean(item.sku)||!clean(item.name)||
       !Number.isSafeInteger(Number(item.quantity))||Number(item.quantity)<1||
       !Number.isSafeInteger(Number(item.unit_price_cents))||
       Number(item.unit_price_cents)<1)
      throw Error('Item de venda inválido para impressão.');
    total+=Number(item.quantity)*Number(item.unit_price_cents);
  }
  if(total!==expectedCents)throw Error('Total dos itens não corresponde ao pedido.');

  const pdf=await PDFDocument.create();
  const orderLabel=data?.source==='checkout_paid'?
    'EC-'+reference.replace('EC-PROD-',''):
    number;
  pdf.setTitle('Pedido de venda '+orderLabel+' - Ever Clean');
  pdf.setAuthor('Ever Clean Higiene Profissional');
  pdf.setSubject('Documento comercial nao fiscal da Ever Clean');
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const deep=rgb(0.05,0.34,0.29),ink=rgb(0.12,0.17,0.19),gray=rgb(0.42,0.47,0.48);
  const logo=await pdf.embedJpg(Uint8Array.from(Buffer.from(BRAND_LOGO,'base64')));
  // Layout adaptativo: pedidos de até cinco produtos usam espaçamentos
  // menores sem reduzir fontes nem distorcer a logomarca.
  const compact=items.length<=5;
  const spacing=(normal,short)=>compact?short:normal;
  let page,y;
  function newPage(){
    page=pdf.addPage([595,842]);y=793;
    page.drawRectangle({x:0,y:830,width:595,height:12,color:deep});
    page.drawImage(logo,{x:38,y:722,width:93,height:93});
    page.drawText('EVER CLEAN HIGIENE PROFISSIONAL',
      {x:145,y:789,size:12,font:bold,color:deep});
    page.drawText('Resumo do seu pedido',
      {x:145,y:772,size:10,font:regular,color:ink});
    page.drawText('Documento comercial, nao fiscal',
      {x:145,y:754,size:9,font:regular,color:ink});
    page.drawText('Pagamento e itens confirmados',
      {x:145,y:736,size:8.7,font:regular,color:ink});
    page.drawText('Nao substitui a nota fiscal',
      {x:145,y:720,size:8.7,font:regular,color:ink});
    page.drawLine({start:{x:42,y:706},end:{x:553,y:706},thickness:1.2,color:deep});
    y=spacing(681,682); // evita o titulo encostar na linha do cabecalho
  }
  function section(title){
    // A faixa de seção nunca compartilha área com a primeira linha do conteúdo.
    if(y<130)newPage();
    page.drawRectangle({x:42,y:y-spacing(23,17),width:511,
      height:spacing(27,23),color:rgb(0.92,0.96,0.94)});
    page.drawText(title,{x:51,y:y-spacing(14,12),size:10,font:bold,color:deep});
    y-=spacing(37,29);
  }
  function right(text,rightX,baseline,{size=9,font=regular,color=ink}={}){
    const value=clean(text);
    page.drawText(value,{x:rightX-font.widthOfTextAtSize(value,size),y:baseline,
      size,font,color});
  }
  function tableHead(){
    if(y<145)newPage();
    const height=spacing(26,22),baseline=y-spacing(17,15);
    page.drawRectangle({x:42,y:y-height,width:511,height,color:deep});
    const white=rgb(1,1,1),size=spacing(8,7.4);
    page.drawText('DESCRICAO DO PRODUTO',{x:49,y:baseline,size,font:bold,color:white});
    page.drawText('CODIGO',{x:301,y:baseline,size,font:bold,color:white});
    page.drawText('UN.',{x:375,y:baseline,size,font:bold,color:white});
    right('QTD.',426,baseline,{size,font:bold,color:white});
    right('UNITARIO',488,baseline,{size,font:bold,color:white});
    right('TOTAL',548,baseline,{size,font:bold,color:white});
    y-=height;
  }
  function line(text,{size=10,font=regular,color=ink,down=17,x=42}={}){
    if(y<85)newPage();
    page.drawText(clean(text),{x,y,size,font,color});
    y-=down;
  }
  function wrapped(text,maxWidth,{size=10,font=regular,color=ink,down=16,x=42}={}){
    const words=clean(text).split(' ');
    let current='';
    for(const word of words){
      const candidate=current?current+' '+word:word;
      if(font.widthOfTextAtSize(candidate,size)<=maxWidth){current=candidate;continue;}
      if(current){line(current,{size,font,color,down,x});current='';}
      // Trunca somente palavras anormalmente longas que não cabem.
      let part='';
      for(const character of word){
        if(font.widthOfTextAtSize(part+character,size)>maxWidth){
          if(part)line(part,{size,font,color,down,x});
          part='';
        }
        part+=character;
      }
      current=part;
    }
    if(current)line(current,{size,font,color,down,x});
  }
  const itemCount=items.length;
  const quantitySum=items.reduce((sum,item)=>sum+Number(item.quantity),0);
  newPage();
  line(data?.source==='checkout_paid'?
    'PEDIDO DE VENDA EC-'+reference.replace('EC-PROD-',''):
    'PEDIDO DE VENDA Nº '+number,
    {size:16,font:bold,color:deep,down:spacing(23,20)});
  line('Data: '+date(data.date)+'     Referencia: EC-'+reference.replace('EC-PROD-',''),
    {size:9,color:gray,down:spacing(28,19)});
  section('DADOS DO CLIENTE');
  wrapped('Nome / Razao social: '+client,495,{size:10,font:bold,down:spacing(16,14),x:50});
  if(clean(data.customer_document))
    wrapped('CPF/CNPJ: '+clean(data.customer_document),495,{size:9,down:spacing(15,13),x:50});
  if(clean(data.customer_address))
    wrapped('Endereco: '+clean(data.customer_address),495,{size:9,down:spacing(15,13),x:50});
  const city=[clean(data.customer_city),clean(data.customer_state)].filter(Boolean).join(' / ');
  if(city||clean(data.customer_zip))
    wrapped('Cidade / CEP: '+city+'   '+clean(data.customer_zip),495,
      {size:9,down:spacing(15,13),x:50});
  if(clean(data.customer_phone))
    wrapped('Telefone: '+clean(data.customer_phone),495,{size:9,down:spacing(15,13),x:50});
  if(clean(data.customer_email))
    wrapped('E-mail: '+clean(data.customer_email),495,{size:9,down:spacing(15,13),x:50});
  y-=spacing(9,5);

  section('ITENS DO PEDIDO DE VENDA');
  tableHead();
  // O texto das células é medido ANTES de desenhar; não altera o cursor global.
  function tableLines(value,maxWidth,font,size){
    const result=[];let current='';
    for(const word of clean(value).split(' ').filter(Boolean)){
      const candidate=current?current+' '+word:word;
      if(font.widthOfTextAtSize(candidate,size)<=maxWidth){current=candidate;continue;}
      if(current){result.push(current);current='';}
      let part='';
      for(const character of word){
        if(part&&font.widthOfTextAtSize(part+character,size)>maxWidth){
          result.push(part);part='';
        }
        part+=character;
      }
      current=part;
    }
    if(current)result.push(current);
    return result.length?result:[''];
  }
  for(let i=0;i<items.length;i++){
    const item=items[i],qty=Number(item.quantity),unit=Number(item.unit_price_cents);
    const nameSize=spacing(9,8.3),cellSize=spacing(8.4,7.8);
    const lineStep=spacing(12.5,11);
    const nameLines=tableLines(item.name,241,regular,nameSize);
    const skuLines=tableLines(item.sku,67,regular,cellSize);
    const contentLines=Math.max(nameLines.length,skuLines.length);
    const rowHeight=Math.max(spacing(32,27),12+(contentLines-1)*lineStep+15);

    if(y-rowHeight<153){
      newPage();section('ITENS DO PEDIDO - CONTINUACAO');tableHead();
    }
    const top=y,baseline=top-12;
    // Fundo alternado abaixo do conteúdo, sem sobrepor células.
    if(i%2===0)page.drawRectangle({x:42,y:top-rowHeight,width:511,
      height:rowHeight,color:rgb(0.975,0.985,0.98)});
    nameLines.forEach((part,j)=>{
      page.drawText(part,{x:49,y:baseline-j*lineStep,
        size:nameSize,font:regular,color:ink});
    });
    skuLines.forEach((part,j)=>{
      page.drawText(part,{x:301,y:baseline-j*lineStep,
        size:cellSize,font:regular,color:ink});
    });
    page.drawText(clean(item.unit||'UN').slice(0,4),{x:375,y:baseline,
      size:cellSize,font:regular,color:ink});
    right(qty.toLocaleString('pt-BR'),426,baseline,{size:cellSize});
    right(real(unit/100).replace('R$ ',''),488,baseline,{size:cellSize});
    right(real(qty*unit/100).replace('R$ ',''),548,baseline,
      {size:cellSize,font:bold});
    y=top-rowHeight;
    page.drawLine({start:{x:42,y},end:{x:553,y},thickness:0.4,color:gray});
  }
  y-=spacing(17,9);
  if(y<spacing(198,169))newPage();
  section('RESUMO DO PEDIDO');
  line('Nº de itens: '+itemCount+'     Soma das quantidades: '+quantitySum,
    {size:9.5,down:spacing(20,16)});
  line('Total dos produtos: '+real(expectedCents/100),{size:10,down:spacing(26,19)});
  page.drawRectangle({x:42,y:y-29,width:511,height:32,
    color:rgb(0.92,0.96,0.94)});
  page.drawText('TOTAL DO PEDIDO',{x:50,y:y-17,size:11,font:bold,color:deep});
  right(real(expectedCents/100),543,y-18,{size:15,font:bold,color:deep});
  y-=spacing(44,36);
  section('PAGAMENTO');
  wrapped('Forma de pagamento: '+paymentLabel(data.payment_method)+
    '  |  Situacao: pagamento confirmado.',
    495,{size:9,down:spacing(17,15),x:50});
  line('Data da venda: '+date(data.date)+'     Valor recebido: '+real(expectedCents/100),
    {size:9,down:spacing(26,18)});
  section('RECEBIMENTO');
  wrapped(expectedCents<10000?
    'Pedido abaixo de R$ 100,00: retirada na empresa ou entrega a combinar com a Ever Clean.':
    'Entrega disponivel mediante confirmacao de prazo e disponibilidade.',
    500,{size:9,down:spacing(16,14),x:50});
  section('OBSERVACOES');
  if(clean(data.customer_notes)){
    wrapped('Observacoes do cliente: '+clean(data.customer_notes).slice(0,500),
      500,{size:9,down:spacing(16,14),x:50});
  }
  wrapped('Pedido recebido pela Ever Clean. Informacoes de separacao e entrega sujeitas a confirmacao.',
    500,{size:9,down:spacing(16,14),x:50});
  if(data.requires_stock_review)
    wrapped('Itens sob encomenda: disponibilidade e prazo sujeitos a confirmacao.',
      500,{size:9,color:gray,down:spacing(16,14),x:50});
  y-=spacing(12,4);
  wrapped('Documento comercial com os itens e valores do pedido confirmado. '
    +'Nao substitui NF-e, DANFE ou comprovante bancario.',
    495,{size:8,color:gray,down:spacing(14,12),x:50});
  for(const p of pdf.getPages()){
    p.drawLine({start:{x:42,y:67},end:{x:553,y:67},thickness:0.5,color:gray});
    p.drawText('Ever Clean - Pedido comercial (nao fiscal)',
      {x:42,y:51,size:8,font:regular,color:gray});
    p.drawText(String(pdf.getPages().indexOf(p)+1)+' / '+pdf.getPageCount(),
      {x:515,y:51,size:8,font:regular,color:gray});
  }
  return pdf.save();
}
