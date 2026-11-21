import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';

// Documento comercial não fiscal montado a partir do pedido de venda
// confirmado pela API do Bling. O Bling não fornece um endpoint oficial
// confirmado de download da impressão nativa via API v3.
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
  pdf.setTitle('Pedido de venda Bling '+number+' - Ever Clean');
  pdf.setAuthor('Ever Clean Higiene Profissional');
  pdf.setSubject('Cópia comercial não fiscal do pedido de venda Bling');
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const deep=rgb(0.05,0.34,0.29),ink=rgb(0.12,0.17,0.19),gray=rgb(0.42,0.47,0.48);
  let page,y;
  function newPage(){
    page=pdf.addPage([595,842]);y=795;
    page.drawText('EVER CLEAN', {x:42,y,size:20,font:bold,color:deep});
    page.drawText('HIGIENE PROFISSIONAL', {x:42,y:y-20,size:9,font:regular,color:gray});
    page.drawLine({start:{x:42,y:y-34},end:{x:553,y:y-34},thickness:1.3,color:deep});
    y-=62;
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
  newPage();
  line('PEDIDO DE VENDA No '+number,{size:16,font:bold,down:24});
  line('Referencia de origem: '+reference,{size:10,down:18});
  line('Cliente: '+client,{size:10,down:18});
  line('Data do pedido: '+date(data.date),{size:10,down:18});
  line('Pagamento: PIX confirmado no Asaas',{size:10,down:18});
  y-=12;
  line('PRODUTOS',{size:12,font:bold,color:deep,down:21});
  page.drawLine({start:{x:42,y:y+8},end:{x:553,y:y+8},thickness:0.5,color:gray});
  for(const item of items){
    if(y<130)newPage();
    const qty=Number(item.quantity),unit=Number(item.unit_price_cents);
    wrapped(item.name,490,{size:10,font:bold,down:15});
    line('SKU '+clean(item.sku)+'  |  Qtde '+qty+
      '  |  Unitario '+real(unit/100)+'  |  Total '+real(qty*unit/100),
      {size:9,color:gray,down:26});
  }
  if(y<168)newPage();
  page.drawLine({start:{x:42,y:y+12},end:{x:553,y:y+12},thickness:1,color:deep});
  line('TOTAL: '+real(expectedCents/100),{size:15,font:bold,color:deep,down:28});
  if(data.requires_stock_review)wrapped(
    'Itens sob encomenda: prazo e disponibilidade sujeitos a confirmacao.',
    500,{size:9,color:gray,down:15}
  );
  y-=15;
  wrapped('Documento comercial preparado pela Ever Clean com dados do pedido de venda '
    +'consultado no Bling. Nao substitui NF-e, DANFE ou comprovante bancario.',
    510,{size:9,color:gray,down:15});
  for(const p of pdf.getPages()){
    p.drawLine({start:{x:42,y:67},end:{x:553,y:67},thickness:0.5,color:gray});
    p.drawText('Ever Clean - Pedido comercial (nao fiscal)',
      {x:42,y:51,size:8,font:regular,color:gray});
    p.drawText(String(pdf.getPages().indexOf(p)+1)+' / '+pdf.getPageCount(),
      {x:515,y:51,size:8,font:regular,color:gray});
  }
  return pdf.save();
}
