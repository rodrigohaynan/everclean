import React from 'react';
import {useParams} from 'react-router-dom';
import {ShieldCheck,LockKeyhole,ShoppingCart,RefreshCw} from 'lucide-react';

const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
async function productionApi(action,token,extra={}){
  const response=await fetch('/.netlify/functions/asaas-catalog-production',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,token,...extra})
  });
  const body=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
  if(!response.ok||!body?.ok)throw Error(body.message||'Não foi possível consultar este pedido.');
  return body;
}
export default function PublicProductionCheckoutPage(){
  const {token}=useParams();
  const [catalog,setCatalog]=React.useState(null);
  const [quantities,setQuantities]=React.useState({});
  const [quote,setQuote]=React.useState(null);
  const [payment,setPayment]=React.useState(null);
  const [status,setStatus]=React.useState(null);
  const [loading,setLoading]=React.useState('');
  const [error,setError]=React.useState('');
  const [confirmed,setConfirmed]=React.useState(false);
  const [submitLocked,setSubmitLocked]=React.useState(false);

  React.useEffect(()=>{
    let live=true;
    productionApi('catalog',token).then(data=>{if(live)setCatalog(data)})
      .catch(e=>{if(live)setError(e.message)});
    return()=>{live=false};
  },[token]);
  const items=Object.entries(quantities).filter(([,qty])=>Number(qty)>0)
    .map(([product_id,quantity])=>({product_id,quantity:Number(quantity)}));
  async function runQuote(){
    setLoading('quote');setError('');
    try{setQuote(await productionApi('quote',token,{items}))}
    catch(e){setError(e.message)}
    finally{setLoading('')}
  }
  async function createPayment(){
    if(!catalog?.enabled||!quote||!confirmed||submitLocked)return;
    if(!window.confirm('Confirmar criação de cobrança PIX REAL para este pedido?'))return;
    setSubmitLocked(true);setLoading('payment');setError('');
    try{setPayment(await productionApi('create_pix',token,{items}))}
    catch(e){setError(e.message+' Não clique novamente para evitar cobranças duplicadas.')}
    finally{setLoading('')}
  }
  async function refresh(){
    setLoading('status');setError('');
    try{setStatus((await productionApi('status',token)).order)}
    catch(e){setError(e.message)}
    finally{setLoading('')}
  }
  return <div className="public-page" style={{minHeight:'100vh',paddingBottom:30}}>
    <header className="public-header"><div className="public-header-inner">
      <div className="brand"><div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div></div>
      <strong style={{fontSize:12}}>Checkout Produção</strong>
    </div></header>
    <main className="public-main" style={{maxWidth:820,margin:'0 auto',padding:'20px 12px'}}>
      <section className="panel" style={{padding:18}}>
        <h1 style={{fontSize:22,marginBottom:8}}>Pedido de produtos</h1>
        <p style={{fontSize:13,color:'#586a69'}}>
          {catalog?('Solicitação EC-'+String(catalog.request_number||'').padStart(6,'0')+
          ' · '+catalog.customer_name):'Verificando link de pedido...'}
        </p>
        {!catalog?.enabled&&<div style={{border:'1px solid #e6d9bf',padding:13,
          background:'#fff9e9',borderRadius:12,marginTop:14}}>
          <LockKeyhole size={18} style={{verticalAlign:'middle',marginRight:7}}/>
          <strong>Pagamentos reais ainda não liberados.</strong>
          <p style={{fontSize:13,marginTop:6}}>Esta página permite apenas visualizar a preparação do catálogo.
          Não é possível criar cobranças neste momento.</p>
        </div>}
        {error&&<p role="alert" style={{color:'#a33a27',marginTop:14,fontSize:13}}>{error}</p>}
      </section>
      {catalog&&<section className="panel" style={{padding:18,marginTop:16}}>
        <h2 style={{fontSize:18,marginBottom:13}}><ShoppingCart size={19} style={{verticalAlign:-3,marginRight:8}}/>Produtos</h2>
        <div style={{display:'grid',gap:10}}>
          {(catalog.products||[]).map(p=><div key={p.id}
            style={{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',
              padding:'12px 0',borderBottom:'1px solid #e7ecea'}}>
            <div style={{minWidth:0,flex:1}}>
              <strong style={{fontSize:13}}>{p.name}</strong>
              <div style={{fontSize:12,color:'#536865',marginTop:4}}>{p.sku} · {money(p.price)} / {p.unit}</div>
              {p.availability==='sob_encomenda'&&<div style={{fontSize:11,color:'#976216',marginTop:4}}>
                Sob encomenda — sujeito a confirmação de prazo
              </div>}
            </div>
            <input type="number" inputMode="numeric" min="0" max="10000"
              disabled={!p.can_order||!!payment||submitLocked}
              value={quantities[p.id]||''} placeholder="0" aria-label={'Quantidade de '+p.name}
              onChange={e=>{
                const n=Math.max(0,Math.min(10000,Math.trunc(Number(e.target.value)||0)));
                setQuantities(q=>({...q,[p.id]:n}));setQuote(null);setConfirmed(false);
              }} style={{width:70,padding:9,border:'1px solid #d2dedb',borderRadius:9}}/>
          </div>)}
        </div>
        <button className="btn btn-primary" disabled={!items.length||!!loading||submitLocked}
          onClick={runQuote} style={{marginTop:14}}>
          {loading==='quote'?'Conferindo...':'Conferir valores do pedido'}
        </button>
        {quote&&<div style={{marginTop:14,padding:13,border:'1px solid #cbe5d9',borderRadius:12}}>
          <strong style={{fontSize:19}}>Total: {money(quote.amount)}</strong>
          {quote.requires_stock_review&&<p style={{fontSize:12,marginTop:8}}>
            Existem itens sob encomenda. A disponibilidade será revisada antes da entrega.
          </p>}
          {!catalog.enabled?<p style={{marginTop:10,fontSize:13}}>Prévia concluída sem cobrança.</p>:<>
            <label style={{display:'flex',alignItems:'flex-start',gap:8,marginTop:12,fontSize:13}}>
              <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
              Autorizo gerar uma cobrança PIX real neste valor.
            </label>
            <button className="btn btn-primary" style={{marginTop:12}}
              disabled={!confirmed||submitLocked||!!loading} onClick={createPayment}>
              Gerar PIX real
            </button>
          </>}
        </div>}
      </section>}
      {payment&&<section className="panel" style={{padding:18,marginTop:16}}>
        <h2 style={{fontSize:18}}>Cobrança {money(payment.amount)}</h2>
        <p style={{fontSize:13,marginTop:8}}>{payment.message||'Consulte a situação.'}</p>
        {payment.invoice_url&&<a className="btn btn-primary" style={{marginTop:12,display:'inline-flex'}}
          target="_blank" rel="noopener noreferrer" href={payment.invoice_url}>
          Abrir pagamento seguro no Asaas
        </a>}
      </section>}
      {(payment||status)&&<section className="panel" style={{padding:18,marginTop:16}}>
        <button className="btn btn-white" onClick={refresh} disabled={!!loading}>
          <RefreshCw size={16}/> Consultar situação do pagamento
        </button>
        {status&&<p style={{fontSize:13,marginTop:10}}>Situação registrada: <strong>{status.status}</strong></p>}
      </section>}
      <p style={{fontSize:12,color:'#527066',marginTop:16}}>
        <ShieldCheck size={16} style={{verticalAlign:-3,marginRight:6}}/>
        A baixa de estoque, o envio automático ao Bling e a emissão automática de NF-e permanecem desligados.
      </p>
    </main>
  </div>;
}
