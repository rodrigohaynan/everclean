import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { BarChart3, Box, ClipboardList, Copy, ExternalLink, Link2, LogOut, Package, Plus, RefreshCw, Save, Search, ShoppingCart, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getTestToken, logoutTest, testApi } from '../lib/testApi.js';

const nav = [
  { path: '/admin', label: 'Painel Geral', icon: BarChart3, end: true },
  { path: '/admin/clientes', label: 'Clientes', icon: Users },
  { path: '/admin/produtos', label: 'Produtos', icon: Package },
  { path: '/admin/pedidos', label: 'Pedidos', icon: ShoppingCart },
  { path: '/admin/links-pedido', label: 'Links de Pedido', icon: Link2 },
];
const fmtDate = (v) => v ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—';
const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const orderCode = (n) => `EC-${String(n || 0).padStart(6, '0')}`;

function Brand(){return <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>AMBIENTE DE TESTES</small></div></div>}
function Loading(){return <div className="loading"><div><div className="spinner"/>Carregando...</div></div>}
function Status({value}){const cls=['enviado','recebido','atendido'].includes(value)?'green':['cancelado','expirado'].includes(value)?'red':'orange';const labels={gerado:'Gerado',aberto:'Aberto',enviado:'Recebido',recebido:'Recebido',cancelado:'Cancelado',expirado:'Expirado',atendido:'Atendido'};return <span className={`badge ${cls}`}>{labels[value]||value||'—'}</span>}

export default function AdminPage({section='dashboard'}){
  const navigate=useNavigate();
  const [session,setSession]=React.useState(null);
  const [data,setData]=React.useState(null);
  const [loading,setLoading]=React.useState(true);

  const reload=React.useCallback(async()=>{
    const response=await testApi('bootstrap');
    if(!response?.ok){
      if(!getTestToken()){navigate('/login',{replace:true});return;}
      toast.error(response?.message||'Não foi possível carregar o ambiente de testes.');
      return;
    }
    setData({clients:response.clients||[],products:response.products||[],links:response.links||[],orders:response.orders||[]});
  },[navigate]);

  React.useEffect(()=>{
    let active=true;
    async function start(){
      if(!getTestToken()){navigate('/login',{replace:true});return;}
      const auth=await testApi('session');
      if(!active)return;
      if(!auth?.ok){logoutTest();navigate('/login',{replace:true});return;}
      setSession(auth.user);
      await reload();
      if(active)setLoading(false);
    }
    start();
    return()=>{active=false};
  },[navigate,reload]);

  function logout(){logoutTest();navigate('/login',{replace:true});}
  if(loading||!data)return <Loading/>;

  const props={data,reload};
  return <div className="layout">
    <aside className="sidebar"><Brand/><nav className="nav">{nav.map(item=>{const Icon=item.icon;return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={18}/>{item.label}</NavLink>})}</nav><div className="sidebar-foot"><button className="btn" style={{width:'100%',background:'transparent',color:'#d8ebe8',justifyContent:'flex-start'}} onClick={logout}><LogOut size={17}/> Sair</button></div></aside>
    <main className="main"><header className="topbar"><Brand/><div className="topbar-actions"><span className="hide-mobile" style={{fontSize:12,color:'#6d7a80'}}>{session?.email}</span><button className="btn btn-white btn-sm" onClick={logout}><LogOut size={15}/> Sair</button></div></header><div className="content">
      {section==='dashboard'&&<Dashboard {...props}/>} {section==='clients'&&<Clients {...props}/>} {section==='products'&&<Products {...props}/>} {section==='orders'&&<Orders {...props}/>} {section==='links'&&<Links {...props}/>} 
    </div></main>
  </div>;
}

function Hero({eyebrow,title,text,onRefresh,action}){return <section className="hero"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{action}<button className="btn btn-white" onClick={onRefresh}><RefreshCw size={16}/>Atualizar</button></div></section>}

function Dashboard({data,reload}){
  const total=data.orders.reduce((sum,o)=>sum+Number(o.total_amount||0),0);
  const received=data.links.filter(l=>l.status==='enviado').length;
  return <><Hero eyebrow="CENTRAL EVER CLEAN • TESTE" title="Painel Geral" text="Dados temporários hospedados no Netlify, sem dependência do Supabase." onRefresh={reload}/><div className="grid-stats"><div className="stat"><small>Clientes</small><strong>{data.clients.length}</strong></div><div className="stat"><small>Produtos ativos</small><strong>{data.products.filter(p=>p.active!==false).length}</strong></div><div className="stat"><small>Pedidos recebidos</small><strong>{received}</strong></div><div className="stat"><small>Valor conhecido</small><strong>{money(total)}</strong></div></div><div className="panel"><div className="panel-head"><h2>Fluxo em teste</h2></div><div style={{padding:20,lineHeight:1.8,color:'#53656c'}}>Cadastre cliente → gere link → abra o catálogo em outro aparelho → selecione produtos → envie → acompanhe em <strong>Links de Pedido</strong>. Os dados desta fase são temporários e poderão ser descartados na migração para o Supabase.</div></div></>;
}

function Clients({data,reload}){
  const [search,setSearch]=React.useState('');
  const [edit,setEdit]=React.useState(null);
  const [busy,setBusy]=React.useState('');
  const rows=data.clients.filter(c=>`${c.trade_name||''} ${c.document||''} ${c.city||''}`.toLowerCase().includes(search.toLowerCase()));
  async function save(){setBusy('save');const res=await testApi('save_client',{client:edit});setBusy('');if(!res?.ok){toast.error(res?.message||'Erro ao salvar cliente');return;}toast.success('Cliente salvo');setEdit(null);await reload();}
  async function generate(c){setBusy(c.id);const res=await testApi('create_link',{customer_id:c.id});setBusy('');if(!res?.ok){toast.error(res?.message||'Erro ao gerar link');return;}const url=`${window.location.origin}/pedido/${res.link.token}`;try{await navigator.clipboard.writeText(url)}catch{}toast.success(`${orderCode(res.link.request_number)} criado e copiado`);await reload();const phone=String(c.phone||'').replace(/\D/g,'');if(phone&&window.confirm('Link copiado. Abrir WhatsApp do cliente?')){const number=phone.startsWith('55')?phone:`55${phone}`;window.open(`https://wa.me/${number}?text=${encodeURIComponent(`Olá! Seu catálogo Ever Clean para reposição está disponível: ${url}`)}`,'_blank')}}
  return <><Hero eyebrow="CLIENTES • TESTE" title="Clientes" text="Cadastre clientes e gere links exclusivos de pedido." onRefresh={reload} action={<button className="btn btn-white" onClick={()=>setEdit({trade_name:'',document:'',phone:'',city:'Campo Grande/MS'})}><Plus size={16}/>Novo cliente</button>}/><div className="panel"><div className="panel-head"><div style={{position:'relative'}}><Search size={16} style={{position:'absolute',left:12,top:13,color:'#819096'}}/><input className="search" style={{paddingLeft:36}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente..."/></div></div><div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Documento</th><th>Telefone</th><th>Cidade</th><th style={{textAlign:'right'}}>Ações</th></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td><strong>{c.trade_name}</strong><div className="muted" style={{fontSize:11}}>Guilherme Amaral</div></td><td>{c.document||'—'}</td><td>{c.phone||'—'}</td><td>{c.city||'—'}</td><td><div className="actions"><button className="icon-btn" title="Editar" onClick={()=>setEdit({...c})}><Save size={15}/></button><button className="btn btn-primary btn-sm" disabled={busy===c.id} onClick={()=>generate(c)}><Link2 size={14}/>{busy===c.id?'Gerando...':'Gerar link'}</button></div></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">Nenhum cliente encontrado.</div>}</div></div>{edit&&<ClientModal value={edit} setValue={setEdit} onClose={()=>setEdit(null)} onSave={save} saving={busy==='save'}/>}</>;
}

function ClientModal({value,setValue,onClose,onSave,saving}){return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>{value.id?'Editar cliente':'Novo cliente'}</h3><button className="icon-btn" onClick={onClose}><XCircle size={17}/></button></div><div className="modal-body"><div className="field"><label>Nome / Razão social</label><input value={value.trade_name||''} onChange={e=>setValue({...value,trade_name:e.target.value})}/></div><div className="product-edit"><div className="field"><label>Documento</label><input value={value.document||''} onChange={e=>setValue({...value,document:e.target.value})}/></div><div className="field"><label>Telefone / WhatsApp</label><input value={value.phone||''} onChange={e=>setValue({...value,phone:e.target.value})}/></div></div><div className="field"><label>Cidade</label><input value={value.city||''} onChange={e=>setValue({...value,city:e.target.value})}/></div></div><div className="modal-foot"><button className="btn btn-white" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={onSave} disabled={saving}><Save size={16}/>{saving?'Salvando...':'Salvar'}</button></div></div></div>}

function Products({data,reload}){
  const [search,setSearch]=React.useState('');
  const [edit,setEdit]=React.useState(null);
  const [saving,setSaving]=React.useState(false);
  const rows=data.products.filter(p=>`${p.name||''} ${p.sku||''} ${p.brand||''}`.toLowerCase().includes(search.toLowerCase()));
  async function save(){setSaving(true);const res=await testApi('save_product',{product:edit});setSaving(false);if(!res?.ok){toast.error(res?.message||'Erro ao salvar produto');return;}toast.success('Produto salvo');setEdit(null);await reload();}
  const blank={name:'',sku:'',brand:'',category:'',unit:'',base_price:'',stock_quantity:0,active:true,catalog_visible:true,catalog_show_price:false,catalog_show_stock:true,catalog_allow_backorder:true};
  return <><Hero eyebrow="CATÁLOGO • TESTE" title="Produtos" text="Controle estoque, preço e visibilidade do catálogo." onRefresh={reload} action={<button className="btn btn-white" onClick={()=>setEdit(blank)}><Plus size={16}/>Novo produto</button>}/><div className="panel"><div className="panel-head"><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, marca ou SKU..."/></div><div className="table-wrap"><table className="table"><thead><tr><th>Produto</th><th>Preço</th><th>Estoque</th><th>Catálogo</th><th>Preço público</th><th style={{textAlign:'right'}}>Ação</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><strong>{p.name}</strong><div className="muted" style={{fontSize:11}}>{[p.sku,p.brand,p.unit].filter(Boolean).join(' • ')}</div></td><td>{p.base_price!=null?money(p.base_price):'—'}</td><td>{Number(p.stock_quantity||0)}</td><td><span className={`badge ${p.catalog_visible!==false?'green':'red'}`}>{p.catalog_visible!==false?'Visível':'Oculto'}</span></td><td><span className={`badge ${p.catalog_show_price?'green':'orange'}`}>{p.catalog_show_price?'Exibe':'Consulta'}</span></td><td><div className="actions"><button className="icon-btn" onClick={()=>setEdit({...p})}><Save size={15}/></button></div></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">Nenhum produto encontrado.</div>}</div></div>{edit&&<ProductModal value={edit} setValue={setEdit} onClose={()=>setEdit(null)} onSave={save} saving={saving}/>}</>;
}

function ProductModal({value,setValue,onClose,onSave,saving}){return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>{value.id?'Editar produto':'Novo produto'}</h3><button className="icon-btn" onClick={onClose}><XCircle size={17}/></button></div><div className="modal-body"><div className="field"><label>Produto</label><input value={value.name||''} onChange={e=>setValue({...value,name:e.target.value})}/></div><div className="product-edit"><div className="field"><label>SKU</label><input value={value.sku||''} onChange={e=>setValue({...value,sku:e.target.value})}/></div><div className="field"><label>Categoria</label><input value={value.category||''} onChange={e=>setValue({...value,category:e.target.value})}/></div></div><div className="product-edit"><div className="field"><label>Unidade</label><input value={value.unit||''} onChange={e=>setValue({...value,unit:e.target.value})}/></div><div className="field"><label>Marca</label><input value={value.brand||''} onChange={e=>setValue({...value,brand:e.target.value})}/></div></div><div className="product-edit"><div className="field"><label>Preço de referência</label><input type="number" step="0.01" value={value.base_price??''} onChange={e=>setValue({...value,base_price:e.target.value})}/></div><div className="field"><label>Estoque</label><input type="number" value={value.stock_quantity??0} onChange={e=>setValue({...value,stock_quantity:e.target.value})}/></div></div><div style={{display:'grid',gap:11,marginTop:10}}><label className="switch"><input type="checkbox" checked={value.active!==false} onChange={e=>setValue({...value,active:e.target.checked})}/> Produto ativo</label><label className="switch"><input type="checkbox" checked={value.catalog_visible!==false} onChange={e=>setValue({...value,catalog_visible:e.target.checked})}/> Exibir no catálogo</label><label className="switch"><input type="checkbox" checked={Boolean(value.catalog_show_price)} onChange={e=>setValue({...value,catalog_show_price:e.target.checked})}/> Exibir preço</label><label className="switch"><input type="checkbox" checked={value.catalog_show_stock!==false} onChange={e=>setValue({...value,catalog_show_stock:e.target.checked})}/> Exibir estoque</label><label className="switch"><input type="checkbox" checked={value.catalog_allow_backorder!==false} onChange={e=>setValue({...value,catalog_allow_backorder:e.target.checked})}/> Permitir sob encomenda</label></div></div><div className="modal-foot"><button className="btn btn-white" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={onSave} disabled={saving}><Save size={16}/>{saving?'Salvando...':'Salvar'}</button></div></div></div>}

function Orders({data,reload}){
  const [search,setSearch]=React.useState('');
  const rows=data.orders.filter(o=>`${o.order_number||''} ${o.customer_name||''}`.toLowerCase().includes(search.toLowerCase()));
  return <><Hero eyebrow="CENTRAL DE PEDIDOS • TESTE" title="Pedidos" text="Pedidos enviados pelo catálogo experimental." onRefresh={reload}/><div className="panel"><div className="panel-head"><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pedido ou cliente..."/></div><div className="table-wrap"><table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Itens</th><th>Valor conhecido</th><th>Status</th></tr></thead><tbody>{rows.map(o=><tr key={o.id}><td><strong>{o.order_number||orderCode(o.request_number)}</strong></td><td>{o.customer_name}</td><td>{fmtDate(o.created_at)}</td><td>{o.items?.length||0}</td><td>{money(o.total_amount)}</td><td><Status value={o.status}/></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">Nenhum pedido recebido ainda.</div>}</div></div></>;
}

function Links({data,reload}){
  const [search,setSearch]=React.useState('');
  const rows=data.links.filter(l=>`${l.customer_name||''} ${orderCode(l.request_number)}`.toLowerCase().includes(search.toLowerCase()));
  function url(l){return `${window.location.origin}/pedido/${l.token}`}
  async function copy(l){try{await navigator.clipboard.writeText(url(l));toast.success('Link copiado')}catch{toast.error('Não foi possível copiar')}}
  async function cancel(l){if(!window.confirm('Cancelar este link?'))return;const res=await testApi('cancel_link',{id:l.id});if(!res?.ok){toast.error(res?.message||'Erro ao cancelar');return;}toast.success('Link cancelado');await reload()}
  return <><Hero eyebrow="LINKS DE PEDIDO • TESTE" title="Links de Pedido" text="Acompanhe geração, abertura e envio dos catálogos exclusivos." onRefresh={reload}/><div className="panel"><div className="panel-head"><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente ou número..."/></div><div className="table-wrap"><table className="table"><thead><tr><th>Solicitação</th><th>Cliente</th><th>Criado</th><th>Aberto</th><th>Enviado</th><th>Status</th><th style={{textAlign:'right'}}>Ações</th></tr></thead><tbody>{rows.map(l=><tr key={l.id}><td><strong>{orderCode(l.request_number)}</strong></td><td>{l.customer_name}</td><td>{fmtDate(l.created_at)}</td><td>{fmtDate(l.first_opened_at)}</td><td>{fmtDate(l.submitted_at)}</td><td><Status value={l.status}/></td><td><div className="actions"><button className="icon-btn" title="Copiar" onClick={()=>copy(l)}><Copy size={15}/></button><button className="icon-btn" title="Abrir" onClick={()=>window.open(url(l),'_blank')}><ExternalLink size={15}/></button>{!['enviado','cancelado','expirado'].includes(l.status)&&<button className="icon-btn" title="Cancelar" onClick={()=>cancel(l)}><XCircle size={15}/></button>}</div></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">Nenhum link gerado.</div>}</div></div></>;
}
