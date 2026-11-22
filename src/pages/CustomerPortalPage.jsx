import React from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {ShoppingCart,PackageCheck,LockKeyhole,LogOut,Copy,RefreshCw,ShieldCheck} from 'lucide-react';

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
function Header(){return <header style={{background:'#184c38',padding:'16px 14px',color:'#fff'}}>
  <div style={{maxWidth:980,margin:'0 auto',display:'flex',alignItems:'center',
    flexWrap:'wrap',justifyContent:'space-between',gap:8}}>
    <strong style={{fontSize:20,letterSpacing:'.03em'}}>EVER CLEAN
      <small style={{display:'block',fontSize:10,fontWeight:500,letterSpacing:'.12em'}}>
        HIGIENE PROFISSIONAL
      </small>
    </strong>
    <span style={{fontSize:12}}>Portal do cliente</span>
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
  const [qty,setQty]=React.useState({});
  const [notice,setNotice]=React.useState('');
  const products=Array.isArray(data.products)?data.products:[];
  const orders=Array.isArray(data.orders)?data.orders:[];
  const chosen=Object.entries(qty).filter(([,n])=>Number(n)>0).map(([id,n])=>{
    const product=products.find(p=>String(p.id)===String(id));
    return product?{...product,quantity:Number(n)}:null;
  }).filter(Boolean);
  const total=chosen.reduce((sum,p)=>sum+Math.round(Number(p.price)*100)*p.quantity,0)/100;
  const displayed=products.filter(p=>String(p.name+' '+p.sku+' '+p.category)
    .toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).slice(0,150);
  function repeat(order){
    const draft={};let missing=0;
    for(const item of order.items||[]){
      const p=products.find(x=>String(x.sku)===String(item.sku)&&x.can_order);
      if(p)draft[p.id]=(draft[p.id]||0)+Number(item.quantity);
      else missing++;
    }
    setQty(draft);setTab('draft');
    setNotice(missing?missing+' item(ns) não estão no catálogo atual. Confira a seleção.':
      'Rascunho preenchido. Confira os preços e a disponibilidade atuais.');
  }
  async function copyDraft(){
    if(!chosen.length)return;
    const summary=[
      'Solicitação de orçamento Ever Clean (não é pedido confirmado)',
      'Cliente: '+data.customer.name,
      ...chosen.map(x=>x.quantity+' x '+x.name+' (SKU '+x.sku+') — '+money(x.price*x.quantity)),
      'Total indicativo: '+money(total),
      'Sujeito a confirmação de preços, estoque e prazo pela Ever Clean.'
    ].join('\n');
    try{await navigator.clipboard.writeText(summary);setNotice('Resumo copiado. Envie à equipe comercial da Ever Clean.')}
    catch{setNotice('Não foi possível copiar. Utilize o dispositivo para selecionar o texto.')}
  }
  return <main style={outer}>
    <section style={{...panel,marginBottom:14,background:'#f7fbf8'}}>
      <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:12}}>
        <div style={{minWidth:0}}>
          <h1 style={{fontSize:23,margin:'0 0 6px'}}>Olá, {data.customer.name}</h1>
          <p style={{color:'#536c5c',fontSize:13,margin:0}}>
            Catálogo e histórico em um único lugar.
          </p>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:7}}>
          <button onClick={onRefresh} disabled={busy} style={btn}>
            <RefreshCw size={15}/>{busy?'Atualizando...':'Atualizar'}
          </button>
          <button onClick={onLogout} style={btn}><LogOut size={15}/>Sair</button>
        </div>
      </div>
      <p style={{fontSize:12,color:'#825924',margin:'12px 0 0'}}>
        Acesso de consulta. Novos pedidos e pagamentos ainda exigem liberação da equipe.
      </p>
    </section>
    <nav aria-label="Seções do portal" style={{display:'flex',flexWrap:'wrap',gap:7,marginBottom:14}}>
      {[{id:'products',label:'Catálogo'},{id:'history',label:'Meus pedidos ('+orders.length+')'},
        {id:'draft',label:'Meu rascunho ('+chosen.length+')'}].map(t=>
        <button type="button" key={t.id} onClick={()=>{setTab(t.id);setNotice('')}}
          style={tab===t.id?primary:btn}>{t.label}</button>)}
    </nav>
    {notice&&<p role="status" style={{fontSize:13,color:'#285a43',
      background:'#edf8f0',padding:11,borderRadius:9,marginBottom:12}}>{notice}</p>}
    {tab==='products'&&<section style={panel}>
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:13}}>
        <ShoppingCart size={21} color="#216747"/><h2 style={{fontSize:19,margin:0}}>Catálogo Ever Clean</h2>
      </div>
      <input type="search" aria-label="Buscar produto" placeholder="Buscar produto ou SKU"
        value={search} onChange={e=>setSearch(e.target.value)} style={inputStyle}/>
      <p style={{fontSize:12,color:'#64776a',margin:'10px 0'}}>
        {displayed.length} produto(s) encontrado(s). Itens sem estoque podem exigir encomenda.
      </p>
      <div style={{display:'grid',gap:9}}>
        {displayed.map(p=><div key={p.id} style={{display:'flex',alignItems:'center',
          justifyContent:'space-between',gap:10,borderBottom:'1px solid #e6ede8',padding:'9px 0'}}>
          <div style={{flex:1,minWidth:0}}>
            <strong style={{fontSize:13}}>{p.name}</strong>
            <div style={{fontSize:12,color:'#586c61',marginTop:3}}>
              SKU {p.sku} · {money(p.price)} / {p.unit}
            </div>
            {p.availability==='sob_encomenda'&&
              <div style={{fontSize:11,color:'#976521'}}>Sob encomenda</div>}
          </div>
          <input type="number" min="0" max={p.max_quantity||10000}
            aria-label={'Quantidade de '+p.name} value={qty[p.id]||''} placeholder="0"
            disabled={!p.can_order} onChange={e=>{
              let n=Math.max(0,Math.min(Number(p.max_quantity)||10000,
                Math.trunc(Number(e.target.value)||0)));
              setQty(old=>({...old,[p.id]:n}));
            }} style={{...inputStyle,width:75,textAlign:'center'}}/>
        </div>)}
      </div>
      <button type="button" style={{...primary,marginTop:14}}
        onClick={()=>{setTab('draft');setNotice('Confira os preços atualizados antes de solicitar orçamento.')}}>
        Ver rascunho ({chosen.length})
      </button>
    </section>}
    {tab==='history'&&<section style={panel}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:13}}>
        <PackageCheck size={21} color="#216747"/>
        <h2 style={{fontSize:19,margin:0}}>Histórico de pedidos</h2>
      </div>
      {!orders.length&&<p style={{fontSize:13,color:'#576c60'}}>
        Nenhuma compra vinculada a este cadastro foi encontrada.
      </p>}
      <div style={{display:'grid',gap:11}}>
        {orders.map((o,i)=><article key={o.request_number+'-'+i}
          style={{border:'1px solid #dce8df',borderRadius:11,padding:12}}>
          <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:8}}>
            <div><strong style={{fontSize:14}}>EC-{o.request_number}</strong>
              <div style={{fontSize:11,color:'#67776d'}}>{dateText(o.created_at)}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <strong style={{fontSize:15}}>{money(o.amount)}</strong>
              <div style={{fontSize:12,color:o.status==='paid'?'#216747':'#93632a'}}>
                {o.status==='paid'?'PIX pago':o.status==='payment_pending'?
                  'Aguardando pagamento':'Em conferência'}
              </div>
            </div>
          </div>
          <p style={{fontSize:12,color:'#586a60',margin:'8px 0'}}>
            {o.item_count} item(ns) · {o.bling_registered?'Registrado no Bling':'Aguardando Bling'}
            {o.stock_review?' · Sob encomenda':''}
          </p>
          {(o.items||[]).map((item,j)=><div key={j}
            style={{fontSize:12,padding:'4px 0',overflowWrap:'anywhere'}}>
            {item.quantity} × {item.name} — {money(item.unit_price_cents/100)}
          </div>)}
          <button type="button" onClick={()=>repeat(o)} style={{...btn,marginTop:10}}>
            <Copy size={15}/>Repetir como rascunho
          </button>
        </article>)}
      </div>
    </section>}
    {tab==='draft'&&<section style={panel}>
      <h2 style={{fontSize:19,margin:'0 0 10px'}}>Meu rascunho de compra</h2>
      <p style={{fontSize:12,color:'#586f61'}}>
        Não gera pedido nem cobrança. Os preços apresentados são os atuais do catálogo.
      </p>
      {!chosen.length&&<p style={{fontSize:13}}>Selecione produtos na aba Catálogo.</p>}
      {chosen.map(p=><div key={p.id} style={{padding:'10px 0',
        borderBottom:'1px solid #e8ede9',display:'flex',justifyContent:'space-between',gap:10}}>
        <div style={{fontSize:13,flex:1}}>{p.quantity} × {p.name}
          <div style={{fontSize:11,color:'#647669'}}>SKU {p.sku}</div>
        </div>
        <strong style={{fontSize:13}}>{money(p.quantity*p.price)}</strong>
      </div>)}
      {!!chosen.length&&<>
        <p style={{fontSize:18,margin:'15px 0'}}>Total indicativo: <strong>{money(total)}</strong></p>
        <button type="button" onClick={copyDraft} style={primary}>
          <Copy size={16}/>Copiar solicitação de orçamento
        </button>
        <button type="button" onClick={()=>{setQty({});setNotice('Rascunho limpo.')}} style={{...btn,marginLeft:8}}>
          Limpar
        </button>
      </>}
      <p style={{fontSize:12,color:'#8a632b',marginTop:15}}>
        A solicitação só será considerada pedido após confirmação pela Ever Clean.
        O checkout financeiro geral permanece desativado neste portal.
      </p>
    </section>}
    <p style={{fontSize:11,color:'#677a6f',marginTop:18,textAlign:'center'}}>
      <ShieldCheck size={14} style={{verticalAlign:-3,marginRight:4}}/>
      Acesso protegido por sessão individual. Suas compras não são compartilhadas com outros clientes.
    </p>
  </main>
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
