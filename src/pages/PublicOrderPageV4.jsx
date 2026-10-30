import React from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Check, Clock3, CreditCard, FileText, FlaskConical, Mail, MessageCircle, Minus, PackageCheck, Plus, Search, Send, ShoppingCart, Trash2, RotateCcw } from 'lucide-react';
import { testApi } from '../lib/testApi.js';
import SuggestedProductsCarousel from '../components/SuggestedProductsCarousel.jsx';

const money=(value)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));
const dateTime=(value)=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';
const paymentLabels={pix:'PIX',cartao:'Cartão de crédito',link_pagamento:'Link de pagamento',boleto:'Boleto / compra a prazo'};
function Loading(){return <div className="loading"><div><div className="spinner"/>Carregando catálogo...</div></div>}

export default function PublicOrderPageV4(){
  const {token}=useParams();
  const [data,setData]=React.useState(null);
  const [error,setError]=React.useState('');
  const [search,setSearch]=React.useState('');
  const [category,setCategory]=React.useState('Todos');
  const [qty,setQty]=React.useState({});
  const [notes,setNotes]=React.useState('');
  const [step,setStep]=React.useState('catalog');
  const [paymentMethod,setPaymentMethod]=React.useState('');
  const [invoiceRequested,setInvoiceRequested]=React.useState(false);
  const [invoiceChannel,setInvoiceChannel]=React.useState('email');
  const [invoiceContact,setInvoiceContact]=React.useState('');
  const [sending,setSending]=React.useState(false);
  const [done,setDone]=React.useState(null);

  React.useEffect(()=>{
    let active=true;
    testApi('catalog',{token},{auth:false}).then(payload=>{
      if(!active)return;
      if(!payload?.ok){setError(payload?.message||'Link inválido, expirado ou indisponível.');return;}
      if(payload.already||payload.link?.status==='enviado'){
        setDone({request_number:payload.link?.request_number,known_total:payload.link?.known_total||0,payment_method:payload.link?.payment_method,already:true});return;
      }
      setData(payload);
      const methods=payload.customer?.payment_methods||payload.link?.payment_methods||['pix','cartao','link_pagamento'];
      setPaymentMethod(methods[0]||'pix');
      const email=payload.customer?.email||'';const phone=payload.customer?.phone||'';
      if(email){setInvoiceChannel('email');setInvoiceContact(email)}else if(phone){setInvoiceChannel('whatsapp');setInvoiceContact(phone)}
    }).catch(()=>active&&setError('Não foi possível abrir este catálogo.'));
    return()=>{active=false};
  },[token]);

  const products=data?.products||[];
  const categories=React.useMemo(()=>['Todos',...new Set(products.map(p=>p.category).filter(Boolean))],[products]);
  const filtered=products.filter(p=>`${p.name||''} ${p.sku||''} ${p.brand||''}`.toLowerCase().includes(search.toLowerCase())&&(category==='Todos'||p.category===category));
  const selected=products.filter(p=>Number(qty[p.id]||0)>0);
  const units=selected.reduce((s,p)=>s+Number(qty[p.id]||0),0);
  const orderTotal=selected.reduce((s,p)=>s+Number(qty[p.id]||0)*Number(p.base_price||0),0);
  const paymentMethods=data?.customer?.payment_methods||data?.link?.payment_methods||['pix','cartao','link_pagamento'];
  const selectedIds=new Set(selected.map(p=>p.id));
  const suggestions=(data?.suggestions||[]).filter(p=>!selectedIds.has(p.id)).slice(0,10);

  function setProductQty(product,next){setQty(current=>({...current,[product.id]:Math.max(0,Number(next||0))}))}
  function openCart(){if(!selected.length)return;setError('');setStep('cart');window.scrollTo({top:0,behavior:'smooth'})}
  function backToCatalog(){setError('');setStep('catalog');window.scrollTo({top:0,behavior:'smooth'})}
  function changeInvoiceChannel(channel){setInvoiceChannel(channel);setInvoiceContact(channel==='email'?(data?.customer?.email||''):(data?.customer?.phone||''))}
  function addSuggested(product){setProductQty(product,Number(qty[product.id]||0)+1)}
  function repeatLastOrder(){
    if(!data?.last_order?.items?.length)return;
    const next={...qty};
    data.last_order.items.forEach(item=>{const p=products.find(x=>x.id===item.product_id);if(p)next[p.id]=Math.max(1,Number(item.quantity||1))});
    setQty(next);setStep('cart');setError('');window.scrollTo({top:0,behavior:'smooth'});
  }

  async function submit(){
    if(!selected.length||sending)return;
    if(!paymentMethod||!paymentMethods.includes(paymentMethod)){setError('Escolha uma forma de pagamento disponível.');return;}
    if(invoiceRequested&&!String(invoiceContact||'').trim()){setError(`Informe o ${invoiceChannel==='email'?'e-mail':'WhatsApp'} para envio da nota fiscal.`);return;}
    if(invoiceRequested&&invoiceChannel==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(invoiceContact).trim())){setError('Informe um e-mail válido para receber a nota fiscal.');return;}
    setSending(true);setError('');
    const items=selected.map(p=>({product_id:p.id,quantity:Number(qty[p.id])}));
    const response=await testApi('submit_order',{token,items,notes,payment_method:paymentMethod,invoice_requested:invoiceRequested,invoice_channel:invoiceRequested?invoiceChannel:null,invoice_contact:invoiceRequested?String(invoiceContact).trim():null},{auth:false});
    setSending(false);
    if(!response?.ok){setError(response?.message||'Não foi possível confirmar o pedido.');return;}
    setDone(response);
  }

  if(done){const code=`EC-${String(done.request_number||0).padStart(6,'0')}`;return <div className="success"><div className="success-card"><div className="success-icon"><Check size={34}/></div><h1>{done.already?'Pedido já enviado':'Pedido confirmado!'}</h1><p className="muted">Solicitação <strong>{code}</strong></p>{Number(done.known_total||0)>0&&<div style={{margin:'18px 0',padding:16,borderRadius:14,background:'#ecf8f5',color:'#0b4f48'}}><div style={{fontSize:12,fontWeight:700,textTransform:'uppercase'}}>Valor do pedido</div><div style={{fontSize:28,fontWeight:900,marginTop:4}}>{money(done.known_total)}</div></div>}{done.payment_method&&<p><strong>Pagamento:</strong> {paymentLabels[done.payment_method]||done.payment_method}</p>}<p>{done.already?'Este link já foi utilizado e está bloqueado para um novo envio.':'A Ever Clean recebeu seu pedido e os dados de finalização.'}</p><div style={{marginTop:20,padding:14,background:'#fff6df',borderRadius:14,fontSize:13}}><FlaskConical size={15} style={{verticalAlign:-3,marginRight:6}}/>Registro temporário do ambiente de testes.</div></div></div>}
  if(error&&!data)return <div className="success"><div className="success-card"><AlertTriangle size={42} color="#a15c00"/><h2>Catálogo indisponível</h2><p className="muted">{error}</p></div></div>;
  if(!data)return <Loading/>;

  const requestCode=`EC-${String(data.link?.request_number||0).padStart(6,'0')}`;
  const header=<header className="public-header"><div className="public-header-inner"><div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>HIGIENE PROFISSIONAL</small></div></div><div style={{textAlign:'right',fontSize:11,color:'#6b7780'}}><strong style={{color:'#17443e'}}>{requestCode}</strong><br/>{step==='cart'?'Carrinho':'Pedido exclusivo'}</div></div></header>;

  if(step==='cart')return <div className="public-page">{header}<main className="public-main" style={{paddingBottom:120}}>
    <button className="btn btn-white" onClick={backToCatalog} style={{marginBottom:14}}><ArrowLeft size={16}/>Voltar ao catálogo</button>
    <section className="order-intro"><span className="eyebrow"><ShoppingCart size={13}/> Carrinho e finalização</span><h1>Confira seu pedido</h1><p>Altere quantidades, aproveite sugestões e finalize o pedido.</p></section>

    <section className="panel" style={{marginBottom:16}}><div className="panel-head"><h2>Itens do carrinho</h2></div><div style={{padding:'4px 16px 12px'}}>{selected.length?selected.map(product=>{const amount=Number(qty[product.id]||0);const subtotal=amount*Number(product.base_price||0);return <div key={product.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,padding:'15px 0',borderBottom:'1px solid #eef2f4'}}><div><strong>{product.name}</strong><div className="muted" style={{fontSize:11,marginTop:3}}>{money(product.base_price)} por {product.unit||'unidade'}</div><div className="qty" style={{marginTop:10,width:'fit-content'}}><button onClick={()=>setProductQty(product,amount-1)}><Minus size={15}/></button><input inputMode="numeric" min="0" value={amount} onChange={e=>setProductQty(product,e.target.value)}/><button onClick={()=>setProductQty(product,amount+1)}><Plus size={15}/></button><button onClick={()=>setProductQty(product,0)} title="Remover" style={{marginLeft:6}}><Trash2 size={15}/></button></div></div><strong style={{color:'#0b4f48'}}>{money(subtotal)}</strong></div>}):<div className="empty">Seu carrinho está vazio.</div>}<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:18,fontSize:18}}><strong>Total</strong><strong style={{fontSize:26,color:'#0b4f48'}}>{money(orderTotal)}</strong></div></div></section>

    <SuggestedProductsCarousel items={suggestions} onAdd={addSuggested}/>

    <section className="panel" style={{marginBottom:16}}><div className="panel-head"><h2><CreditCard size={18} style={{verticalAlign:-3,marginRight:7}}/>Forma de pagamento</h2></div><div style={{padding:16,display:'grid',gap:10}}>{paymentMethods.map(method=><label key={method} style={{display:'flex',gap:11,alignItems:'center',padding:14,border:`1px solid ${paymentMethod===method?'#0b766a':'#dfe6ea'}`,borderRadius:13,background:paymentMethod===method?'#ecf8f5':'#fff',cursor:'pointer'}}><input type="radio" name="payment" checked={paymentMethod===method} onChange={()=>setPaymentMethod(method)}/><div><strong>{paymentLabels[method]||method}</strong>{method==='boleto'&&<div className="muted" style={{fontSize:11,marginTop:2}}>Disponível conforme limite e condições comerciais do cliente.</div>}</div></label>)}</div></section>

    <section className="panel" style={{marginBottom:16}}><div className="panel-head"><h2><FileText size={18} style={{verticalAlign:-3,marginRight:7}}/>Nota fiscal</h2></div><div style={{padding:16}}><label style={{display:'flex',gap:10,alignItems:'center',fontWeight:700}}><input type="checkbox" checked={invoiceRequested} onChange={e=>setInvoiceRequested(e.target.checked)}/> Solicitar emissão de nota fiscal</label>{invoiceRequested&&<div style={{marginTop:16}}><div style={{fontSize:12,fontWeight:800,marginBottom:8}}>Enviar a nota fiscal por:</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}><button className={`btn ${invoiceChannel==='email'?'btn-primary':'btn-white'}`} onClick={()=>changeInvoiceChannel('email')}><Mail size={16}/>E-mail</button><button className={`btn ${invoiceChannel==='whatsapp'?'btn-primary':'btn-white'}`} onClick={()=>changeInvoiceChannel('whatsapp')}><MessageCircle size={16}/>WhatsApp</button></div><div className="field"><label>{invoiceChannel==='email'?'E-mail para envio':'WhatsApp para envio'}</label><input type={invoiceChannel==='email'?'email':'tel'} value={invoiceContact} onChange={e=>setInvoiceContact(e.target.value)}/></div></div>}</div></section>

    <section className="panel"><div className="panel-head"><h2>Observações</h2></div><div style={{padding:16}}><textarea className="search" style={{width:'100%',minHeight:85,padding:12}} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Horário de entrega, referência do local, faturamento..."/></div></section>
    {error&&<div className="form-error" style={{marginTop:14}}>{error}</div>}
  </main><footer className="cartbar"><div className="cartbar-inner"><div className="cart-summary"><strong>{units} unidade(s)</strong><small>Total: <strong>{money(orderTotal)}</strong></small></div><button className="btn btn-primary" disabled={!selected.length||sending} onClick={submit}><Send size={17}/>{sending?'Confirmando...':'Confirmar pedido'}</button></div></footer></div>;

  return <div className="public-page">{header}<main className="public-main">
    <section className="order-intro"><span className="eyebrow"><ShoppingCart size={13}/> Catálogo para reposição • teste</span><h1>{data.link?.customer_name||'Cliente Ever Clean'}</h1><p>Escolha os produtos e informe as quantidades. Antes de confirmar você poderá revisar tudo no carrinho.</p><p><Clock3 size={13} style={{verticalAlign:-2,marginRight:5}}/>Válido até {dateTime(data.link?.expires_at)}</p></section>
    {data?.last_order?.items?.length>0&&<section className="panel" style={{marginBottom:16,padding:16,display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><div><strong style={{display:'flex',alignItems:'center',gap:7}}><RotateCcw size={17}/>Repetir último pedido</strong><div className="muted" style={{fontSize:11,marginTop:4}}>{data.last_order.order_number} • {dateTime(data.last_order.created_at)} • {money(data.last_order.total_amount)}</div></div><button className="btn btn-primary btn-sm" onClick={repeatLastOrder}><RotateCcw size={14}/>Repetir pedido</button></section>}
    <div className="toolbar" style={{marginBottom:9}}><div style={{position:'relative',flex:1}}><Search size={17} style={{position:'absolute',left:12,top:12,color:'#849097'}}/><input className="search" style={{width:'100%',paddingLeft:38}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, marca ou código..."/></div></div>
    <div className="filter-row">{categories.map(item=><button key={item} className={`chip ${category===item?'active':''}`} onClick={()=>setCategory(item)}>{item}</button>)}</div>
    <section className="products">{filtered.map(product=>{const stock=Number(product.stock_quantity||0);const amount=Number(qty[product.id]||0);const ready=stock>0;const subtotal=amount*Number(product.base_price||0);return <article className="product-card" key={product.id}><div className="product-image">{product.image_url?<img src={product.image_url} alt={product.name} loading="lazy"/>:<PackageCheck size={42} color="#8ab7af"/>}</div><div className="product-name">{product.name}</div><div className="product-meta">{[product.sku,product.brand,product.unit].filter(Boolean).join(' • ')}</div><div className="stock-line"><span className={`badge ${ready?'green':product.catalog_allow_backorder?'orange':'red'}`}>{ready?(product.catalog_show_stock?`${stock} em estoque`:'Pronta entrega'):product.catalog_allow_backorder?'Sob encomenda':'Indisponível'}</span></div><div className="price">{money(product.base_price)}</div>{amount>0&&<div style={{fontSize:12,color:'#53656c',marginTop:4}}>Subtotal: <strong style={{color:'#0b4f48'}}>{money(subtotal)}</strong></div>}<div className="qty" style={{marginTop:12}}><button onClick={()=>setProductQty(product,amount-1)} disabled={!amount}><Minus size={16}/></button><input inputMode="numeric" min="0" value={amount||''} placeholder="0" onChange={e=>setProductQty(product,e.target.value)}/><button onClick={()=>setProductQty(product,amount+1)} disabled={!ready&&!product.catalog_allow_backorder}><Plus size={16}/></button></div></article>})}</section>
    {!filtered.length&&<div className="empty">Nenhum produto encontrado.</div>}
    {error&&<div className="form-error">{error}</div>}
  </main><footer className="cartbar"><div className="cartbar-inner"><div className="cart-summary"><strong>{selected.length} produto(s) • {units} unidade(s)</strong><small>Total: <strong>{money(orderTotal)}</strong></small></div><button className="btn btn-primary" disabled={!selected.length} onClick={openCart}><ShoppingCart size={17}/>Revisar carrinho</button></div></footer></div>;
}
