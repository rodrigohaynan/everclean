import React from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {ShoppingCart,PackageCheck,LockKeyhole,LogOut,Copy,RefreshCw,ShieldCheck,Search,Minus,Plus,ArrowLeft,Trash2,RotateCcw} from 'lucide-react';
import SuggestedProductsCarousel from '../components/SuggestedProductsCarousel.jsx';
import {CatalogSearchFilters,CatalogProductGrid,CatalogCartItems,CatalogCartBar} from '../components/UnifiedCatalog.jsx';

const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dateText=n=>n?new Date(n).toLocaleDateString('pt-BR'):'—';
async function portalApi(action,body={}){
  const response=await fetch('/.netlify/functions/customer-portal',{
    method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,...body})
  });
  const result=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
  if(!response.ok||result?.ok!==true)
    throw Object.assign(new Error(result.message||'Não foi possível consultar o portal.'),
      {status:response.status});
  return result;
}
const outer={maxWidth:980,margin:'0 auto',padding:'18px 14px 44px'};
const panel={padding:18,background:'#fff',border:'1px solid #dce8e0',borderRadius:14,
  boxShadow:'0 2px 10px rgba(12,46,32,.035)'};
const inputStyle={padding:'12px',border:'1px solid #ceded4',borderRadius:9,
  width:'100%',boxSizing:'border-box'};
const btn={display:'inline-flex',justifyContent:'center',alignItems:'center',gap:7,
  border:'1px solid #bdd4c7',borderRadius:9,padding:'11px 13px',background:'#fff',
  color:'#205640',fontWeight:650,cursor:'pointer'};
const primary={...btn,background:'#216747',color:'#fff',borderColor:'#216747'};
function Header(){return <header className="public-header">
  <div className="public-header-inner" style={{maxWidth:980}}>
    <div className="brand">
      <div className="brand-mark">EC</div>
      <div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div>
    </div>
    <div style={{textAlign:'right',fontSize:12,color:'#49655b'}}>
      <strong style={{color:'#17443e'}}>Meu catálogo</strong>
      <div style={{fontSize:11}}>Acesso permanente</div>
    </div>
  </div>
</header>}
function Activation({token,onDone}){
  const [details,setDetails]=React.useState(null);
  const [password,setPassword]=React.useState('');
  const [repeat,setRepeat]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  React.useEffect(()=>{
    let active=true;
    portalApi('invite_check',{token}).then(x=>{if(active)setDetails(x)})
      .catch(e=>{if(active)setError(e.message)});
    return()=>{active=false};
  },[token]);
  async function redeem(e){
    e.preventDefault();
    if(password!==repeat){setError('As senhas não coincidem.');return}
    if(password.length<12||password.length>72){setError('Use uma senha de 12 a 72 caracteres.');return}
    setBusy(true);setError('');
    try{await portalApi('activate',{token,password});onDone()}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <main style={{...outer,maxWidth:560}}>
    <section style={panel}>
      <LockKeyhole size={27} color="#216747"/>
      <h1 style={{fontSize:23,margin:'10px 0'}}>Ativar meu acesso</h1>
      {details&&<p style={{fontSize:13,color:'#456257'}}>
        Convite para {details.customer_name}. Crie uma senha individual para acessar
        o catálogo e seus pedidos sem precisar guardar links diferentes.
      </p>}
      {details&&<form onSubmit={redeem} style={{display:'grid',gap:12,marginTop:18}}>
        <label style={{fontSize:13}}>Nova senha (mínimo 12 caracteres)
          <input type="password" minLength={12} maxLength={72} required value={password}
            onChange={e=>setPassword(e.target.value)} autoComplete="new-password"
            style={{...inputStyle,marginTop:6}}/>
        </label>
        <label style={{fontSize:13}}>Confirme a senha
          <input type="password" minLength={12} maxLength={72} required value={repeat}
            onChange={e=>setRepeat(e.target.value)} autoComplete="new-password"
            style={{...inputStyle,marginTop:6}}/>
        </label>
        <button style={primary} disabled={busy} type="submit">
          {busy?'Ativando...':'Ativar acesso'}
        </button>
      </form>}
      {error&&<p role="alert" style={{color:'#a54231',fontSize:13,marginTop:14}}>{error}</p>}
      <p style={{fontSize:12,marginTop:18}}><Link to="/cliente">Já tenho acesso ao portal</Link></p>
    </section>
  </main>
}
function Login({onDone}){
  const [email,setEmail]=React.useState('');
  const [password,setPassword]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  async function submit(e){
    e.preventDefault();setBusy(true);setError('');
    try{await portalApi('login',{email,password});onDone()}
    catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <main style={{...outer,maxWidth:540}}>
    <section style={panel}>
      <LockKeyhole size={28} color="#216747"/>
      <h1 style={{fontSize:23,margin:'11px 0'}}>Acessar minha conta</h1>
      <p style={{fontSize:13,color:'#4c665b',lineHeight:1.5}}>
        Use o e-mail e a senha configurados no seu convite Ever Clean.
        O endereço deste portal é sempre o mesmo.
      </p>
      <form onSubmit={submit} style={{display:'grid',gap:12,marginTop:18}}>
        <label style={{fontSize:13}}>E-mail cadastrado
          <input type="email" required autoComplete="username" value={email}
            onChange={e=>setEmail(e.target.value)} style={{...inputStyle,marginTop:6}}/>
        </label>
        <label style={{fontSize:13}}>Senha
          <input type="password" required autoComplete="current-password" value={password}
            onChange={e=>setPassword(e.target.value)} style={{...inputStyle,marginTop:6}}/>
        </label>
        <button type="submit" style={primary} disabled={busy}>
          {busy?'Verificando...':'Entrar no portal'}
        </button>
      </form>
      {error&&<p role="alert" style={{color:'#a54231',fontSize:13,marginTop:14}}>{error}</p>}
      <p style={{fontSize:12,color:'#5a7064',marginTop:18,lineHeight:1.6}}>
        Ainda não possui convite ou esqueceu a senha? Solicite à equipe da Ever Clean
        um novo convite de ativação. Não utilize a senha administrativa da empresa.
      </p>
    </section>
  </main>
}
function Home({data,onRefresh,onLogout,busy}){
  const [tab,setTab]=React.useState('products');
  const [search,setSearch]=React.useState('');
  const [category,setCategory]=React.useState('Todos');
  const [qty,setQty]=React.useState({});
  const [notice,setNotice]=React.useState('');
  const [notes,setNotes]=React.useState('');
  const [invoiceRequested,setInvoiceRequested]=React.useState(false);
  const [invoiceChannel,setInvoiceChannel]=React.useState('email');
  const [invoiceContact,setInvoiceContact]=React.useState('');
  const [requestBusy,setRequestBusy]=React.useState(false);
  const [requestError,setRequestError]=React.useState('');
  const [stockCheck,setStockCheck]=React.useState(null);
  const [stockBusy,setStockBusy]=React.useState(false);
  const [stockError,setStockError]=React.useState('');
  const [requestReceipt,setRequestReceipt]=React.useState(null);
  const [paymentRequestId,setPaymentRequestId]=React.useState(null);
  const [paymentMethod,setPaymentMethod]=React.useState('pix');
  const [paymentBusy,setPaymentBusy]=React.useState(false);
  const [paymentError,setPaymentError]=React.useState('');
  const [requestKey,setRequestKey]=React.useState(()=>crypto.randomUUID());
  const products=Array.isArray(data.products)?data.products:[];
  const orders=Array.isArray(data.orders)?data.orders:[];
  const sandboxOrders=Array.isArray(data.sandbox_orders)?data.sandbox_orders:[];
  const requests=Array.isArray(data.requests)?data.requests:[];
  const categories=React.useMemo(()=>
    ['Todos',...new Set(products.map(p=>p.category).filter(Boolean))],[products]);
  const filtered=React.useMemo(()=>products.filter(p=>
    (category==='Todos'||p.category===category)&&
    (String(p.name||'')+' '+String(p.sku||'')+' '+String(p.brand||''))
      .toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))
  ).sort((a,b)=>{
    const sales=Number(b.sales_orders_count||0)-Number(a.sales_orders_count||0);
    return sales||String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
  }),[products,search,category]);
  const selected=products.filter(p=>Number(qty[p.id]||0)>0);
  const matchingApprovedRequest=selected.length?requests.find(request=>{
    if(request.status!=='quoted'||!Array.isArray(request.items)||
      request.items.length!==selected.length)return false;
    return request.items.every(item=>{
      const product=selected.find(p=>String(p.sku)===String(item.sku));
      return product&&Number(qty[product.id])===Number(item.quantity)&&
        Math.round(Number(product.price)*100)===Number(item.unit_price_cents);
    });
  }):null;
  const selectedSignature=selected.map(p=>
    String(p.id)+':'+String(qty[p.id]||0)).join('|');
  React.useEffect(()=>{
    if(tab!=='draft'||!selected.length||matchingApprovedRequest){
      setStockCheck(null);setStockBusy(false);setStockError('');return;
    }
    let active=true;
    setStockCheck(null);setStockBusy(true);setStockError('');
    const items=selected.map(p=>({product_id:String(p.id),
      quantity:Number(qty[p.id])}));
    const timer=setTimeout(()=>{
      portalApi('cart_readiness',{items}).then(result=>{
        if(active)setStockCheck(result);
      }).catch(error=>{
        if(active)setStockError(error.message||
          'Não foi possível conferir a disponibilidade.');
      }).finally(()=>{if(active)setStockBusy(false)});
    },350);
    return()=>{active=false;clearTimeout(timer)};
  },[tab,selectedSignature,matchingApprovedRequest?.id]);
  const readyWithoutReview=stockCheck?.ready_for_payment===true&&
    Math.round(Number(stockCheck.amount||0)*100)===
      selected.reduce((sum,p)=>sum+Number(qty[p.id]||0)*
        Math.round(Number(p.price)*100),0);
  const units=selected.reduce((n,p)=>n+Number(qty[p.id]||0),0);
  const total=selected.reduce((n,p)=>n+
    Number(qty[p.id]||0)*Math.round(Number(p.price||0)*100),0)/100;
  const lastOrder=orders.find(o=>Array.isArray(o.items)&&o.items.length>0);
  const selectedIds=new Set(selected.map(p=>String(p.id)));
  const boughtSkus=new Set(orders.flatMap(o=>(o.items||[]).map(i=>String(i.sku))));
  const relatedCategories=new Set(selected.map(p=>p.category).filter(Boolean));
  // Mesma seção de sugestões do catálogo por link, sem chamadas adicionais
  // nem pedido gerado. Prioriza itens antes comprados e produtos relacionados.
  const suggestions=products.filter(p=>p.can_order!==false&&!selectedIds.has(String(p.id)))
    .sort((a,b)=>{
      const score=p=>(boughtSkus.has(String(p.sku))?100000:0)+
        (relatedCategories.has(p.category)?10000:0)+
        Math.max(0,Number(p.sales_orders_count)||0);
      return score(b)-score(a)||
        String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
    }).slice(0,10).map(p=>({
      ...p,base_price:p.price,
      suggestion_type:boughtSkus.has(String(p.sku))?'history':
        relatedCategories.has(p.category)?'similar':
          Number(p.sales_orders_count||0)>0?'featured':'fallback'
    }));

  function changeQty(product,next){
    if(product.can_order===false)return;
    setRequestKey(crypto.randomUUID());
    setRequestError('');setRequestReceipt(null);
    const raw=Math.trunc(Number(next)||0);
    const amount=Number.isSafeInteger(raw)?Math.max(0,Math.min(
      Number(product.max_quantity)||10000,raw)):0;
    setQty(prev=>({...prev,[product.id]:amount}));
  }
  function goto(section){
    setTab(section);setNotice('');
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function repeat(order){
    const draft={};let missing=0;
    for(const item of order.items||[]){
      const p=products.find(x=>String(x.sku)===String(item.sku)&&x.can_order!==false);
      if(p)draft[p.id]=Math.min(Number(p.max_quantity)||10000,
        (draft[p.id]||0)+Math.max(0,Number(item.quantity)||0));
      else missing++;
    }
    setQty(draft);setRequestKey(crypto.randomUUID());goto('draft');
    setNotice(missing?
      missing+' item(ns) do pedido anterior não constam no catálogo disponível.':
      'Carrinho preenchido com o pedido anterior. Confira preços e quantidades atuais.');
  }
  function selectPayment(request){
    setPaymentRequestId(request.id);
    setPaymentMethod('pix');
    setPaymentError('');
  }
  async function openApprovedPayment(request){
    if(paymentBusy||request.status!=='quoted'||paymentMethod!=='pix')return;
    setPaymentBusy(true);setPaymentError('');
    try{
      const result=await portalApi('prepare_approved_payment',{request_id:request.id});
      const target=new URL(result.url,window.location.origin);
      if(target.origin!==window.location.origin||
        !/^\/pedido-producao\/[a-f0-9]{64}$/.test(target.pathname))
        throw Error('O endereço de pagamento retornado é inválido.');
      // Somente um LINK de checkout. A cobrança é criada depois, com uma
      // segunda confirmação explícita do próprio comprador na página seguinte.
      window.location.assign(target.pathname);
    }catch(error){
      setPaymentError(error.message||'Não foi possível abrir o pagamento.');
      setPaymentBusy(false);
    }
  }
  function paymentSelector(request){
    return <div style={{background:'#fff',padding:13,marginTop:11,
      border:'1px solid #bddbc9',borderRadius:12}}>
      <strong style={{color:'#135b49',fontSize:14}}>
        Forma de pagamento · {request.request_number}
      </strong>
      <p style={{fontSize:12,color:'#53685c',marginTop:6}}>
        Pedido aprovado por {money(request.amount)}. O pagamento é feito no
        checkout seguro da Ever Clean, após conferir todos os produtos.
      </p>
      <label style={{display:'flex',gap:9,alignItems:'center',
        padding:'12px 9px',border:'1px solid #92c6b5',
        borderRadius:9,marginTop:12,background:'#effaf5'}}>
        <input type="radio" name={'approved-payment-'+request.id}
          value="pix" checked={paymentMethod==='pix'}
          onChange={()=>setPaymentMethod('pix')}/>
        <span><strong>PIX</strong>
          <span style={{display:'block',fontSize:11,color:'#477260'}}>
            Disponível · confirmação pelo Asaas</span></span>
      </label>
      <p style={{fontSize:11,color:'#69746d',marginTop:9}}>
        Cartão e boleto ainda não estão habilitados neste checkout de produção.
      </p>
      {paymentError&&<p role="alert" style={{fontSize:12,
        padding:9,background:'#fff1e9',color:'#923c2e',borderRadius:8,
        marginTop:9}}>{paymentError}</p>}
      <button type="button" className="btn btn-primary"
        style={{width:'100%',justifyContent:'center',marginTop:12,
          whiteSpace:'normal',textAlign:'center'}}
        onClick={()=>openApprovedPayment(request)}
        disabled={paymentBusy}>
        <LockKeyhole size={15}/>{paymentBusy?
          'Abrindo checkout seguro...':'Continuar para pagamento PIX'}
      </button>
      <button type="button" className="btn btn-white btn-sm"
        disabled={paymentBusy} style={{width:'100%',marginTop:8}}
        onClick={()=>{setPaymentRequestId(null);setPaymentError('')}}>
        Voltar
      </button>
      <p style={{fontSize:11,color:'#60716a',marginTop:9}}>
        Entrar no checkout não gera cobrança. O PIX real será criado somente
        após sua confirmação final de pagamento.
      </p>
    </div>;
  }
  async function sendRequest(){
    if(!selected.length||requestBusy||!data.request_enabled||matchingApprovedRequest)return;
    if(invoiceRequested&&(!invoiceContact.trim()||
      (invoiceChannel==='email'&&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceContact.trim()))||
      (invoiceChannel==='whatsapp'&&
        !/^\+?[0-9()\s-]{10,25}$/.test(invoiceContact.trim())))){
      setRequestError('Confira o contato informado para a nota fiscal.');return;
    }
    setRequestBusy(true);setRequestError('');setRequestReceipt(null);
    try{
      const result=await portalApi('submit_request',{
        idempotency_key:requestKey,
        items:selected.map(product=>({
          product_id:String(product.id),quantity:Number(qty[product.id]||0)
        })),
        notes:notes.trim(),invoice_requested:invoiceRequested,
        invoice_channel:invoiceRequested?invoiceChannel:null,
        invoice_contact:invoiceRequested?invoiceContact.trim():null
      });
      if(!result?.request?.request_number)
        throw Error('Solicitação sem protocolo. Consulte o histórico.');
      setRequestReceipt(result.request);
      setRequestKey(crypto.randomUUID());
      setQty({});setNotes('');setInvoiceRequested(false);setInvoiceContact('');
      const checkoutReady=result.request.status==='quoted'&&
        result.ready_for_payment===true;
      if(checkoutReady){
        setPaymentRequestId(result.request.id);
        setPaymentMethod('pix');
        setPaymentError('');
        setNotice('Estoque confirmado: escolha PIX e continue para o pagamento.');
      }else{
        setNotice('Solicitação '+result.request.request_number+
          ' recebida para análise de estoque e prazo.');
      }
      goto('history');
      await onRefresh();
    }catch(error){
      setRequestError(error.message||'Não foi possível confirmar o envio.');
    }finally{setRequestBusy(false)}
  }
  async function copyDraft(){
    if(!selected.length)return;
    if(invoiceRequested&&!invoiceContact.trim()){
      setNotice('Informe o contato para solicitação de nota fiscal.');return;
    }
    if(invoiceRequested&&invoiceChannel==='email'&&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceContact.trim())){
      setNotice('Informe um e-mail válido para solicitar nota fiscal.');return;
    }
    const message=[
      'Solicitação de orçamento Ever Clean — não é pedido confirmado',
      'Cliente: '+data.customer.name,
      ...selected.map(p=>Number(qty[p.id]||0)+' × '+p.name+
        ' (SKU '+p.sku+') — '+money(p.price*qty[p.id])),
      'Total indicativo: '+money(total),
      ...(notes.trim()?['Observações: '+notes.trim().slice(0,1500)]:[]),
      ...(invoiceRequested?['Solicitação de NF-e para: '+invoiceChannel+' — '+
        invoiceContact.trim().slice(0,200)]:[]),
      'Preço, estoque e prazo sujeitos à confirmação da Ever Clean.'
    ].join('\n');
    try{
      await navigator.clipboard.writeText(message);
      setNotice('Resumo copiado. Encaminhe à equipe comercial da Ever Clean.');
    }catch{
      setNotice('Não foi possível copiar automaticamente. Selecione o texto manualmente.');
    }
  }
  const tabs=[{id:'products',title:'Catálogo'},{id:'history',title:'Meus pedidos ('+(orders.length+requests.length+sandboxOrders.length)+')'},
    {id:'draft',title:'Carrinho ('+selected.length+')'}];
  return <div className="public-page" style={{minHeight:'100vh'}}>
    <main className="public-main" style={{maxWidth:980,paddingBottom:tab==='products'?130:42}}>
      <section className="order-intro">
        <span className="eyebrow"><ShoppingCart size={14}/> CATÁLOGO PARA REPOSIÇÃO</span>
        <h1>{data.customer.name}</h1>
        <p>Escolha seus produtos e quantidades. Produtos com estoque disponível seguem direto para o pagamento; encomendas precisam de análise.</p>
        <p style={{fontSize:12,marginTop:6,opacity:.9}}>
          Acesso fixo à sua área Ever Clean. Pedidos anteriores ficam disponíveis no histórico.
        </p>
      </section>
      <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:13}}>
        <div className="filter-row" style={{margin:0,flex:'1 1 270px'}}>
          {tabs.map(t=><button key={t.id} type="button"
            className={'chip'+(tab===t.id?' active':'')}
            onClick={()=>goto(t.id)}>{t.title}</button>)}
        </div>
        <button className="btn btn-white btn-sm" type="button" disabled={busy}
          onClick={onRefresh}><RefreshCw size={15}/>{busy?'Atualizando':'Atualizar'}</button>
        <button className="btn btn-white btn-sm" type="button" onClick={onLogout}>
          <LogOut size={15}/>Sair
        </button>
      </div>
      {notice&&<div role="status" style={{padding:11,background:'#ecf8f5',
        border:'1px solid #c9e7dd',borderRadius:11,color:'#175c4e',
        fontSize:13,marginBottom:13,lineHeight:1.5}}>{notice}</div>}
      {tab==='products'&&<>
        {lastOrder&&<section className="panel" style={{marginBottom:16,padding:16,
          display:'flex',justifyContent:'space-between',gap:12,
          alignItems:'center',flexWrap:'wrap'}}>
          <div>
            <strong style={{display:'flex',gap:7,alignItems:'center',fontSize:16}}>
              <RotateCcw size={18}/>Repetir último pedido
            </strong>
            <div className="muted" style={{fontSize:12,marginTop:6}}>
              EC-{lastOrder.request_number} · {dateText(lastOrder.created_at)} · {money(lastOrder.amount)}
            </div>
          </div>
          <button className="btn btn-primary btn-sm" type="button"
            onClick={()=>repeat(lastOrder)}><RotateCcw size={15}/>Repetir pedido</button>
        </section>}
        <CatalogSearchFilters search={search} onSearchChange={setSearch}
          category={category} onCategoryChange={setCategory} categories={categories}/>
        <CatalogProductGrid products={filtered} quantities={qty}
          onQuantityChange={changeQty}/>
        {!filtered.length&&<div className="empty">Nenhum produto encontrado.</div>}
      </>}
      {tab==='history'&&<section className="panel" style={{padding:16,marginBottom:16}}>
        <div style={{display:'flex',gap:9,alignItems:'center',marginBottom:12}}>
          <PackageCheck size={20}/><h2 style={{margin:0,fontSize:19}}>Meus pedidos</h2>
        </div>
        {requestReceipt&&<div role="status" style={{padding:13,border:'1px solid #a8d7be',
          background:'#eaf8ef',borderRadius:11,marginBottom:14}}>
          <strong style={{color:'#175a39'}}>{requestReceipt.status==='quoted'?
            'Estoque confirmado!':'Solicitação '+requestReceipt.request_number+' recebida!'}</strong>
          <p style={{fontSize:12,marginTop:6}}>
            {requestReceipt.status==='quoted'?
              'Pedido liberado para o PIX, sem análise prévia. Nenhuma cobrança foi criada.':
              'Registrada para análise da Ever Clean. Nenhum PIX, pedido no Bling ou nota fiscal foi criado.'}
          </p>
          {requestReceipt.status==='quoted'&&
            paymentRequestId===requestReceipt.id&&paymentSelector(requestReceipt)}
        </div>}
        {requests.length>0&&<div style={{display:'grid',gap:11,marginBottom:19}}>
          <h3 style={{fontSize:16,margin:'3px 0'}}>Solicitações enviadas</h3>
          {requests.map(request=><article key={request.id} style={{border:'1px solid #dce8df',
            borderRadius:11,padding:13,background:'#f7faf8'}}>
            <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:10}}>
              <div><strong>{request.request_number}</strong>
                <div className="muted" style={{fontSize:11,marginTop:3}}>
                  {dateText(request.created_at)}
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <strong>{money(request.amount)}</strong>
                <div style={{fontSize:12,
                  color:request.checkout_paid?'#17694c':'#976522'}}>
                  {request.checkout_paid?'Pagamento confirmado':
                    request.checkout_payment_state==='paid'?'Pagamento em verificação':
                    request.checkout_payment_state==='payment_pending'?'Aguardando PIX':
                    request.status==='received'?'Recebida · aguardando análise':
                    request.status==='in_review'?'Em análise':
                    request.status==='quoted'?
                      (request.approval_source==='automatic_stock'?
                        'Estoque disponível · pronta para pagamento':
                        'Aprovada · pronta para pagamento'):
                    request.status==='rejected'?'Não aprovada':'Concluída'}
                </div>
              </div>
            </div>
            {request.requires_stock_review&&<p style={{fontSize:12,color:'#93652d',
              margin:'7px 0'}}>Contém produtos sob encomenda</p>}
            {request.review_note&&!request.checkout_paid&&
              <p style={{fontSize:12,color:'#345c4a',
                background:'#eef8f1',borderRadius:8,padding:9,margin:'8px 0',
                overflowWrap:'anywhere'}}>
                Recado da Ever Clean: {request.review_note}
              </p>}
            {request.status==='quoted'&&!request.checkout_paid&&
              request.checkout_payment_state!=='paid'&&
              <p style={{fontSize:12,
              color:'#426456',marginTop:7,lineHeight:1.45}}>
              {request.approval_source==='automatic_stock'?
                'Estoque suficiente confirmado no envio. Continue para o PIX sem análise prévia.':
                'Solicitação aprovada pela equipe. Escolha a forma de pagamento sem nova análise.'}
            </p>}
            {(request.items||[]).map((item,index)=><div key={index} style={{fontSize:12,
              padding:'4px 0'}}>{item.quantity} × {item.name}</div>)}
            {request.checkout_paid?
              <div role="status" style={{marginTop:12,padding:12,
                border:'1px solid #b9ddc9',borderRadius:10,
                background:'#eaf7ee',fontSize:13,color:'#15583f'}}>
                <strong>PIX recebido · Pedido EC-{request.checkout_number}</strong>
                <p style={{marginTop:6,fontSize:12}}>
                  {request.checkout_bling_registered?
                    'Pagamento confirmado e venda registrada no Bling. Confira o acompanhamento do pedido abaixo.':
                    'Pagamento confirmado pelo Asaas. Registro no Bling em processamento.'}
                </p>
                <p style={{fontSize:12,marginTop:6}}>
                  Pedido pago. Não é necessário efetuar outro pagamento.
                </p>
              </div>:
              request.checkout_payment_state==='paid'?
                <p role="status" style={{fontSize:12,color:'#876124',
                  marginTop:10}}>Pagamento em verificação. Atualize para consultar
                  a confirmação, sem efetuar outra cobrança.</p>:
              request.status==='quoted'?<>
                <button type="button" className="btn btn-primary btn-sm"
                  style={{marginTop:11,width:'100%',justifyContent:'center',
                    whiteSpace:'normal'}}
                  onClick={()=>selectPayment(request)}>
                  <ShoppingCart size={16}/>{request.checkout_payment_state==='payment_pending'?
                    'Continuar pagamento PIX':'Escolher forma de pagamento'}
                </button>
                {paymentRequestId===request.id&&
                  requestReceipt?.id!==request.id&&paymentSelector(request)}
              </>:<button type="button" className="btn btn-white btn-sm"
                style={{marginTop:10}} onClick={()=>repeat({items:request.items})}>
                <RotateCcw size={15}/>Fazer novo pedido com estes itens
              </button>}
          </article>)}
        </div>}
        {data.sandbox_history_unavailable&&
          <p role="status" style={{fontSize:12,color:'#9a641f',margin:'12px 0'}}>
            O histórico de testes está temporariamente indisponível. Os pedidos reais continuam visíveis.
          </p>}
        {sandboxOrders.length>0&&<div style={{marginBottom:19,display:'grid',gap:10}}>
          <h3 style={{fontSize:16,margin:'3px 0'}}>Pedidos antigos · Ambiente de testes</h3>
          <p className="muted" style={{fontSize:12,lineHeight:1.5,margin:0}}>
            Registros históricos do Asaas Sandbox. Não são compras reais nem
            geram novos pagamentos. O checkout de testes foi encerrado.
          </p>
          {sandboxOrders.map(order=><article key={'sandbox-'+order.request_number}
            style={{border:'1px solid #eadfc6',borderRadius:11,
              padding:13,background:'#fffdf8'}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:10,
              justifyContent:'space-between',alignItems:'flex-start'}}>
              <div><strong>EC-{order.request_number}</strong>
                <div className="muted" style={{fontSize:12,marginTop:4}}>
                  {order.created_at?dateText(order.created_at):'Data não disponível'}
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <strong style={{fontSize:15,color:'#755018'}}>
                  {Number(order.amount)>0?money(order.amount):'Valor não definido'}
                </strong>
                <div style={{fontSize:12,marginTop:4,color:'#805d20'}}>
                  {({
                    simulated_paid:'Pagamento simulado',
                    payment_pending:'Pagamento não confirmado',
                    canceled:'Cancelado',
                    expired:'Expirado',
                    draft:'Não finalizado'
                  })[order.status]||'Histórico de testes'}
                </div>
              </div>
            </div>
            <div style={{fontSize:12,color:'#80652f',marginTop:9}}>
              Ambiente Sandbox · Sem movimentação de dinheiro real
            </div>
            {(order.items||[]).map((item,i)=><div key={i}
              style={{display:'flex',justifyContent:'space-between',
                gap:8,padding:'7px 0',fontSize:12,borderBottom:'1px solid #eee8db'}}>
              <div style={{minWidth:0,overflowWrap:'anywhere'}}>
                {item.quantity} × {item.name}
                {item.sku&&<div className="muted" style={{fontSize:11}}>SKU {item.sku}</div>}
              </div>
              {item.unit_price_cents>0&&
                <span style={{whiteSpace:'nowrap'}}>{money(item.quantity*item.unit_price_cents/100)}</span>}
            </div>)}
          </article>)}
        </div>}
        {!orders.length&&!sandboxOrders.length&&!requests.length&&<div className="muted" style={{fontSize:13,padding:'8px 0'}}>
          Nenhum pedido registrado neste cadastro.
        </div>}
        <div style={{display:'grid',gap:12}}>
          {orders.map((order,i)=><article key={order.request_number+'-'+i}
            style={{border:'1px solid #e0e8e5',borderRadius:12,padding:13}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:9,
              justifyContent:'space-between',alignItems:'flex-start'}}>
              <div><strong>EC-{order.request_number}</strong>
                <div className="muted" style={{fontSize:12,marginTop:3}}>
                  {dateText(order.created_at)}
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <strong style={{fontSize:16,color:'#0b4f48'}}>{money(order.amount)}</strong>
                <div style={{fontSize:12,marginTop:4}}>
                  {order.status==='paid'?'Pagamento confirmado':
                    order.status==='payment_pending'?'Aguardando PIX':'Em conferência'}
                </div>
              </div>
            </div>
            <div className="muted" style={{fontSize:12,marginTop:8}}>
              {order.bling_registered?'Registrado no Bling':'Registro no Bling pendente'}
              {order.stock_review?' · Sob encomenda':''}
            </div>
            {order.bling_registered&&<div style={{
              background:'#f1f8f4',border:'1px solid #d4e7dc',borderRadius:9,
              padding:11,marginTop:10}}>
              <strong style={{fontSize:13,color:'#216148'}}>
                Andamento: {({
                  awaiting_review:'Aguardando conferência da equipe',
                  preparing:'Em separação',
                  ready_for_delivery:'Pronto para entrega',
                  out_for_delivery:'Saiu para entrega',
                  delivered:'Entregue',
                  on_hold:'Aguardando disponibilidade'
                })[order.fulfillment_stage]||'Aguardando conferência da equipe'}
              </strong>
              {order.fulfillment_note&&<p style={{fontSize:12,
                lineHeight:1.5,marginTop:5,overflowWrap:'anywhere'}}>
                {order.fulfillment_note}
              </p>}
              <p style={{fontSize:11,color:'#688074',marginTop:5}}>
                Atualização operacional da equipe Ever Clean; não altera
                o pagamento nem representa nota fiscal.
              </p>
            </div>}
            {(order.items||[]).map((item,j)=><div key={j}
              style={{display:'flex',justifyContent:'space-between',gap:10,
                padding:'7px 0',fontSize:12,borderBottom:'1px solid #edf0ef'}}>
              <div style={{minWidth:0,overflowWrap:'anywhere'}}>
                <strong>{item.quantity} × {item.name}</strong>
                <div className="muted" style={{fontSize:11}}>SKU {item.sku}</div>
              </div>
              <span style={{whiteSpace:'nowrap'}}>{money(item.quantity*item.unit_price_cents/100)}</span>
            </div>)}
            <button type="button" className="btn btn-white btn-sm"
              onClick={()=>repeat(order)} style={{marginTop:12}}>
              <RotateCcw size={15}/>Repetir pedido
            </button>
          </article>)}
        </div>
      </section>}
      {tab==='draft'&&<>
        <button className="btn btn-white" type="button" onClick={()=>goto('products')}
          style={{marginBottom:14}}><ArrowLeft size={16}/>Voltar ao catálogo</button>
        <section className="order-intro">
          <span className="eyebrow"><ShoppingCart size={14}/> CARRINHO</span>
          <h1>Revise seus produtos</h1>
          <p>{matchingApprovedRequest?
            'Este carrinho já está aprovado. Continue para o pagamento, sem solicitar nova análise.':
            readyWithoutReview?
              'Itens disponíveis no estoque: escolha o pagamento PIX, sem análise prévia.':
              'Confira os produtos e as quantidades. Itens sob encomenda serão enviados para análise antes do pagamento.'}</p>
        </section>
        <CatalogCartItems selected={selected} quantities={qty}
          onQuantityChange={changeQty} total={total}/>
        <SuggestedProductsCarousel items={suggestions}
          onAdd={product=>changeQty(product,Number(qty[product.id]||0)+1)}/>
        {selected.length>0&&<section className="panel" style={{padding:16,marginTop:14}}>
          <h2 style={{fontSize:18}}>Observações e nota fiscal</h2>
          <p style={{fontSize:12,color:'#586b65',margin:'8px 0 12px'}}>
            Informações destinadas à equipe comercial, sem emissão fiscal automática.
          </p>
          <label style={{fontSize:13,display:'block',fontWeight:700}}>
            Observações sobre entrega, reposição ou local
            <textarea value={notes} onChange={e=>setNotes(e.target.value)}
              maxLength={1500} rows={3}
              placeholder="Horário de recebimento, endereço de entrega, referência..."
              style={{width:'100%',boxSizing:'border-box',padding:12,
                border:'1px solid #d3e0d9',borderRadius:10,marginTop:7}}/>
          </label>
          <label style={{display:'flex',alignItems:'center',gap:9,
            fontSize:13,fontWeight:700,marginTop:13}}>
            <input type="checkbox" checked={invoiceRequested}
              onChange={e=>setInvoiceRequested(e.target.checked)}/>
            Solicitar emissão de nota fiscal
          </label>
          {invoiceRequested&&<div style={{marginTop:11,display:'grid',gap:9}}>
            <label style={{fontSize:13}}>Canal para receber a nota fiscal
              <select value={invoiceChannel}
                onChange={e=>{setInvoiceChannel(e.target.value);setInvoiceContact('')}}
                style={{width:'100%',padding:10,marginTop:5,
                  border:'1px solid #d3e0d9',borderRadius:9}}>
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </label>
            <label style={{fontSize:13}}>
              {invoiceChannel==='email'?'E-mail':'WhatsApp com DDD'}
              <input value={invoiceContact} maxLength={200}
                type={invoiceChannel==='email'?'email':'tel'}
                onChange={e=>setInvoiceContact(e.target.value)}
                placeholder={invoiceChannel==='email'?'seu@email.com':'(67) 99999-9999'}
                style={{width:'100%',padding:10,boxSizing:'border-box',
                  marginTop:5,border:'1px solid #d3e0d9',borderRadius:9}}/>
            </label>
          </div>}
        </section>}
        {selected.length>0&&<section className="panel" style={{padding:16,marginTop:14}}>
          <h2 style={{fontSize:18}}>{matchingApprovedRequest||readyWithoutReview?
            'Próxima etapa: pagamento':'Revisar e continuar'}</h2>
          <p style={{fontSize:13,color:'#53666a',margin:'9px 0 14px',lineHeight:1.5}}>
            {matchingApprovedRequest?
              'Estes produtos já foram aprovados. Selecione PIX para avançar ao checkout.':
              readyWithoutReview?
                'Estoque e valores conferidos no servidor. Avance para o PIX sem precisar aguardar análise. Nenhuma cobrança será criada agora.':
                'Se houver quantidade insuficiente, a equipe precisará confirmar disponibilidade e prazo. Nenhuma cobrança será criada nesta etapa.'}
          </p>
          {selected.length>0&&!matchingApprovedRequest&&
            <p role="status" style={{fontSize:12,margin:'9px 0 12px',
              color:readyWithoutReview?'#17674c':'#8f6325'}}>
              {stockBusy?'Conferindo disponibilidade no estoque...':
                stockError?'Não foi possível confirmar o estoque: '+
                  stockError:
                readyWithoutReview?'Estoque suficiente · PIX liberado sem análise':
                stockCheck?.requires_stock_review?
                  'Quantidade acima do estoque · aguarda aprovação da equipe':
                  stockCheck?.message||'Confira a disponibilidade antes de continuar'}
            </p>}
          {requestError&&<p role="alert" style={{fontSize:13,color:'#a83d2b',
            padding:10,background:'#fff4f0',borderRadius:9}}>{requestError}</p>}
          {matchingApprovedRequest&&<>
            <div style={{background:'#eaf7f0',padding:12,borderRadius:11,
              border:'1px solid #bad9c6',marginBottom:12}}>
              <strong style={{fontSize:13,color:'#175b47'}}>
                Este carrinho já foi aprovado ({matchingApprovedRequest.request_number}).
              </strong>
              <p style={{fontSize:12,marginTop:5,color:'#45675c'}}>
                Não é necessário enviar outra solicitação.
              </p>
              <button type="button" className="btn btn-primary"
                style={{width:'100%',justifyContent:'center',marginTop:10}}
                onClick={()=>{goto('history');selectPayment(matchingApprovedRequest)}}>
                Escolher forma de pagamento
              </button>
            </div>
          </>}
          {!matchingApprovedRequest&&<button type="button" className="btn btn-primary"
            onClick={sendRequest}
            disabled={requestBusy||busy||!data.request_enabled||stockBusy}
            style={{width:'100%',justifyContent:'center',whiteSpace:'normal',
              padding:'14px 12px',marginBottom:10}}>
            <PackageCheck size={17}/>
            {requestBusy?'Processando...':
              readyWithoutReview?'Escolher forma de pagamento':
                'Enviar para análise de estoque'}
          </button>}
          <button type="button" className="btn btn-white" onClick={copyDraft}
            style={{width:'100%',justifyContent:'center',whiteSpace:'normal'}}>
            <Copy size={17}/>Copiar resumo como alternativa
          </button>
          <button type="button" className="btn btn-white"
            onClick={()=>{setQty({});setRequestKey(crypto.randomUUID());
              setRequestError('');setNotice('Carrinho limpo.')}}
            style={{marginTop:10,width:'100%',justifyContent:'center'}}>
            <Trash2 size={16}/>Limpar carrinho
          </button>
        </section>}
      </>}
    </main>
    {tab==='products'&&<CatalogCartBar productCount={selected.length}
      units={units} total={total} onReview={()=>goto('draft')}/>}

  </div>;
}
export default function CustomerPortalPage(){
  const {token,kind}=useParams();
  const navigate=useNavigate();
  const exchangeAttempt=React.useRef('');
  const [mode,setMode]=React.useState('checking');
  const [data,setData]=React.useState(null);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const load=React.useCallback(async()=>{
    setBusy(true);setError('');
    try{const home=await portalApi('home');setData(home);setMode('home')}
    catch(e){setMode('login');setData(null);if(e.status!==401)setError(e.message)}
    finally{setBusy(false)}
  },[]);
  React.useEffect(()=>{
    if(token&&kind){
      setMode('link');
      const identifier=kind+':'+token;
      if(exchangeAttempt.current===identifier)return;
      exchangeAttempt.current=identifier;
      portalApi('link_exchange',{kind,token}).then(()=>{
        navigate('/cliente',{replace:true});
      }).catch(e=>{
        setError(e.message||'Não foi possível validar o link.');
        setMode('link_error');
      });
      return;
    }
    if(token){setMode('invite');return}
    void load();
  },[token,kind,load,navigate]);
  async function logout(){
    try{await portalApi('logout')}finally{setData(null);setMode('login')}
  }
  return <div style={{minHeight:'100vh',background:'#f4f7f5',color:'#223d31'}}>
    <Header/>
    {kind&&token?
      <main style={{...outer,maxWidth:550}}>
        <section style={panel}>
          <LockKeyhole size={26} color="#216747"/>
          <h1 style={{fontSize:21,margin:'10px 0'}}>
            {mode==='link_error'?'Não foi possível abrir seu portal':
              'Abrindo seu portal Ever Clean'}
          </h1>
          <p style={{fontSize:13,lineHeight:1.5,color:'#53695b'}}>
            {mode==='link_error'?
              error||'O link pode ter expirado ou sido desativado.':
              'Validando seu link individual. Não é necessário informar senha.'}
          </p>
          {mode==='link_error'&&
            <Link to="/cliente" className="btn btn-primary"
              style={{marginTop:14}}>Entrar com minha senha</Link>}
        </section>
      </main>:
      token?<Activation token={token} onDone={()=>{
        navigate('/cliente',{replace:true});void load();
      }}/>:mode==='checking'?<div style={{...outer,textAlign:'center'}}>
        Conferindo seu acesso...
      </div>:mode==='home'&&data?<Home data={data} onRefresh={load} onLogout={logout}
        busy={busy}/>:<Login onDone={load}/>}
    {error&&!kind&&<div role="alert" style={{...outer,color:'#963e2a',fontSize:13}}>
      {error}
    </div>}
  </div>;
}
