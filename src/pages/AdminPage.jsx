import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { BarChart3, Box, CheckCircle2, ClipboardList, Copy, ExternalLink, Link2, LogOut, Package, RefreshCw, Save, Search, ShoppingCart, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase.js';

const nav = [
  { path: '/admin', label: 'Painel Geral', icon: BarChart3, end: true },
  { path: '/admin/clientes', label: 'Clientes', icon: Users },
  { path: '/admin/produtos', label: 'Produtos', icon: Package },
  { path: '/admin/pedidos', label: 'Pedidos', icon: ShoppingCart },
  { path: '/admin/links-pedido', label: 'Links de Pedido', icon: Link2 },
];
const fmtDate = (v) => v ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—';
const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const clientName = (c) => c?.trade_name || c?.company_name || c?.name || c?.fantasy_name || 'Cliente Ever Clean';
const phoneOf = (c) => c?.phone || c?.whatsapp || c?.commercial_phone || '';
const orderCode = (n) => `EC-${String(n || 0).padStart(6, '0')}`;

function Brand() {
  return <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>HIGIENE PROFISSIONAL</small></div></div>;
}
function Loading() { return <div className="loading"><div><div className="spinner" />Carregando...</div></div>; }
function Status({ value }) {
  const cls = ['enviado','convertido_pedido','atendido'].includes(value) ? 'green' : ['cancelado','expirado'].includes(value) ? 'red' : 'orange';
  const labels = { gerado:'Gerado', aberto:'Aberto', enviado:'Recebido', convertido_orcamento:'Orçamento', convertido_pedido:'Pedido', expirado:'Expirado', cancelado:'Cancelado', atendido:'Atendido' };
  return <span className={`badge ${cls}`}>{labels[value] || value || '—'}</span>;
}

export default function AdminPage({ section = 'dashboard' }) {
  const navigate = useNavigate();
  const [session, setSession] = React.useState(undefined);
  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session || null); if (!data.session) navigate('/login', { replace: true }); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); if (!next) navigate('/login', { replace: true }); });
    return () => sub?.subscription?.unsubscribe();
  }, [navigate]);
  async function logout() { await supabase.auth.signOut(); navigate('/login', { replace: true }); }
  if (session === undefined) return <Loading />;
  if (!session) return null;
  return (
    <div className="layout">
      <aside className="sidebar">
        <Brand />
        <nav className="nav">{nav.map((item) => { const Icon=item.icon; return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={18}/>{item.label}</NavLink>; })}</nav>
        <div className="sidebar-foot"><button className="btn" style={{width:'100%',background:'transparent',color:'#d8ebe8',justifyContent:'flex-start'}} onClick={logout}><LogOut size={17}/> Sair</button></div>
      </aside>
      <main className="main">
        <header className="topbar"><Brand/><div className="topbar-actions"><span className="hide-mobile" style={{fontSize:12,color:'#6d7a80'}}>{session.user?.email}</span><button className="btn btn-white btn-sm" onClick={logout}><LogOut size={15}/> Sair</button></div></header>
        <div className="content">
          {section === 'dashboard' && <Dashboard />}
          {section === 'clients' && <Clients />}
          {section === 'products' && <Products />}
          {section === 'orders' && <Orders />}
          {section === 'links' && <OrderLinks />}
        </div>
      </main>
    </div>
  );
}

function Dashboard() {
  const [stats,setStats]=React.useState(null);
  async function load(){
    const [c,p,l,o] = await Promise.all([
      supabase.from('ec_customers').select('id',{count:'exact',head:true}),
      supabase.from('products').select('id',{count:'exact',head:true}).eq('active',true),
      supabase.from('ec_order_links').select('id',{count:'exact',head:true}).eq('status','enviado'),
      supabase.from('ec_orders').select('id,total_amount').order('created_at',{ascending:false}).limit(100),
    ]);
    setStats({clients:c.count||0,products:p.count||0,newOrders:l.count||0,orders:o.data||[]});
  }
  React.useEffect(()=>{load();},[]);
  if(!stats)return <Loading/>;
  const total=stats.orders.reduce((s,o)=>s+Number(o.total_amount||0),0);
  return <>
    <section className="hero"><div><span className="eyebrow">CENTRAL EVER CLEAN</span><h1>Painel Geral</h1><p>Clientes, catálogo, pedidos por link e operação comercial em um só lugar.</p></div><button className="btn btn-white" onClick={load}><RefreshCw size={16}/>Atualizar</button></section>
    <div className="grid-stats"><div className="stat"><small>Clientes</small><strong>{stats.clients}</strong></div><div className="stat"><small>Produtos ativos</small><strong>{stats.products}</strong></div><div className="stat"><small>Pedidos por link</small><strong>{stats.newOrders}</strong></div><div className="stat"><small>Vendas carregadas</small><strong>{money(total)}</strong></div></div>
    <div className="panel"><div className="panel-head"><h2>Fluxo do pedido online</h2></div><div style={{padding:20,lineHeight:1.8,color:'#53656c'}}>Cliente cadastrado → gerar link → cliente abre catálogo sem login → seleciona quantidades → envia → pedido entra em <strong>Links de Pedido</strong> → Ever Clean confirma preços/estoque → orçamento ou pedido.</div></div>
  </>;
}

function Clients(){
  const [rows,setRows]=React.useState([]),[search,setSearch]=React.useState(''),[loading,setLoading]=React.useState(true),[busy,setBusy]=React.useState('');
  async function load(){setLoading(true);const {data,error}=await supabase.from('ec_customers').select('*').order('created_at',{ascending:false});setLoading(false);if(error)toast.error(error.message);else setRows(data||[]);}
  React.useEffect(()=>{load();},[]);
  const filtered=rows.filter(c=>`${clientName(c)} ${c.document||c.cnpj||''}`.toLowerCase().includes(search.toLowerCase()));
  async function generate(c){setBusy(c.id);const {data,error}=await supabase.rpc('ec_create_order_link',{p_customer_id:c.id,p_days:7});setBusy('');if(error||!data?.ok){toast.error(error?.message||data?.message||'Não foi possível gerar o link.');return;}const url=`${window.location.origin}/pedido/${data.token}`;try{await navigator.clipboard.writeText(url);}catch{}toast.success(`${orderCode(data.request_number)} criado e copiado`);const phone=phoneOf(c).replace(/\D/g,'');if(phone&&window.confirm('Link copiado. Deseja abrir o WhatsApp do cliente?')){const number=phone.startsWith('55')?phone:`55${phone}`;window.open(`https://wa.me/${number}?text=${encodeURIComponent(`Olá! Seu catálogo Ever Clean para reposição está disponível: ${url}`)}`,'_blank');}}
  return <><section className="hero"><div><span className="eyebrow"><Users size={12}/>CLIENTES</span><h1>Clientes</h1><p>Gere um catálogo exclusivo e envie em segundos.</p></div><button className="btn btn-white" onClick={load}><RefreshCw size={16}/>Atualizar</button></section><div className="panel"><div className="panel-head"><div className="toolbar"><div style={{position:'relative'}}><Search size={16} style={{position:'absolute',left:12,top:13,color:'#819096'}}/><input className="search" style={{paddingLeft:36}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente ou CNPJ..."/></div></div></div>{loading?<Loading/>:<div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Documento</th><th>Telefone</th><th>Vendedor</th><th style={{textAlign:'right'}}>Ação</th></tr></thead><tbody>{filtered.map(c=><tr key={c.id}><td><strong>{clientName(c)}</strong><div className="muted" style={{fontSize:11}}>{c.city||''}</div></td><td>{c.document||c.cnpj||'—'}</td><td>{phoneOf(c)||'—'}</td><td>{c.seller_name||c.seller||'Guilherme Amaral'}</td><td><div className="actions"><button className="btn btn-primary btn-sm" disabled={busy===c.id} onClick={()=>generate(c)}><Link2 size={14}/>{busy===c.id?'Gerando...':'Gerar link'}</button></div></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty">Nenhum cliente encontrado.</div>}</div>}</div></>;
}

function Products(){
  const [rows,setRows]=React.useState([]),[search,setSearch]=React.useState(''),[loading,setLoading]=React.useState(true),[edit,setEdit]=React.useState(null),[saving,setSaving]=React.useState(false);
  async function load(){setLoading(true);const {data,error}=await supabase.from('products').select('*').order('name');setLoading(false);if(error)toast.error(error.message);else setRows(data||[]);}
  React.useEffect(()=>{load();},[]);
  const filtered=rows.filter(p=>`${p.name||''} ${p.sku||''} ${p.brand||''}`.toLowerCase().includes(search.toLowerCase()));
  async function save(){setSaving(true);const payload={name:edit.name,base_price:edit.base_price===''?null:Number(edit.base_price||0),stock_quantity:Number(edit.stock_quantity||0),active:Boolean(edit.active),catalog_visible:Boolean(edit.catalog_visible),catalog_show_price:Boolean(edit.catalog_show_price),catalog_show_stock:Boolean(edit.catalog_show_stock),catalog_allow_backorder:Boolean(edit.catalog_allow_backorder)};const {error}=await supabase.from('products').update(payload).eq('id',edit.id);setSaving(false);if(error){toast.error(error.message);return;}toast.success('Produto atualizado');setEdit(null);load();}
  return <><section className="hero"><div><span className="eyebrow"><Box size={12}/>CATÁLOGO</span><h1>Produtos</h1><p>Controle estoque e o que o cliente pode visualizar no catálogo.</p></div><button className="btn btn-white" onClick={load}><RefreshCw size={16}/>Atualizar</button></section><div className="panel"><div className="panel-head"><div className="toolbar"><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, marca ou SKU..."/></div></div>{loading?<Loading/>:<div className="table-wrap"><table className="table"><thead><tr><th>Produto</th><th>Preço</th><th>Estoque</th><th>Catálogo</th><th>Preço público</th><th style={{textAlign:'right'}}>Ação</th></tr></thead><tbody>{filtered.map(p=><tr key={p.id}><td><strong>{p.name}</strong><div className="muted" style={{fontSize:11}}>{[p.sku,p.brand,p.unit].filter(Boolean).join(' • ')}</div></td><td>{p.base_price!=null?money(p.base_price):'—'}</td><td>{Number(p.stock_quantity||0)}</td><td><span className={`badge ${p.catalog_visible!==false?'green':'red'}`}>{p.catalog_visible!==false?'Visível':'Oculto'}</span></td><td><span className={`badge ${p.catalog_show_price?'green':'orange'}`}>{p.catalog_show_price?'Exibe':'Consulta'}</span></td><td><div className="actions"><button className="icon-btn" title="Editar" onClick={()=>setEdit({...p,catalog_visible:p.catalog_visible!==false,catalog_show_stock:p.catalog_show_stock!==false,catalog_allow_backorder:p.catalog_allow_backorder!==false})}><Save size={15}/></button></div></td></tr>)}</tbody></table></div>}</div>{edit&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>Editar produto</h3><button className="icon-btn" onClick={()=>setEdit(null)}><XCircle size={17}/></button></div><div className="modal-body"><div className="field"><label>Produto</label><input value={edit.name||''} onChange={e=>setEdit({...edit,name:e.target.value})}/></div><div className="product-edit"><div className="field"><label>Preço de referência</label><input type="number" step="0.01" value={edit.base_price??''} onChange={e=>setEdit({...edit,base_price:e.target.value})}/></div><div className="field"><label>Estoque atual</label><input type="number" value={edit.stock_quantity??0} onChange={e=>setEdit({...edit,stock_quantity:e.target.value})}/></div></div><div style={{display:'grid',gap:12,marginTop:10}}><label className="switch"><input type="checkbox" checked={Boolean(edit.active)} onChange={e=>setEdit({...edit,active:e.target.checked})}/> Produto ativo</label><label className="switch"><input type="checkbox" checked={Boolean(edit.catalog_visible)} onChange={e=>setEdit({...edit,catalog_visible:e.target.checked})}/> Exibir no catálogo</label><label className="switch"><input type="checkbox" checked={Boolean(edit.catalog_show_price)} onChange={e=>setEdit({...edit,catalog_show_price:e.target.checked})}/> Exibir preço para o cliente</label><label className="switch"><input type="checkbox" checked={Boolean(edit.catalog_show_stock)} onChange={e=>setEdit({...edit,catalog_show_stock:e.target.checked})}/> Exibir quantidade em estoque</label><label className="switch"><input type="checkbox" checked={Boolean(edit.catalog_allow_backorder)} onChange={e=>setEdit({...edit,catalog_allow_backorder:e.target.checked})}/> Permitir pedido sob encomenda</label></div></div><div className="modal-foot"><button className="btn btn-white" onClick={()=>setEdit(null)}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={saving}><Save size={16}/>{saving?'Salvando...':'Salvar'}</button></div></div></div>}</>;
}

function Orders(){
  const [rows,setRows]=React.useState([]),[loading,setLoading]=React.useState(true),[search,setSearch]=React.useState('');
  async function load(){setLoading(true);const {data,error}=await supabase.from('ec_orders').select('*').order('created_at',{ascending:false}).limit(200);setLoading(false);if(error)toast.error(error.message);else setRows(data||[]);}
  React.useEffect(()=>{load();},[]);const filtered=rows.filter(o=>`${o.order_number||o.bling_order_number||o.id||''} ${o.customer_name||o.client_name||''}`.toLowerCase().includes(search.toLowerCase()));
  return <><section className="hero"><div><span className="eyebrow"><ShoppingCart size={12}/>CENTRAL DE PEDIDOS</span><h1>Pedidos Ever Clean</h1><p>Histórico comercial e pedidos confirmados.</p></div><button className="btn btn-white" onClick={load}><RefreshCw size={16}/>Atualizar</button></section><div className="panel"><div className="panel-head"><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pedido ou cliente..."/></div>{loading?<Loading/>:<div className="table-wrap"><table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Status</th></tr></thead><tbody>{filtered.map((o,i)=><tr key={o.id||i}><td><strong>#{o.order_number||o.bling_order_number||String(o.id||'').slice(0,8)}</strong></td><td>{o.customer_name||o.client_name||'—'}</td><td>{fmtDate(o.order_date||o.created_at)}</td><td>{money(o.total_amount||o.total||0)}</td><td><Status value={o.status}/></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty">Nenhum pedido encontrado.</div>}</div>}</div></>;
}

function OrderLinks(){
  const [rows,setRows]=React.useState([]),[loading,setLoading]=React.useState(true),[search,setSearch]=React.useState(''),[detail,setDetail]=React.useState(null),[items,setItems]=React.useState([]);
  async function load(){setLoading(true);const {data,error}=await supabase.from('ec_order_links').select('*').order('created_at',{ascending:false}).limit(300);setLoading(false);if(error)toast.error(error.message);else setRows(data||[]);}
  React.useEffect(()=>{load();},[]);
  async function openDetail(row){setDetail(row);const {data,error}=await supabase.from('ec_order_link_items').select('*').eq('order_link_id',row.id).order('created_at');if(error)toast.error(error.message);else setItems(data||[]);}
  function copy(row){const url=`${window.location.origin}/pedido/${row.token}`;navigator.clipboard?.writeText(url);toast.success('Link copiado');}
  async function cancel(row){if(!window.confirm('Cancelar este link?'))return;const {error}=await supabase.from('ec_order_links').update({status:'cancelado'}).eq('id',row.id);if(error)toast.error(error.message);else{toast.success('Link cancelado');load();}}
  const filtered=rows.filter(r=>`${r.request_number||''} ${r.customer_name||''} ${r.status||''}`.toLowerCase().includes(search.toLowerCase()));
  return <><section className="hero"><div><span className="eyebrow"><Link2 size={12}/>PEDIDOS POR LINK</span><h1>Links enviados aos clientes</h1><p>Acompanhe abertura, envio e os itens solicitados.</p></div><button className="btn btn-white" onClick={load}><RefreshCw size={16}/>Atualizar</button></section><div className="panel"><div className="panel-head"><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar número, cliente ou status..."/></div>{loading?<Loading/>:<div className="table-wrap"><table className="table"><thead><tr><th>Número</th><th>Cliente</th><th>Criado</th><th>Aberto</th><th>Enviado</th><th>Status</th><th style={{textAlign:'right'}}>Ações</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id}><td><strong>{orderCode(r.request_number)}</strong></td><td>{r.customer_name}</td><td>{fmtDate(r.created_at)}</td><td>{fmtDate(r.first_opened_at)}</td><td>{fmtDate(r.submitted_at)}</td><td><Status value={r.status}/></td><td><div className="actions"><button className="icon-btn" title="Ver itens" onClick={()=>openDetail(r)}><ClipboardList size={15}/></button>{!['enviado','cancelado','expirado'].includes(r.status)&&<><button className="icon-btn" title="Copiar link" onClick={()=>copy(r)}><Copy size={15}/></button><button className="icon-btn" title="Abrir link" onClick={()=>window.open(`/pedido/${r.token}`,'_blank')}><ExternalLink size={15}/></button><button className="icon-btn" title="Cancelar" onClick={()=>cancel(r)}><XCircle size={15}/></button></>}</div></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty">Nenhum link encontrado.</div>}</div>}</div>{detail&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><h3>{orderCode(detail.request_number)} — {detail.customer_name}</h3><div className="muted" style={{fontSize:12,marginTop:4}}>Enviado: {fmtDate(detail.submitted_at)}</div></div><button className="icon-btn" onClick={()=>setDetail(null)}><XCircle size={17}/></button></div><div className="modal-body"><div className="detail-list">{items.map(i=><div className="detail-item" key={i.id}><div><strong>{i.product_name}</strong><div className="muted" style={{fontSize:11}}>{[i.product_sku,i.unit,i.fulfillment_status].filter(Boolean).join(' • ')}</div></div><div style={{textAlign:'right'}}><strong>{Number(i.requested_quantity||0)} un.</strong><div className="muted" style={{fontSize:11}}>{i.price_status==='definido'&&i.subtotal!=null?money(i.subtotal):'Preço sob consulta'}</div></div></div>)}</div>{!items.length&&<div className="empty">O cliente ainda não enviou itens.</div>}{detail.customer_notes&&<div style={{marginTop:15,padding:13,background:'#f6f8f8',borderRadius:12}}><strong>Observação do cliente</strong><div className="muted" style={{marginTop:4}}>{detail.customer_notes}</div></div>}</div><div className="modal-foot"><button className="btn btn-white" onClick={()=>setDetail(null)}>Fechar</button>{detail.status==='enviado'&&<button className="btn btn-primary"><CheckCircle2 size={16}/>Recebido</button>}</div></div></div>}</>;
}
