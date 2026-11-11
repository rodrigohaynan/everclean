import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { BarChart3, DatabaseBackup, FileArchive, Link2, LogOut, Package, ShoppingCart, Upload, Users, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { getTestToken, logoutTest, testApi } from '../lib/testApi.js';
import { normalizeBlingBackup } from '../lib/blingBackup.js';

const nav=[
  {path:'/admin',label:'Painel',icon:BarChart3,end:true},
  {path:'/admin/clientes',label:'Clientes',icon:Users},
  {path:'/admin/produtos',label:'Produtos',icon:Package},
  {path:'/admin/pedidos',label:'Pedidos',icon:ShoppingCart},
  {path:'/admin/links-pedido',label:'Links',icon:Link2},
];
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));
function Brand(){return <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>AMBIENTE DE TESTES</small></div></div>}
function MobileNav(){return <nav className="mobile-bottom-nav" aria-label="Navegação principal">{nav.map(item=>{const Icon=item.icon;return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={20}/><span>{item.label}</span></NavLink>})}</nav>}

export default function AdminImportPage(){
  const navigate=useNavigate();
  const [session,setSession]=React.useState(null);
  const [fileName,setFileName]=React.useState('');
  const [normalized,setNormalized]=React.useState(null);
  const [reading,setReading]=React.useState(false);
  const [importing,setImporting]=React.useState(false);
  const [done,setDone]=React.useState(false);

  React.useEffect(()=>{let active=true;(async()=>{
    if(!getTestToken()){navigate('/login',{replace:true});return}
    const auth=await testApi('session');
    if(!active)return;
    if(!auth?.ok){logoutTest();navigate('/login',{replace:true});return}
    setSession(auth.user);
  })();return()=>{active=false}},[navigate]);

  function logout(){logoutTest();navigate('/login',{replace:true})}

  async function chooseFile(event){
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    if(!/\.zip$/i.test(file.name)){toast.error('Selecione o backup ZIP exportado pelo Bling.');return}
    setReading(true);setDone(false);setNormalized(null);setFileName(file.name);
    try{
      const result=await normalizeBlingBackup(file);
      setNormalized(result);
      toast.success('Backup analisado. Confira os dados antes de importar.');
    }catch(error){
      console.error(error);toast.error(error?.message||'Não foi possível ler o backup.');
    }finally{setReading(false)}
  }

  async function importAll(){
    if(!normalized||importing)return;
    setImporting(true);setDone(false);
    try{
      for(const [dataset,items] of [
        ['products',normalized.products],
        ['clients',normalized.clients],
        ['orders',normalized.orders],
        ['financial_summary',normalized.financial_summary],
      ]){
        const response=await testApi('import_dataset',{dataset,items});
        if(!response?.ok)throw new Error(response?.message||`Erro ao importar ${dataset}`);
      }
      setDone(true);toast.success('Backup importado com sucesso.');
    }catch(error){
      toast.error(error?.message||'Falha durante a importação.');
    }finally{setImporting(false)}
  }

  const summary=normalized?.financial_summary;
  return <div className="layout">
    <aside className="sidebar"><Brand/><nav className="nav">{nav.map(item=>{const Icon=item.icon;return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={18}/>{item.label}</NavLink>})}</nav><div className="sidebar-foot"><button className="btn" style={{width:'100%',background:'transparent',color:'#d8ebe8',justifyContent:'flex-start'}} onClick={logout}><LogOut size={17}/> Sair</button></div></aside>
    <main className="main"><header className="topbar"><Brand/><div className="topbar-actions"><span className="hide-mobile" style={{fontSize:12,color:'#6d7a80'}}>{session?.email}</span><button className="btn btn-white btn-sm" onClick={logout}><LogOut size={15}/> Sair</button></div></header>
      <div className="content">
        <section className="hero"><div><span className="eyebrow">DADOS • BACKUP BLING</span><h1>Importar operação real</h1><p>Leia o backup localmente e grave clientes, produtos e histórico diretamente no ambiente temporário.</p></div></section>

        <section className="panel" style={{marginTop:16}}>
          <div className="panel-head"><h2 style={{display:'flex',alignItems:'center',gap:8}}><FileArchive size={19}/>Selecionar backup</h2></div>
          <div style={{padding:18}}>
            <div style={{padding:14,borderRadius:14,background:'#fff6df',color:'#75531a',fontSize:13,marginBottom:16}}><AlertTriangle size={16} style={{verticalAlign:-3,marginRight:6}}/>Os dados não são enviados ao GitHub. O ZIP é processado no seu navegador e os registros normalizados seguem direto para o armazenamento temporário do Netlify.</div>
            <label className="btn btn-primary" style={{cursor:'pointer',width:'100%',justifyContent:'center',maxWidth:360}}><Upload size={17}/>{reading?'Analisando...':'Selecionar backup ZIP'}<input type="file" accept=".zip,application/zip" hidden onChange={chooseFile} disabled={reading||importing}/></label>
            {fileName&&<div className="muted" style={{fontSize:12,marginTop:10}}>{fileName}</div>}
          </div>
        </section>

        {normalized&&<><div className="grid-stats" style={{marginTop:16}}>
          <div className="stat"><small>Clientes com histórico</small><strong>{normalized.clients.length}</strong><span>Cadastros identificados</span></div>
          <div className="stat"><small>Produtos ativos</small><strong>{normalized.products.length}</strong><span>{summary?.products_catalog_visible||0} no catálogo inicial</span></div>
          <div className="stat"><small>Pedidos históricos</small><strong>{normalized.orders.length}</strong><span>Usados em recompra e sugestões</span></div>
          <div className="stat"><small>Faturamento 2026</small><strong>{money(summary?.sales_2026_total)}</strong><span>{summary?.sales_2026_orders||0} pedidos</span></div>
        </div>

        <section className="panel" style={{marginTop:16}}>
          <div className="panel-head"><h2>Resumo antes da importação</h2></div>
          <div style={{padding:18,display:'grid',gap:12}}>
            <div className="detail-list">
              <div className="detail-item"><span>Ticket médio 2026</span><strong>{money(summary?.sales_2026_average_ticket)}</strong></div>
              <div className="detail-item"><span>Contas a receber em aberto</span><strong>{money(summary?.receivables_open)}</strong></div>
              <div className="detail-item"><span>Contas a pagar em aberto</span><strong>{money(summary?.payables_open)}</strong></div>
              <div className="detail-item"><span>Linhas de venda lidas</span><strong>{normalized.rawCounts?.salesLines||0}</strong></div>
            </div>
            <button className="btn btn-primary" style={{width:'100%',justifyContent:'center',minHeight:48}} onClick={importAll} disabled={importing}>
              <DatabaseBackup size={18}/>{importing?'Importando dados...':'Importar e aplicar no sistema'}
            </button>
            {done&&<div style={{padding:14,borderRadius:14,background:'#ecf8f5',color:'#0b665c',fontWeight:800}}><CheckCircle2 size={17} style={{verticalAlign:-3,marginRight:7}}/>Importação concluída. O histórico já pode ser usado em clientes, pedidos, recompra e sugestões.</div>}
          </div>
        </section></>}
      </div>
    </main>
    <MobileNav/>
  </div>;
}
