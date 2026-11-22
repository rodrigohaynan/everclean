import React from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {ShoppingCart,PackageCheck,LockKeyhole,LogOut,Copy,RefreshCw,ShieldCheck,Search,Minus,Plus,ArrowLeft,Trash2,RotateCcw} from 'lucide-react';

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
  const products=Array.isArray(data.products)?data.products:[];
  const orders=Array.isArray(data.orders)?data.orders:[];
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
  const units=selected.reduce((n,p)=>n+Number(qty[p.id]||0),0);
  const total=selected.reduce((n,p)=>n+
    Number(qty[p.id]||0)*Math.round(Number(p.price||0)*100),0)/100;
  const lastOrder=orders.find(o=>Array.isArray(o.items)&&o.items.length>0);
  function changeQty(product,next){
    if(product.can_order===false)return;
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
    setQty(draft);goto('draft');
    setNotice(missing?
      missing+' item(ns) do pedido anterior não constam no catálogo disponível.':
      'Carrinho preenchido com o pedido anterior. Confira preços e quantidades atuais.');
  }
  async function copyDraft(){
    if(!selected.length)return;
    const message=[
      'Solicitação de orçamento Ever Clean — não é pedido confirmado',
      'Cliente: '+data.customer.name,
      ...selected.map(p=>Number(qty[p.id]||0)+' × '+p.name+
        ' (SKU '+p.sku+') — '+money(p.price*qty[p.id])),
      'Total indicativo: '+money(total),
      'Preço, estoque e prazo sujeitos à confirmação da Ever Clean.'
    ].join('\n');
    try{
      await navigator.clipboard.writeText(message);
      setNotice('Resumo copiado. Encaminhe à equipe comercial da Ever Clean.');
    }catch{
      setNotice('Não foi possível copiar automaticamente. Selecione o texto manualmente.');
    }
  }
  const tabs=[{id:'products',title:'Catálogo'},{id:'history',title:'Meus pedidos ('+orders.length+')'},
    {id:'draft',title:'Carrinho ('+selected.length+')'}];
  return <div className="public-page" style={{minHeight:'100vh'}}>
    <main className="public-main" style={{maxWidth:980,paddingBottom:tab==='products'?130:42}}>
      <section className="order-intro">
        <span className="eyebrow"><ShoppingCart size={14}/> CATÁLOGO PARA REPOSIÇÃO</span>
        <h1>{data.customer.name}</h1>
        <p>Escolha seus produtos e quantidades. Revise tudo no carrinho antes de solicitar orçamento.</p>
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
        <div className="toolbar" style={{marginBottom:9}}>
          <div style={{position:'relative',flex:1}}>
            <Search size={18} style={{position:'absolute',left:12,top:12,color:'#849097'}}/>
            <input type="search" className="search" aria-label="Buscar produto"
              style={{width:'100%',paddingLeft:39}}
              placeholder="Buscar produto, marca ou código..."
              value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
        </div>
        <div className="filter-row">
          {categories.map(item=><button key={item} type="button"
            className={'chip'+(category===item?' active':'')}
            onClick={()=>setCategory(item)}>{item}</button>)}
        </div>
        <section className="products" aria-label="Produtos do catálogo">
          {filtered.map(product=>{
            const amount=Number(qty[product.id]||0);
            const subtotal=amount*Number(product.price||0);
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
              <div className="price">{money(product.price)}</div>
              {product.availability==='sob_encomenda'&&
                <div style={{fontSize:12,fontWeight:700,color:'#a16a22',marginTop:5}}>
                  Sob encomenda · disponibilidade a confirmar
                </div>}
              {product.can_order===false&&
                <div style={{fontSize:12,fontWeight:700,color:'#b05b26',marginTop:5}}>
                  Indisponível
                </div>}
              {amount>0&&<div style={{fontSize:12,color:'#53656c',marginTop:5}}>
                Subtotal: <strong style={{color:'#0b4f48'}}>{money(subtotal)}</strong>
              </div>}
              <div className="qty" style={{marginTop:12}}>
                <button type="button" aria-label={'Diminuir '+product.name}
                  disabled={!amount} onClick={()=>changeQty(product,amount-1)}>
                  <Minus size={16}/>
                </button>
                <input inputMode="numeric" aria-label={'Quantidade de '+product.name}
                  min="0" max={product.max_quantity||10000}
                  disabled={product.can_order===false} value={amount||''}
                  placeholder={product.can_order===false?'—':'0'}
                  onChange={e=>changeQty(product,e.target.value)}/>
                <button type="button" aria-label={'Adicionar '+product.name}
                  disabled={product.can_order===false}
                  onClick={()=>changeQty(product,amount+1)}><Plus size={16}/></button>
              </div>
            </article>;
          })}
        </section>
        {!filtered.length&&<div className="empty">Nenhum produto encontrado.</div>}
      </>}
      {tab==='history'&&<section className="panel" style={{padding:16,marginBottom:16}}>
        <div style={{display:'flex',gap:9,alignItems:'center',marginBottom:12}}>
          <PackageCheck size={20}/><h2 style={{margin:0,fontSize:19}}>Meus pedidos</h2>
        </div>
        {!orders.length&&<div className="empty">Você ainda não possui compras registradas.</div>}
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
          <p>Confira as quantidades. O pedido e o PIX só serão gerados após
            liberação específica da equipe Ever Clean.</p>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Itens selecionados</h2></div>
          <div style={{padding:'4px 16px 12px'}}>
            {!selected.length&&<div className="empty">Seu carrinho está vazio.</div>}
            {selected.map(product=>{
              const amount=Number(qty[product.id]||0);
              const subtotal=amount*Number(product.price||0);
              return <div key={product.id}
                style={{display:'grid',gridTemplateColumns:'65px minmax(0,1fr) auto',
                  gap:10,padding:'15px 0',borderBottom:'1px solid #edf0ef',
                  alignItems:'start'}}>
                <div style={{width:65,height:65,display:'grid',placeItems:'center',
                  overflow:'hidden',borderRadius:9,border:'1px solid #e5ece9'}}>
                  {product.image_url?
                    <img src={product.image_url} alt={product.name}
                      style={{width:'100%',height:'100%',objectFit:'contain'}}/>:
                    <PackageCheck size={27} color="#8ab7af"/>}
                </div>
                <div style={{minWidth:0}}>
                  <strong style={{fontSize:13,display:'block',lineHeight:1.3}}>
                    {product.name}
                  </strong>
                  <div className="muted" style={{fontSize:11,marginTop:4}}>
                    {money(product.price)} por {product.unit}
                  </div>
                  {product.availability==='sob_encomenda'&&
                    <div style={{fontSize:11,color:'#9b6118',marginTop:4}}>Sob encomenda</div>}
                  <div className="qty" style={{marginTop:9,width:'fit-content'}}>
                    <button type="button" onClick={()=>changeQty(product,amount-1)}>
                      <Minus size={15}/>
                    </button>
                    <input inputMode="numeric" min="0"
                      aria-label={'Quantidade de '+product.name}
                      value={amount} onChange={e=>changeQty(product,e.target.value)}/>
                    <button type="button" onClick={()=>changeQty(product,amount+1)}>
                      <Plus size={15}/>
                    </button>
                    <button type="button" aria-label={'Remover '+product.name}
                      onClick={()=>changeQty(product,0)}><Trash2 size={15}/></button>
                  </div>
                </div>
                <strong style={{fontSize:12,whiteSpace:'nowrap'}}>{money(subtotal)}</strong>
              </div>;
            })}
            <div style={{display:'flex',justifyContent:'space-between',
              alignItems:'center',paddingTop:16,gap:10}}>
              <strong>Total indicativo</strong>
              <strong style={{fontSize:24,color:'#0b4f48'}}>{money(total)}</strong>
            </div>
          </div>
        </section>
        {selected.length>0&&<section className="panel" style={{padding:16,marginTop:14}}>
          <h2 style={{fontSize:18}}>Solicitar orçamento</h2>
          <p style={{fontSize:13,color:'#53666a',margin:'9px 0 14px',lineHeight:1.5}}>
            Copie o resumo e encaminhe à equipe da Ever Clean.
            Não existe confirmação automática de pedido ou cobrança nesta etapa.
          </p>
          <button type="button" className="btn btn-primary" onClick={copyDraft}
            style={{width:'100%',justifyContent:'center',whiteSpace:'normal'}}>
            <Copy size={17}/>Copiar solicitação de orçamento
          </button>
          <button type="button" className="btn btn-white"
            onClick={()=>{setQty({});setNotice('Carrinho limpo.')}}
            style={{marginTop:10,width:'100%',justifyContent:'center'}}>
            <Trash2 size={16}/>Limpar carrinho
          </button>
        </section>}
      </>}
    </main>
    {tab==='products'&&<footer className="cartbar">
      <div className="cartbar-inner" style={{maxWidth:980}}>
        <div className="cart-summary">
          <strong>
            <span className="cart-summary-desktop">{selected.length} produto(s) · {units} unidade(s)</span>
            <span className="cart-summary-mobile">
              {selected.length} {selected.length===1?'produto':'produtos'} · {units} un.
            </span>
          </strong>
          <small>Total: <strong>{money(total)}</strong></small>
        </div>
        <button type="button" className="btn btn-primary" disabled={!selected.length}
          onClick={()=>goto('draft')}>
          <ShoppingCart size={17}/>Revisar carrinho
        </button>
      </div>
    </footer>}
  </div>;
}
export default function CustomerPortalPage(){
  const {token}=useParams();
  const navigate=useNavigate();
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
  React.useEffect(()=>{if(token){setMode('invite');return}void load()},[token,load]);
  async function logout(){
    try{await portalApi('logout')}finally{setData(null);setMode('login')}
  }
  return <div style={{minHeight:'100vh',background:'#f4f7f5',color:'#223d31'}}>
    <Header/>
    {token?<Activation token={token} onDone={()=>{
      navigate('/cliente',{replace:true});void load();
    }}/>:mode==='checking'?<div style={{...outer,textAlign:'center'}}>
      Conferindo seu acesso...
    </div>:mode==='home'&&data?<Home data={data} onRefresh={load} onLogout={logout}
      busy={busy}/>:<Login onDone={load}/>}
    {error&&<div role="alert" style={{...outer,color:'#963e2a',fontSize:13}}>{error}</div>}
  </div>;
}
