import React from 'react';
import { useParams } from 'react-router-dom';
import { Check, Minus, Plus, Search, Send, ShoppingCart, PackageCheck, Clock3, AlertTriangle, FlaskConical } from 'lucide-react';
import { testApi } from '../lib/testApi.js';

const money=(value)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));
const dateTime=(value)=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';
function Loading(){return <div className="loading"><div><div className="spinner"/>Carregando catálogo...</div></div>}

export default function PublicOrderPage(){
  const {token}=useParams();
  const [data,setData]=React.useState(null);
  const [error,setError]=React.useState('');
  const [search,setSearch]=React.useState('');
  const [category,setCategory]=React.useState('Todos');
  const [qty,setQty]=React.useState({});
  const [notes,setNotes]=React.useState('');
  const [sending,setSending]=React.useState(false);
  const [done,setDone]=React.useState(null);

  React.useEffect(()=>{
    let active=true;
    testApi('catalog',{token},{auth:false}).then(payload=>{
      if(!active)return;
      if(!payload?.ok){setError(payload?.message||'Link inválido, expirado ou indisponível.');return;}
      if(payload.already||payload.link?.status==='enviado'){setDone({request_number:payload.link?.request_number,known_total:payload.link?.known_total||0,already:true});return;}
      setData(payload);
    }).catch(()=>active&&setError('Não foi possível abrir este catálogo.'));
    return()=>{active=false};
  },[token]);

  const products=data?.products||[];
  const categories=React.useMemo(()=>['Todos',...new Set(products.map(p=>p.category).filter(Boolean))],[products]);
  const filtered=products.filter(p=>{const text=`${p.name||''} ${p.sku||''} ${p.brand||''}`.toLowerCase();return text.includes(search.toLowerCase())&&(category==='Todos'||p.category===category)});
  const selected=products.filter(p=>Number(qty[p.id]||0)>0);
  const units=selected.reduce((sum,p)=>sum+Number(qty[p.id]||0),0);
  const orderTotal=selected.reduce((sum,p)=>sum+Number(qty[p.id]||0)*Number(p.base_price||0),0);

  function setProductQty(product,next){setQty(current=>({...current,[product.id]:Math.max(0,Number(next||0))}))}
  async function submit(){
    if(!selected.length||sending)return;
    setSending(true);setError('');
    const items=selected.map(p=>({product_id:p.id,quantity:Number(qty[p.id])}));
    const response=await testApi('submit_order',{token,items,notes},{auth:false});
    setSending(false);
    if(!response?.ok){setError(response?.message||'Não foi possível enviar o pedido.');return;}
    setDone(response);
  }

  if(done){const code=`EC-${String(done.request_number||0).padStart(6,'0')}`;return <div className="success"><div className="success-card"><div className="success-icon"><Check size={34}/></div><h1>{done.already?'Pedido já enviado':'Pedido enviado!'}</h1><p className="muted">Solicitação <strong>{code}</strong></p>{Number(done.known_total||0)>0&&<div style={{margin:'18px 0',padding:16,borderRadius:14,background:'#ecf8f5',color:'#0b4f48'}}><div style={{fontSize:12,fontWeight:700,textTransform:'uppercase'}}>Valor do pedido</div><div style={{fontSize:28,fontWeight:900,marginTop:4}}>{money(done.known_total)}</div></div>}<p>{done.already?'Este link já foi utilizado e está bloqueado para um novo envio.':'A Ever Clean recebeu seu pedido com os preços apresentados no catálogo. Nossa equipe fará a conferência de estoque e entrega.'}</p><div style={{marginTop:20,padding:14,background:'#fff6df',borderRadius:14,fontSize:13}}><FlaskConical size={15} style={{verticalAlign:-3,marginRight:6}}/>Registro temporário do ambiente de testes.</div></div></div>}
  if(error&&!data)return <div className="success"><div className="success-card"><AlertTriangle size={42} color="#a15c00"/><h2>Catálogo indisponível</h2><p className="muted">{error}</p></div></div>;
  if(!data)return <Loading/>;

  const requestCode=`EC-${String(data.link?.request_number||0).padStart(6,'0')}`;
  return <div className="public-page">
    <header className="public-header"><div className="public-header-inner"><div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>HIGIENE PROFISSIONAL</small></div></div><div style={{textAlign:'right',fontSize:11,color:'#6b7780'}}><strong style={{color:'#17443e'}}>{requestCode}</strong><br/>Pedido exclusivo</div></div></header>
    <main className="public-main">
      <section className="order-intro"><span className="eyebrow"><ShoppingCart size={13}/> Catálogo para reposição • teste</span><h1>{data.link?.customer_name||'Cliente Ever Clean'}</h1><p>Escolha os produtos e informe as quantidades. Os preços e o total do pedido são exibidos antes do envio.</p><p><Clock3 size={13} style={{verticalAlign:-2,marginRight:5}}/>Válido até {dateTime(data.link?.expires_at)}</p></section>
      <div className="toolbar" style={{marginBottom:9}}><div style={{position:'relative',flex:1}}><Search size={17} style={{position:'absolute',left:12,top:12,color:'#849097'}}/><input className="search" style={{width:'100%',paddingLeft:38}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, marca ou código..."/></div></div>
      <div className="filter-row">{categories.map(item=><button key={item} className={`chip ${category===item?'active':''}`} onClick={()=>setCategory(item)}>{item}</button>)}</div>
      <section className="products">{filtered.map(product=>{const stock=Number(product.stock_quantity||0);const amount=Number(qty[product.id]||0);const ready=stock>0;const subtotal=amount*Number(product.base_price||0);return <article className="product-card" key={product.id}><div className="product-image">{product.image_url?<img src={product.image_url} alt={product.name} loading="lazy"/>:<PackageCheck size={42} color="#8ab7af"/>}</div><div className="product-name">{product.name}</div><div className="product-meta">{[product.sku,product.brand,product.unit].filter(Boolean).join(' • ')}</div><div className="stock-line"><span className={`badge ${ready?'green':product.catalog_allow_backorder?'orange':'red'}`}>{ready?(product.catalog_show_stock?`${stock} em estoque`:'Pronta entrega'):product.catalog_allow_backorder?'Sob encomenda':'Indisponível'}</span></div><div className="price">{money(product.base_price)}</div>{amount>0&&<div style={{fontSize:12,color:'#53656c',marginTop:4}}>Subtotal: <strong style={{color:'#0b4f48'}}>{money(subtotal)}</strong></div>}<div className="qty" style={{marginTop:12}}><button onClick={()=>setProductQty(product,amount-1)} disabled={!amount}><Minus size={16}/></button><input inputMode="numeric" min="0" value={amount||''} placeholder="0" onChange={e=>setProductQty(product,e.target.value)}/><button onClick={()=>setProductQty(product,amount+1)} disabled={!ready&&!product.catalog_allow_backorder}><Plus size={16}/></button></div></article>})}</section>
      {!filtered.length&&<div className="empty">Nenhum produto encontrado.</div>}
      {selected.length>0&&<div className="panel" style={{marginTop:20}}><div className="panel-head"><h2>Resumo do pedido</h2></div><div style={{padding:16}}>{selected.map(product=>{const amount=Number(qty[product.id]||0);const subtotal=amount*Number(product.base_price||0);return <div key={product.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,padding:'10px 0',borderBottom:'1px solid #eef2f4'}}><div><strong style={{fontSize:13}}>{product.name}</strong><div className="muted" style={{fontSize:11}}>{amount} × {money(product.base_price)}</div></div><strong style={{fontSize:13,color:'#0b4f48'}}>{money(subtotal)}</strong></div>})}<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:16,fontSize:18}}><strong>Total do pedido</strong><strong style={{fontSize:24,color:'#0b4f48'}}>{money(orderTotal)}</strong></div></div><div style={{padding:'0 16px 16px'}}><textarea className="search" style={{width:'100%',minHeight:80,padding:12}} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observações do pedido..."/></div></div>}
      {error&&<div className="form-error">{error}</div>}
    </main>
    <footer className="cartbar"><div className="cartbar-inner"><div className="cart-summary"><strong>{selected.length} produto(s) • {units} unidade(s)</strong><small>Total: <strong>{money(orderTotal)}</strong></small></div><button className="btn btn-primary" disabled={!selected.length||sending} onClick={submit}><Send size={17}/>{sending?'Enviando...':'Enviar pedido'}</button></div></footer>
  </div>;
}
