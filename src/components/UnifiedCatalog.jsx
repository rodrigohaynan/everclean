import React from 'react';
import {Minus,Plus,PackageCheck,ShoppingCart,Trash2} from 'lucide-react';

// Mesmo catálogo e carrinho para /pedido/:token e /cliente.
// Única camada visual: cada origem fornece seus próprios produtos e permissões.
// Este componente NÃO conhece endpoints e NÃO cria pedido, cobrança ou nota fiscal.
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const unitPrice=p=>Number(p?.base_price??p?.price??0);
const quantityOf=(quantities,p)=>Number(quantities?.[p.id]||0);

export function CatalogProductGrid({products=[],quantities={},onQuantityChange}){
  return <section className="products" aria-label="Produtos do catálogo">
    {products.map(product=>{
      const amount=quantityOf(quantities,product);
      const subtotal=amount*unitPrice(product);
      return <article className="product-card" key={product.id}>
        <div className="product-image">
          {product.image_url?
            <img src={product.image_url} alt={product.name} loading="lazy"/>:
            <PackageCheck size={42} color="#8ab7af"/>}
        </div>
        <div className="product-name">{product.name}</div>
        <div className="product-meta">
          {[product.sku,product.brand,product.unit].filter(Boolean).join(' • ')}
        </div>
        <div className="price">{money(unitPrice(product))}</div>
        {product.availability==='sob_encomenda'&&
          <div style={{fontSize:12,fontWeight:700,color:'#a16a22',marginTop:5}}>
            Sob encomenda · disponibilidade a confirmar
          </div>}
        {product.can_order===false&&
          <div style={{fontSize:12,fontWeight:700,color:'#b05b26',marginTop:5}}>
            Indisponível no estoque
          </div>}
        {amount>0&&<div style={{fontSize:12,color:'#53656c',marginTop:4}}>
          Subtotal: <strong style={{color:'#0b4f48'}}>{money(subtotal)}</strong>
        </div>}
        <div className="qty" style={{marginTop:12}}>
          <button type="button" aria-label={'Diminuir '+product.name}
            onClick={()=>onQuantityChange(product,amount-1)} disabled={!amount}>
            <Minus size={16}/>
          </button>
          <input inputMode="numeric" min="0" aria-label={'Quantidade de '+product.name}
            disabled={product.can_order===false} value={amount||''}
            placeholder={product.can_order===false?'Indisponível':'0'}
            onChange={e=>onQuantityChange(product,e.target.value)}/>
          <button type="button" aria-label={'Adicionar '+product.name}
            disabled={product.can_order===false}
            onClick={()=>onQuantityChange(product,amount+1)}><Plus size={16}/></button>
        </div>
      </article>;
    })}
  </section>;
}

export function CatalogCartItems({selected=[],quantities={},onQuantityChange,total=0,
  title='Itens do carrinho'}){
  return <section className="panel" style={{marginBottom:16}}>
    <div className="panel-head"><h2>{title}</h2></div>
    <div style={{padding:'4px 16px 12px'}}>
      {selected.length?selected.map(product=>{
        const amount=quantityOf(quantities,product);
        const subtotal=amount*unitPrice(product);
        return <div key={product.id} style={{display:'grid',
          gridTemplateColumns:'76px minmax(0,1fr) auto',gap:12,padding:'15px 0',
          borderBottom:'1px solid #eef2f4',alignItems:'start'}}>
          <div style={{width:76,height:76,border:'1px solid #e6ecef',borderRadius:12,
            background:'#fff',display:'flex',alignItems:'center',
            justifyContent:'center',overflow:'hidden'}}>
            {product.image_url?
              <img src={product.image_url} alt={product.name}
                style={{width:'100%',height:'100%',objectFit:'contain',padding:4}}/>:
              <PackageCheck size={30} color="#9aaca8"/>}
          </div>
          <div style={{minWidth:0}}>
            <strong style={{display:'block',lineHeight:1.25}}>{product.name}</strong>
            <div className="muted" style={{fontSize:11,marginTop:3}}>
              {money(unitPrice(product))} por {product.unit||'unidade'}
            </div>
            {product.availability==='sob_encomenda'&&
              <div style={{fontSize:11,color:'#98611c',marginTop:5}}>
                Sob encomenda: disponibilidade e prazo sujeitos à confirmação
              </div>}
            <div className="qty" style={{marginTop:10,width:'fit-content'}}>
              <button type="button" aria-label={'Diminuir '+product.name}
                disabled={!amount} onClick={()=>onQuantityChange(product,amount-1)}>
                <Minus size={15}/>
              </button>
              <input inputMode="numeric" min="0" aria-label={'Quantidade de '+product.name}
                value={amount} onChange={e=>onQuantityChange(product,e.target.value)}/>
              <button type="button" aria-label={'Adicionar '+product.name}
                disabled={product.can_order===false}
                onClick={()=>onQuantityChange(product,amount+1)}><Plus size={15}/></button>
              <button type="button" aria-label={'Remover '+product.name}
                onClick={()=>onQuantityChange(product,0)} title="Remover"
                style={{marginLeft:6}}><Trash2 size={15}/></button>
            </div>
          </div>
          <strong style={{color:'#0b4f48',whiteSpace:'nowrap'}}>{money(subtotal)}</strong>
        </div>;
      }):<div className="empty">Seu carrinho está vazio.</div>}
      <div style={{display:'flex',justifyContent:'space-between',
        alignItems:'center',paddingTop:18,fontSize:18}}>
        <strong>Total</strong>
        <strong style={{fontSize:26,color:'#0b4f48'}}>{money(total)}</strong>
      </div>
    </div>
  </section>;
}

export function CatalogCartBar({productCount=0,units=0,total=0,onReview,
  disabled=false,buttonText='Revisar carrinho'}){
  return <footer className="cartbar"><div className="cartbar-inner">
    <div className="cart-summary">
      <strong>
        <span className="cart-summary-desktop">
          {productCount} produto(s) • {units} unidade(s)
        </span>
        <span className="cart-summary-mobile">
          {productCount} {productCount===1?'produto':'produtos'} · {units} un.
        </span>
      </strong>
      <small>Total: <strong>{money(total)}</strong></small>
    </div>
    <button type="button" className="btn btn-primary" disabled={disabled||!productCount}
      onClick={onReview}><ShoppingCart size={17}/>{buttonText}</button>
  </div></footer>;
}
