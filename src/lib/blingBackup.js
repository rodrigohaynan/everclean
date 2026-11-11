import JSZip from 'jszip';

const norm=(value)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const cleanDoc=(value)=>String(value||'').replace(/\D/g,'');
const cleanPhone=(...values)=>{
  for(const value of values){
    const digits=String(value||'').replace(/\D/g,'');
    if(digits.length>=8)return digits;
  }
  return '';
};
const brNumber=(value)=>{
  const raw=String(value??'').trim();
  if(!raw)return null;
  const parsed=Number(raw.replace(/\./g,'').replace(',','.'));
  return Number.isFinite(parsed)?parsed:null;
};
const parseDate=(value)=>{
  const raw=String(value||'').trim();
  const match=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if(!match)return null;
  const [,d,m,y]=match;
  const date=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
  return Number.isNaN(date.getTime())?null:date;
};
const iso=(value)=>{
  const date=parseDate(value);
  return date?date.toISOString():null;
};

export function parseSemicolonCSV(text){
  const rows=[];let row=[];let field='';let quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){
      if(char==='"'&&text[i+1]==='"'){field+='"';i++;continue}
      if(char==='"'){quoted=false;continue}
      field+=char;continue;
    }
    if(char==='"'){quoted=true;continue}
    if(char===';'){row.push(field);field='';continue}
    if(char==='\r')continue;
    if(char==='\n'){row.push(field);rows.push(row);row=[];field='';continue}
    field+=char;
  }
  if(field.length||row.length){row.push(field);rows.push(row)}
  if(!rows.length)return [];
  const headers=rows[0].map(h=>h.replace(/^\uFEFF/,'').trim());
  return rows.slice(1).filter(r=>r.some(v=>String(v||'').trim())).map(values=>{
    const item={};headers.forEach((h,index)=>item[h]=values[index]??'');return item;
  });
}

function inferCategory(description,group){
  const text=norm(`${group||''} ${description||''}`);
  const rules=[
    [['PAPEL HIGIENICO','PAPEL TOALHA','PAPEL INSTITUCIONAL'],'Papéis institucionais'],
    [['SACO LIXO'],'Sacos para lixo'],
    [['SABONETE'],'Sabonetes'],
    [['DETERGENTE'],'Detergentes'],
    [['DESINFETANTE','SANETIZANTE','SANITIZANTE','HIPOCLORITO','CLORO'],'Desinfecção'],
    [['MULTIUSO','LIMPADOR'],'Limpadores'],
    [['ALCOOL'],'Álcool e antissépticos'],
    [['PANO','FLANELA','MOP','ESPONJA','VASSOURA','RODO'],'Acessórios de limpeza'],
    [['COPO','DESCARTAVEL','GUARDANAPO'],'Descartáveis'],
    [['LUVA','MASCARA','TOUCA'],'EPIs'],
    [['ODORIZADOR','AROMATIZADOR'],'Odorizadores'],
    [['DESENGRAXANTE','DESENGORDURANTE'],'Desengraxantes'],
    [['DISPENSER','SABONETEIRA','SUPORTE'],'Dispensers e suportes'],
    [['LIMPA PEDRA'],'Limpeza pesada'],
    [['IMPERMEABILIZANTE'],'Tratamento de pisos'],
  ];
  for(const [keys,label] of rules)if(keys.some(key=>text.includes(key)))return label;
  return String(group||'').trim()||'Outros';
}

function mapPayment(value){
  const text=String(value||'').toLowerCase();
  if(text.includes('boleto')||text.includes('conta a receber'))return 'boleto';
  if(text.includes('pix'))return 'pix';
  if(text.includes('dinheiro'))return 'dinheiro';
  return 'outro';
}

function getBestContact(buyer,document,contacts){
  const doc=cleanDoc(document);
  const byDoc=contacts.find(c=>doc&&cleanDoc(c['CNPJ / CPF'])===doc);
  if(byDoc)return byDoc;
  const matches=contacts.filter(c=>[c.Nome,c.Fantasia].some(name=>norm(name)===norm(buyer)));
  matches.sort((a,b)=>{
    const score=c=>['CNPJ / CPF','E-mail','Celular','Fone','Fantasia','Condição de pagamento'].reduce((sum,key)=>sum+(String(c[key]||'').trim()?1:0),0);
    return score(b)-score(a);
  });
  return matches[0]||null;
}

async function readZipCSV(zip,name){
  const entry=Object.values(zip.files).find(file=>!file.dir&&file.name.split('/').pop().toLowerCase()===name.toLowerCase());
  if(!entry)return [];
  return parseSemicolonCSV(await entry.async('string'));
}

export async function normalizeBlingBackup(file){
  const zip=await JSZip.loadAsync(file);
  const [productsRaw,contacts,sales,receivables,payables]=await Promise.all([
    readZipCSV(zip,'produtos.csv'),
    readZipCSV(zip,'contatos.csv'),
    readZipCSV(zip,'pedidos_venda.csv'),
    readZipCSV(zip,'contas_receber.csv'),
    readZipCSV(zip,'contas_pagar.csv'),
  ]);
  if(!productsRaw.length||!sales.length)throw new Error('Backup inválido: produtos.csv ou pedidos_venda.csv não encontrado.');

  const orderGroups=new Map();
  const salesBySku=new Map();
  for(const row of sales){
    const orderNumber=String(row['Número pedido']||'').trim();
    if(orderNumber){
      if(!orderGroups.has(orderNumber))orderGroups.set(orderNumber,[]);
      orderGroups.get(orderNumber).push(row);
    }
    const sku=String(row.SKU||'').trim();
    if(!sku)continue;
    if(!salesBySku.has(sku))salesBySku.set(sku,{qty:0,revenue:0,last:null,orders:new Set()});
    const stats=salesBySku.get(sku);
    stats.qty+=brNumber(row.Quantidade)||0;
    stats.revenue+=brNumber(row['Valor Total'])||0;
    stats.orders.add(orderNumber);
    const date=parseDate(row.Data);
    if(date&&(!stats.last||date>stats.last))stats.last=date;
  }

  const activeProducts=productsRaw.filter(row=>norm(row.Situação)==='ATIVO');
  const revenueRanking=[...salesBySku.entries()].sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,20).map(([sku])=>sku);
  const featuredSkus=new Set(revenueRanking);
  const skuToId=new Map();
  const products=activeProducts.map((row,index)=>{
    const sku=String(row.Código||'').trim();
    const id=`bling-product-${String(row.ID||sku||index+1).trim()}`;
    skuToId.set(sku,id);
    const stats=salesBySku.get(sku);
    const stockRaw=brNumber(row.Estoque)||0;
    const stock=Math.max(0,stockRaw);
    const price=brNumber(row.Preço);
    const recent=Boolean(stats?.last&&stats.last>=new Date(Date.UTC(2026,0,1)));
    return {
      id,sku,name:String(row.Descrição||'').trim(),brand:String(row.Marca||'').trim(),
      category:inferCategory(row.Descrição,row['Grupo de produtos']),
      unit:String(row.Unidade||row['Unidade de medida']||'').trim(),
      base_price:price,stock_quantity:stock,source_stock_raw:stockRaw,
      active:true,catalog_visible:Boolean(price&&price>0&&(recent||stock>0)),
      catalog_show_price:Boolean(price&&price>0),catalog_show_stock:true,catalog_allow_backorder:true,
      featured:featuredSkus.has(sku),on_sale:false,ncm:String(row.NCM||'').trim(),ean:String(row['GTIN/EAN']||'').trim(),
      supplier:String(row.Fornecedor||'').trim(),supplier_code:String(row['Cód no fornecedor']||'').trim(),
      description_short:String(row['Descrição Curta']||'').trim(),description_extra:String(row['Descrição Complementar']||'').trim(),
      image_url:'',source:'Bling backup 2026-11-10',
      sales_orders_count:stats?.orders?.size||0,sales_revenue:Number((stats?.revenue||0).toFixed(2)),
      sales_quantity:Number((stats?.qty||0).toFixed(3)),last_sale_at:stats?.last?.toISOString()||null,
    };
  });

  const buyerStats=new Map();
  for(const [orderNumber,rows] of orderGroups){
    const first=rows[0];const buyer=String(first['Nome Comprador']||'').trim();
    if(!buyer||norm(buyer)==='CONSUMIDOR FINAL')continue;
    if(!buyerStats.has(buyer))buyerStats.set(buyer,{orders:0,revenue:0,last:null,payments:new Map(),document:first['CPF/CNPJ Comprador']||''});
    const stats=buyerStats.get(buyer);stats.orders++;
    const total=brNumber(first['Total Pedido'])??rows.reduce((sum,row)=>sum+(brNumber(row['Valor Total'])||0),0);
    stats.revenue+=total;
    const date=parseDate(first.Data);if(date&&(!stats.last||date>stats.last))stats.last=date;
    const payment=String(first['Forma Pagamento']||'').trim();if(payment)stats.payments.set(payment,(stats.payments.get(payment)||0)+1);
    if(!stats.document&&first['CPF/CNPJ Comprador'])stats.document=first['CPF/CNPJ Comprador'];
  }

  const buyerToId=new Map();
  const clients=[...buyerStats.entries()].sort((a,b)=>(b[1].last?.getTime()||0)-(a[1].last?.getTime()||0)).map(([buyer,stats])=>{
    const contact=getBestContact(buyer,stats.document,contacts);
    const document=cleanDoc(contact?.['CNPJ / CPF']||stats.document);
    const id=`client-${String(contact?.ID||norm(buyer).toLowerCase().replace(/[^a-z0-9]+/g,'-')).trim()}`;
    buyerToId.set(buyer,id);
    let boleto=0,pix=0,cash=0;
    for(const [payment,count] of stats.payments){
      const mapped=mapPayment(payment);if(mapped==='boleto')boleto+=count;else if(mapped==='pix')pix+=count;else if(mapped==='dinheiro')cash+=count;
    }
    const credit=brNumber(contact?.['Limite de crédito'])||0;
    const terms=String(contact?.['Condição de pagamento']||'').trim();
    const allowBoleto=boleto>=2||credit>0||/boleto|prazo/i.test(terms);
    const email=String(contact?.['E-mail']||'').trim();
    const invoiceEmail=String(contact?.['E-mail para envio NFe']||'').trim()||email;
    const city=String(contact?.Cidade||'').trim(),uf=String(contact?.UF||'').trim();
    return {
      id,trade_name:String(contact?.Fantasia||'').trim()||buyer,legal_name:buyer,document,
      phone:cleanPhone(contact?.Celular,contact?.Fone),email,invoice_email:invoiceEmail,
      city:city&&uf?`${city}/${uf}`:city||uf,seller_name:'Guilherme Amaral',
      allow_boleto:allowBoleto,payment_methods:['pix','cartao','link_pagamento',...(allowBoleto?['boleto']:[])],
      preferred_payment_method:boleto>Math.max(pix,cash)?'boleto':'pix',payment_terms:terms,credit_limit:credit,
      customer_since:iso(contact?.['Cliente desde']),order_count:stats.orders,
      historical_revenue:Number(stats.revenue.toFixed(2)),average_ticket:Number((stats.revenue/stats.orders).toFixed(2)),
      last_order_at:stats.last?.toISOString()||null,created_at:iso(contact?.['Cliente desde'])||stats.last?.toISOString()||null,
      source:'Bling backup 2026-11-10',
    };
  });

  const orders=[];
  for(const [orderNumber,rows] of orderGroups){
    const first=rows[0];const buyer=String(first['Nome Comprador']||'').trim();
    if(!buyer||norm(buyer)==='CONSUMIDOR FINAL')continue;
    const items=rows.map(row=>{
      const sku=String(row.SKU||'').trim();const quantity=brNumber(row.Quantidade)||0;const unitPrice=brNumber(row['Valor Unitário'])||0;
      return {product_id:skuToId.get(sku)||null,product_sku:sku,product_name:String(row.Produto||'').trim(),quantity,unit:String(row.Un||'').trim(),unit_price_snapshot:unitPrice,subtotal:brNumber(row['Valor Total'])??quantity*unitPrice};
    });
    const total=brNumber(first['Total Pedido'])??items.reduce((sum,item)=>sum+item.subtotal,0);
    orders.push({
      id:`bling-order-${String(orderNumber).replace(/\D/g,'')||orders.length+1}`,order_number:`BLING-${orderNumber}`,
      source_order_number:orderNumber,customer_id:buyerToId.get(buyer)||null,customer_name:buyer,
      created_at:iso(first.Data),total_amount:Number(total.toFixed(2)),status:'historico',payment_method:mapPayment(first['Forma Pagamento']),
      notes:String(first.Observações||'').trim(),items,source:'Bling backup 2026-11-10',
    });
  }
  orders.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));

  const allOrders=[...orderGroups.values()].map(rows=>{
    const first=rows[0];return {date:parseDate(first.Data),total:brNumber(first['Total Pedido'])??rows.reduce((sum,row)=>sum+(brNumber(row['Valor Total'])||0),0)};
  });
  const sales2026=allOrders.filter(order=>order.date?.getUTCFullYear()===2026);
  const openValue=(rows)=>rows.filter(row=>norm(row.Situação)==='ABERTO').reduce((sum,row)=>sum+(brNumber(row['Valor documento'])||0),0);
  const financial_summary={
    backup_date:'2026-11-10',
    historical_sales_total:Number(allOrders.reduce((sum,order)=>sum+order.total,0).toFixed(2)),
    historical_orders:allOrders.length,
    sales_2026_total:Number(sales2026.reduce((sum,order)=>sum+order.total,0).toFixed(2)),
    sales_2026_orders:sales2026.length,
    sales_2026_average_ticket:Number((sales2026.reduce((sum,order)=>sum+order.total,0)/(sales2026.length||1)).toFixed(2)),
    receivables_open:Number(openValue(receivables).toFixed(2)),
    receivables_open_count:receivables.filter(row=>norm(row.Situação)==='ABERTO').length,
    payables_open:Number(openValue(payables).toFixed(2)),
    payables_open_count:payables.filter(row=>norm(row.Situação)==='ABERTO').length,
    products_active:products.length,products_catalog_visible:products.filter(product=>product.catalog_visible).length,
    clients_with_history:clients.length,imported_client_orders:orders.length,
  };

  return {products,clients,orders,financial_summary,rawCounts:{products:productsRaw.length,contacts:contacts.length,salesLines:sales.length}};
}
