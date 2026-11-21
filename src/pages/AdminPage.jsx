import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { BarChart3, Box, ClipboardList, Copy, DatabaseBackup, ExternalLink, Link2, LogOut, Package, Plus, RefreshCw, Save, Search, ShoppingCart, Users, XCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getTestToken, logoutTest, testApi } from '../lib/testApi.js';

const nav = [
  { path: '/admin', label: 'Painel', icon: BarChart3, end: true },
  { path: '/admin/clientes', label: 'Clientes', icon: Users },
  { path: '/admin/produtos', label: 'Produtos', icon: Package },
  { path: '/admin/pedidos', label: 'Pedidos', icon: ShoppingCart },
  { path: '/admin/links-pedido', label: 'Links', icon: Link2 },
];
const fmtDate = (v) => v ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—';
const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const orderCode = (n) => `EC-${String(n || 0).padStart(6, '0')}`;

function Brand(){return <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>AMBIENTE DE TESTES</small></div></div>}
function Loading(){return <div className="loading"><div><div className="spinner"/>Carregando...</div></div>}
function Status({value}){const cls=['enviado','recebido','atendido'].includes(value)?'green':['cancelado','expirado'].includes(value)?'red':'orange';const labels={gerado:'Gerado',aberto:'Aberto',enviado:'Recebido',recebido:'Recebido',cancelado:'Cancelado',expirado:'Expirado',atendido:'Atendido'};return <span className={`badge ${cls}`}>{labels[value]||value||'—'}</span>}

function MobileNav(){
  return <nav className="mobile-bottom-nav" aria-label="Navegação principal">
    {nav.map(item=>{const Icon=item.icon;return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={20}/><span>{item.label}</span></NavLink>})}
  </nav>;
}

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
    setData({clients:response.clients||[],products:response.products||[],links:response.links||[],orders:response.orders||[],financial_summary:response.financial_summary||null,import_meta:response.import_meta||null});
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

  const props={data,reload,navigate};
  return <div className="layout">
    <aside className="sidebar"><Brand/><nav className="nav">{nav.map(item=>{const Icon=item.icon;return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={18}/>{item.label}</NavLink>})}</nav><div className="sidebar-foot"><button className="btn" style={{width:'100%',background:'transparent',color:'#d8ebe8',justifyContent:'flex-start'}} onClick={logout}><LogOut size={17}/> Sair</button></div></aside>
    <main className="main"><header className="topbar"><Brand/><div className="topbar-actions"><span className="hide-mobile" style={{fontSize:12,color:'#6d7a80'}}>{session?.email}</span><button className="btn btn-white btn-sm" onClick={logout}><LogOut size={15}/> Sair</button></div></header><div className="content">
      {section==='dashboard'&&<Dashboard {...props}/>} {section==='asaas'&&<AsaasDiagnostics navigate={navigate}/>} {section==='bling'&&<BlingPreparation {...props}/>} {section==='clients'&&<Clients {...props}/>} {section==='products'&&<Products {...props}/>} {section==='orders'&&<Orders {...props}/>} {section==='links'&&<Links {...props}/>} 
    </div></main>
    <MobileNav/>
  </div>;
}

function Hero({eyebrow,title,text,onRefresh,action}){return <section className="hero"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{action}<button className="btn btn-white" onClick={onRefresh}><RefreshCw size={16}/>Atualizar</button></div></section>}


function AsaasDiagnostics({navigate}) {
  const [checking,setChecking]=React.useState(false);
  const [result,setResult]=React.useState(null);
  const [error,setError]=React.useState('');
  const inspect=React.useCallback(async()=>{
    setChecking(true);setError('');
    try {
      const response=await testApi('diagnose_pix');
      if(!response?.ok)throw new Error(response?.message||'Não foi possível consultar as chaves.');
      setResult(response);
    }catch(e){setError(e?.message||'Erro ao consultar o Asaas.')}
    finally{setChecking(false)}
  },[]);
  React.useEffect(()=>{inspect()},[inspect]);
  const total=result?.total??0;
  const active=result?.active??0;
  const statuses=result?.statuses||{};
  return <>
    <section className="hero" style={{marginBottom:16}}>
      <div>
        <span className="eyebrow">ASAAS SANDBOX • DIAGNÓSTICO</span>
        <h1>Chaves PIX</h1>
        <p>Consulta segura à mesma conta Asaas utilizada pelo checkout. Nenhuma chave secreta é exibida.</p>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button className="btn btn-white" onClick={inspect} disabled={checking}><RefreshCw size={16}/>{checking?'Consultando...':'Consultar API Asaas'}</button>
        <button className="btn btn-white" onClick={()=>navigate('/admin')}>Voltar</button>
      </div>
    </section>
    {error&&<div className="form-error">{error}</div>}
    {result&&<section className="panel" style={{padding:18}}>
      <div className="grid-stats" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))',marginTop:0}}>
        <div className="stat"><small>Chaves encontradas via API</small><strong>{total}</strong></div>
        <div className="stat"><small>Chaves ativas</small><strong>{active}</strong></div>
      </div>
      <h2 style={{fontSize:16,marginBottom:9}}>Webhook de pagamentos (automação)</h2>
      {result.webhookDiagnostics?.ok ? <>
        <div className="detail-list" style={{marginBottom:12}}>
          <div className="detail-item"><span>Configurações encontradas no Asaas</span><strong>{result.webhookDiagnostics.total}</strong></div>
          <div className="detail-item"><span>Webhooks apontando para a Ever Clean</span><strong>{result.webhookDiagnostics.matching}</strong></div>
        </div>
        {result.webhookDiagnostics.configurations.map((hook,i)=><div key={i} style={{border:'1px solid #e2e8f0',borderRadius:12,padding:12,marginBottom:10}}>
          <strong style={{display:'block',marginBottom:8}}>{hook.destination}</strong>
          <div className="detail-list">
            <div className="detail-item"><span>Ativo</span><strong>{hook.enabled?'SIM':'NÃO'}</strong></div>
            <div className="detail-item"><span>Fila interrompida</span><strong>{hook.interrupted?'SIM':'NÃO'}</strong></div>
            <div className="detail-item"><span>Recebe CHECKOUT_PAID (cartão)</span><strong>{hook.receivesCheckoutPaid?'SIM':'NÃO'}</strong></div>
            <div className="detail-item"><span>Recebe PAYMENT_CONFIRMED/RECEIVED</span><strong>{hook.receivesPaymentConfirmed?'SIM':'NÃO'}</strong></div>
          </div>
        </div>)}
        {!result.webhookDiagnostics.matching&&<p className="form-error">Não foi encontrado um Webhook apontando para a função asaas-webhook da Ever Clean. Configure a URL correta no Asaas Sandbox.</p>}
        {!!result.webhookDiagnostics.matching&&!result.webhookDiagnostics.configurations.some(hook=>hook.enabled&&!hook.interrupted&&hook.receivesCheckoutPaid)&&<p className="form-error">O Webhook encontrado não está habilitado para CHECKOUT_PAID ou está interrompido. Atualize os eventos na conta Asaas Sandbox.</p>}
      </>:<p className="muted">A consulta da configuração dos Webhooks não está disponível. Confira os eventos diretamente no painel Asaas.</p>}
      <h2 style={{fontSize:16,marginBottom:9}}>Eventos recebidos no servidor</h2>
      {Array.isArray(result.webhookRecent)&&result.webhookRecent.length>0?
        <div className="detail-list" style={{marginBottom:16}}>
          {result.webhookRecent.slice(0,8).map((event,i)=><div className="detail-item" key={i} style={{alignItems:'flex-start',gap:9}}>
            <div style={{minWidth:0}}>
              <strong style={{fontSize:13,overflowWrap:'anywhere'}}>{event.event}</strong>
              <div className="muted" style={{fontSize:12}}>{event.order_number||'Sem vínculo com pedido'} · {new Date(event.processed_at).toLocaleString('pt-BR')}</div>
            </div>
            <strong style={{fontSize:12,whiteSpace:'nowrap',color:event.updated?'#087047':'#b45309'}}>{event.updated?'Pedido atualizado':event.matched?'Sem alteração':'Não vinculado'}</strong>
          </div>)}
        </div>:
        <p className="muted" style={{marginBottom:15}}>Nenhum evento registrado pelo novo diagnóstico. Execute um pagamento de teste e consulte novamente.</p>}
      <h2 style={{fontSize:16,marginBottom:9}}>Comparação de cobranças PIX</h2>
      {result.pixPayments?<div className="detail-list" style={{marginBottom:14}}>
        <div className="detail-item"><span>Cobranças PIX de outras origens (últimas 50)</span><strong>{result.pixPayments.fromOtherSources}</strong></div>
        <div className="detail-item"><span>Pagas fora da Ever Clean</span><strong>{result.pixPayments.paidFromOtherSources}</strong></div>
        <div className="detail-item"><span>Criadas pela Ever Clean</span><strong>{result.pixPayments.fromEverClean}</strong></div>
        <div className="detail-item"><span>Pagas pela Ever Clean</span><strong>{result.pixPayments.paidFromEverClean}</strong></div>
      </div>:<p className="muted">A listagem das cobranças PIX não está disponível nesta consulta.</p>}
      {result.accountApproval&&<div style={{marginBottom:16,padding:12,background:'#f8fafc',borderRadius:10}}>
        <strong style={{display:'block',marginBottom:6}}>Aprovação da conta usada pela API</strong>
        <div className="muted" style={{fontSize:13,lineHeight:1.6}}>
          Geral: {result.accountApproval.general} · Dados comerciais: {result.accountApproval.commercialInfo} · Documentação: {result.accountApproval.documentation}
        </div>
      </div>}
      {result.pixPayments?.paidFromOtherSources>0&&<p style={{color:'#0b4f48',fontWeight:750,lineHeight:1.5}}>
        A mesma API identifica pagamentos PIX de outras origens. Portanto, a conexão está alcançando uma conta que efetivamente recebeu PIX; é necessário investigar a cobrança específica da Ever Clean.
      </p>}
      {result.pixPayments?.hasMore&&<p className="muted" style={{fontSize:12}}>A comparação utiliza apenas as 50 cobranças PIX mais recentes.</p>}
      {result.paymentsError&&<p className="muted">{result.paymentsError}</p>}
      <h2 style={{fontSize:16,marginBottom:9}}>Situação da conexão</h2>
      <p style={{color:'#475569',lineHeight:1.6}}>
        {total===0?'A API não encontrou chaves PIX nessa conta. Confira se a chave ASAAS_API_KEY no Netlify pertence à mesma conta Sandbox das capturas.':
         active===0?'A API encontrou chaves, mas nenhuma está ACTIVE. Aguarde a ativação ou solicite orientação ao suporte Asaas.':
         'A API encontrou pelo menos uma chave ACTIVE. Se a criação de QR Code continuar falhando, confirme a conta vinculada à cobrança e encaminhe o erro ao suporte Asaas.'}
      </p>
      <div className="detail-list" style={{marginTop:14}}>
        {Object.entries(statuses).map(([state,count])=><div className="detail-item" key={state}><span>{state}</span><strong>{count}</strong></div>)}
      </div>
      <p className="muted" style={{fontSize:12,marginTop:14}}>Contagem e estados obtidos via API; valores e identificadores das chaves não são retornados. Consulta: {new Date(result.checkedAt).toLocaleString('pt-BR')}.</p>
      {result.isLastPage===false&&<p className="muted">Existem mais chaves além das apresentadas nesta consulta.</p>}
    </section>}
    <AsaasProductionReadiness/>
  </>;
}

function ProductionCheckoutReadiness(){
  const [report,setReport]=React.useState(null);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  async function audit(action='audit'){
    setBusy(true);setError('');
    try{
      async function call(kind){
        const response=await fetch('/.netlify/functions/asaas-checkout-readiness',{
          method:'POST',
          headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
          body:JSON.stringify({action:kind})
        });
        const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
        if(!response.ok||!data?.ok)throw Error(data.message||'Falha na auditoria.');
        return data;
      }
      if(action==='self_test'){
        await call('self_test');
        toast.success('Trava e webhook simulados sem gerar cobranças.');
      }
      if(action==='database_self_test'){
        await call('database_self_test');
        toast.success('Banco transacional testado com ROLLBACK, sem criar pedidos.');
      }
      if(action==='operational_self_test'){
        await call('operational_self_test');
        toast.success('Fluxo operacional validado sem criar cobranças ou pedidos reais.');
      }
      setReport(await call('audit'));
      if(action==='audit')toast.success('Prévia do checkout concluída. Nenhuma cobrança criada.');
    }catch(err){setError(err?.message||'Falha na auditoria.');}
    finally{setBusy(false);}
  }
  return <section style={{marginTop:24,paddingTop:18,borderTop:'1px solid #e0e9e5'}}>
    <h2 style={{fontSize:18}}>7. Preparar checkout público de produção</h2>
    <p style={{fontSize:13,lineHeight:1.6,marginTop:8}}>A rota atual de pedidos continua no Sandbox. A rota de produção foi separada e permanece bloqueada para compras reais. Esta etapa verifica os requisitos, sem criar PIX, pedidos, contas ou NF-e.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:9,marginTop:12}}>
      <button className="btn btn-primary" disabled={busy} onClick={()=>audit('audit')}>
        <ShieldCheck size={16}/>{busy?'Verificando...':'Auditar checkout de produção'}
      </button>
      <button className="btn btn-white" disabled={busy} onClick={()=>audit('self_test')}>
        <RefreshCw size={16}/>Testar proteção e conciliação
      </button>
      <button className="btn btn-white" disabled={busy} onClick={()=>audit('database_self_test')}>
        <ShieldCheck size={16}/>Testar banco transacional
      </button>
      <button className="btn btn-white" disabled={busy} onClick={()=>audit('operational_self_test')}>
        <ShieldCheck size={16}/>Simular finalização de pedido
      </button>
    </div>
    {error&&<div className="form-error" style={{marginTop:10}}>{error}</div>}
    {report&&<div style={{marginTop:14}}>
      <div style={{borderRadius:12,padding:12,background:'#fff7e9',border:'1px solid #ebd6b4',color:'#88521d',fontSize:12}}>
        <strong>Pagamentos reais pelo catálogo: desativados.</strong> Nenhum pedido ou PIX foi criado nesta auditoria. Emissão automática e baixa de estoque continuam desligadas.
      </div>
      <div className="detail-list" style={{marginTop:12}}>
        <div className="detail-item"><span>Checkout Sandbox</span><strong>Preservado</strong></div>
        <div className="detail-item"><span>Checkout Produção</span><strong>Rota separada, bloqueada</strong></div>
        <div className="detail-item"><span>Banco PostgreSQL Ever Clean</span>
          <strong>{report.database_status?.configured?'Conexão configurada':'Não configurado'}</strong>
        </div>
      </div>
      {!report.database_status?.configured&&<p className="muted" style={{fontSize:12,marginTop:10}}>
        Para a próxima etapa, será necessário um banco PostgreSQL exclusivo da Ever Clean.
        Configure a variável secreta <code>EVERCLEAN_DATABASE_URL</code> no Netlify (escopo Functions)
        e aplique a migração SQL preparada no repositório. Não envie credenciais pelo chat.
      </p>}
      <div style={{display:'grid',gap:9,marginTop:12}}>
        {(report.checks||[]).map(row=><div key={row.key} style={{padding:11,border:'1px solid #e0e9e5',borderRadius:10}}>
          <div style={{display:'flex',alignItems:'start',justifyContent:'space-between',gap:9}}>
            <strong style={{fontSize:12}}>{row.label}</strong>
            <strong style={{fontSize:12,color:row.ok?'#17654e':'#9c5527'}}>{row.ok?'OK':'Pendente'}</strong>
          </div>
          <p className="muted" style={{fontSize:11,marginTop:6,lineHeight:1.5}}>{row.details}</p>
        </div>)}
      </div>
      {report.operational_preflight?.passed&&
        <p style={{fontSize:12,marginTop:13,color:'#17654e'}}>
          Simulação operacional aprovada: pedido no Neon, webhook e trava de cobrança testados sem emissão real.
          A homologação do checkout público permanece pendente.
        </p>}
      <p className="muted" style={{fontSize:12,marginTop:12}}>
        Os testes são simulações sem cobrança. Antes de liberar vendas ao público, será necessária a homologação controlada
        do primeiro pedido real e a autorização expressa para ativar o checkout. Não gere outro PIX piloto agora.
      </p>
    </div>}
  </section>;
}

function ControlledPilotPreparation(){
  const [pilot,setPilot]=React.useState(null);
  const [clients,setClients]=React.useState([]);
  const [selected,setSelected]=React.useState('');
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  async function request(action,clientId){
    const response=await fetch('/.netlify/functions/asaas-controlled-pilot',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action,client_id:clientId})
    });
    const body=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
    if(!response.ok||!body?.ok)throw Error(body.message||'Falha na preparação.');
    return body;
  }
  const load=React.useCallback(async()=>{
    setBusy(true);setError('');
    try{
      const data=await request('status');
      setPilot(data.pilot||null);setClients(data.clients||[]);
    }catch(err){setError(err.message||'Não foi possível consultar homologação.');}
    finally{setBusy(false);}
  },[]);
  React.useEffect(()=>{load();},[load]);
  async function prepare(){
    if(!selected)return;
    if(!window.confirm('Preparar apenas UM link exclusivo de R$ 7,00 para este cliente? Nenhuma cobrança será criada.'))return;
    setBusy(true);setError('');
    try{
      const data=await request('prepare',selected);
      setPilot(data.pilot||null);toast.success('Link de homologação preparado sem cobrança.');
    }catch(err){setError(err.message||'Não foi possível preparar o link.');}
    finally{setBusy(false);}
  }
  async function copyLink(){
    if(!pilot?.link)return;
    try{await navigator.clipboard.writeText(pilot.link);toast.success('Link copiado. Não compartilhe ainda com clientes.')}
    catch{toast.error('Não foi possível copiar o link.');}
  }
  return <section style={{marginTop:24,paddingTop:18,borderTop:'1px solid #e0e9e5'}}>
    <h2 style={{fontSize:18}}>8. Homologação controlada — somente preparação</h2>
    <p style={{fontSize:13,lineHeight:1.6,marginTop:9}}>
      Um único pedido piloto, Álcool 70% 1L (SKU 100388), quantidade 1,
      limite de R$ 7,00. O link será exclusivo, com validade de 7 dias.
      <strong> Nenhuma cobrança será criada e o PIX real continuará bloqueado.</strong>
    </p>
    {error&&<div className="form-error" style={{marginTop:10}}>{error}</div>}
    {pilot?<div style={{padding:13,border:'1px solid #c9e6d6',borderRadius:12,marginTop:12}}>
      <strong style={{color:'#17654e'}}>Link exclusivo preparado</strong>
      <div className="detail-list" style={{marginTop:9}}>
        <div className="detail-item"><span>Cliente do teste</span><strong>{pilot.client_name}</strong></div>
        <div className="detail-item"><span>Solicitação</span><strong>{pilot.request_number}</strong></div>
        <div className="detail-item"><span>Produto / valor máximo</span><strong>{pilot.sku} / R$ 7,00</strong></div>
        <div className="detail-item"><span>Pagamentos reais</span><strong>Bloqueados</strong></div>
      </div>
      <p className="muted" style={{fontSize:11,marginTop:10,overflowWrap:'anywhere'}}>{pilot.link}</p>
      <button className="btn btn-white" style={{marginTop:12}} type="button" onClick={copyLink}>
        <Copy size={15}/> Copiar link de homologação
      </button>
      <p className="muted" style={{fontSize:12,marginTop:10}}>
        Não envie o link a clientes antes da autorização específica para iniciar o primeiro pagamento real.
      </p>
    </div>:<div style={{marginTop:12,display:'grid',gap:10}}>
      <label className="field">
        <span>Escolher cliente cadastrado para o teste</span>
        <select value={selected} onChange={event=>setSelected(event.target.value)}
          disabled={busy} style={{padding:10,borderRadius:9,border:'1px solid #d6e4df',width:'100%'}}>
          <option value="">Selecione um cliente</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <button className="btn btn-primary" type="button"
        disabled={!selected||busy} onClick={prepare}>
        <ShieldCheck size={16}/>{busy?'Preparando...':'Preparar link exclusivo sem cobrança'}
      </button>
      {!clients.length&&!busy&&<p className="muted" style={{fontSize:12}}>
        É necessário cadastrar um cliente com CPF/CNPJ para gerar o link do piloto.
      </p>}
    </div>}
  </section>;
}

function AsaasProductionReadiness(){
  const [result,setResult]=React.useState(null);
  const [error,setError]=React.useState('');
  const [busy,setBusy]=React.useState('');
  const [generated,setGenerated]=React.useState('');
  const url='https://evercleancatalogo.netlify.app/.netlify/functions/asaas-webhook-production';
  const load=React.useCallback(async(action)=>{
    setBusy(action);setError('');
    try{
      const response=await fetch('/.netlify/functions/asaas-production-status',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action})
      });
      const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida do servidor.'}));
      if(!data?.ok){
        setResult(data);
        setError(data?.message||'Verificação indisponível.');
        return;
      }
      setResult(previous=>({...previous,...data}));
      if(action==='verify')toast.success('Produção Asaas verificada, sem criar cobrança.');
      if(action==='self_test')toast.success('Teste técnico do webhook concluído, sem cobrança.');
    }catch{setError('Falha na consulta de produção.');}
    finally{setBusy('');}
  },[]);
  React.useEffect(()=>{load('status');},[load]);
  async function copy(value){
    try{await navigator.clipboard.writeText(value);toast.success('Copiado. Guarde em local seguro.');}
    catch{toast.error('Selecione e copie o texto manualmente.');}
  }
  function makeToken(){
    const bytes=new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const value=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
    setGenerated(value);
  }
  return <section className="panel" style={{padding:18,marginTop:16}}>
    <h2 style={{fontSize:19}}>Asaas Produção — preparar sem gerar cobranças</h2>
    <p>O ambiente de testes continuará funcionando com <strong>ASAAS_API_KEY</strong> e <strong>ASAAS_BASE_URL</strong> atuais. A produção usa uma chave separada.</p>
    <div style={{marginTop:12,padding:12,borderRadius:12,background:'#fff7e7',color:'#81561b',fontSize:13}}>
      <strong>Operação real bloqueada.</strong> Esta etapa somente consulta o Asaas de produção e monitora eventos. Não cria PIX, boleto, cartão, pedido no Bling ou NF-e.
    </div>
    <h3 style={{fontSize:15,marginTop:18}}>1. Variáveis no Netlify</h3>
    <div className="detail-list" style={{marginTop:10}}>
      <div className="detail-item"><span><code>ASAAS_PROD_API_KEY</code> (secreta)</span><strong>{result?.production_key_configured?'Configurada':'Pendente'}</strong></div>
      <div className="detail-item"><span><code>ASAAS_PROD_WEBHOOK_TOKEN</code> (secreta)</span><strong>{result?.production_webhook_token_configured?'Configurado':'Pendente'}</strong></div>
      <div className="detail-item"><span>Sandbox separado</span><strong>{result?.sandbox_isolated?'Sim':'Verificar configuração'}</strong></div>
    </div>
    <p style={{fontSize:13,marginTop:12}}>No Netlify: <strong>Project configuration → Environment variables → Add a variable</strong>. Utilize o escopo Functions. Não coloque suas chaves aqui no chat.</p>
    <h3 style={{fontSize:15,marginTop:18}}>2. Webhook exclusivo da produção</h3>
    <p style={{fontSize:12}}>Configure o endereço abaixo no Asaas de produção, usando o mesmo token cadastrado em <code>ASAAS_PROD_WEBHOOK_TOKEN</code>.</p>
    <div style={{padding:12,background:'#f3f8f6',border:'1px solid #dce8e3',borderRadius:10,overflowWrap:'anywhere',fontSize:12}}>{url}</div>
    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
      <button className="btn btn-white btn-sm" onClick={()=>copy(url)}><Copy size={15}/>Copiar URL</button>
      <button className="btn btn-white btn-sm" onClick={makeToken}>Gerar token seguro</button>
    </div>
    {generated&&<div style={{marginTop:10,padding:12,border:'1px solid #dce8e3',borderRadius:10}}>
      <p style={{fontSize:12,margin:0}}>Copie o token e use <strong>exatamente o mesmo valor</strong> no Netlify e no campo Auth Token do Webhook do Asaas de produção. Ele não será salvo neste navegador.</p>
      <div style={{overflowWrap:'anywhere',marginTop:7,fontSize:11,fontFamily:'monospace'}}>{generated}</div>
      <button className="btn btn-white btn-sm" style={{marginTop:8}} onClick={()=>copy(generated)}><Copy size={15}/>Copiar token gerado</button>
    </div>}
    <h3 style={{fontSize:15,marginTop:18}}>3. Validar acesso de produção</h3>
    {!result?.production_key_configured&&<p className="muted" style={{fontSize:12,marginTop:8}}>Se a chave já foi cadastrada, salve e publique novamente o site no Netlify para que a função reconheça a variável. O botão abaixo pode ser usado mesmo antes da confirmação.</p>}
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
      <button className="btn btn-primary" disabled={!!busy} onClick={()=>load('verify')}>
        <RefreshCw size={16}/>{busy==='verify'?'Verificando...':'Verificar conta de produção'}
      </button>
      <button className="btn btn-white" disabled={!!busy} onClick={()=>load('status')}>Atualizar configuração</button>
    </div>
    {error&&<div className="form-error" style={{marginTop:12}}>{error}</div>}
    {result?.production_api_connected&&<div style={{marginTop:14}}>
      <p style={{color:'#17654e',fontWeight:750}}>API de produção autenticada, sem criar cobranças.</p>
      <div className="detail-list">
        <div className="detail-item"><span>Situação cadastral</span><strong>{result.approval?.general||'Não informada'}</strong></div>
        <div className="detail-item"><span>Webhook no Asaas</span><strong>{result.webhooks?.found||0} encontrado(s)</strong></div>
        <div className="detail-item"><span>Webhook ativo com eventos de pagamento</span><strong>{result.webhooks?.ready?'Sim':'Não confirmado'}</strong></div>
      </div>
      <p className="muted" style={{fontSize:12,marginTop:10}}>{result.webhooks?.message}</p>
    </div>}
    <h3 style={{fontSize:15,marginTop:18}}>4. Testar recebimento seguro do webhook</h3>
    <p style={{fontSize:13,marginTop:8}}>Teste técnico da URL e do token, sem gerar cobrança. Verifica também rejeição de acesso incorreto e proteção contra eventos duplicados.</p>
    <button className="btn btn-primary" style={{marginTop:10}} disabled={!!busy||!result?.production_webhook_token_configured} onClick={()=>load('self_test')}>
      <RefreshCw size={16}/>{busy==='self_test'?'Testando webhook...':'Testar recebimento do webhook'}
    </button>
    {!result?.production_webhook_token_configured&&<p className="muted" style={{fontSize:12,marginTop:8}}>Cadastre e publique a variável ASAAS_PROD_WEBHOOK_TOKEN no Netlify para habilitar o teste.</p>}
    {result?.technical_test?.transport_ok&&<div style={{marginTop:12,padding:12,borderRadius:12,background:'#f4f9f6',border:'1px solid #dce8e3'}}>
      <strong style={{color:'#11664d'}}>Teste técnico concluído</strong>
      <div className="detail-list" style={{marginTop:8}}>
        <div className="detail-item"><span>Recebimento na URL</span><strong>Confirmado</strong></div>
        <div className="detail-item"><span>Token incorreto bloqueado</span><strong>{result.technical_test.invalid_token_rejected?'Sim':'Não confirmado'}</strong></div>
        <div className="detail-item"><span>Proteção contra duplicidade</span><strong>{result.technical_test.duplicate_protection?'Sim':'Não confirmado'}</strong></div>
        <div className="detail-item"><span>Verificado em</span><strong>{fmtDate(result.technical_test.verified_at)}</strong></div>
      </div>
    </div>}
    <h3 style={{fontSize:15,marginTop:18}}>5. Eventos enviados pelo próprio Asaas</h3>
    {(result?.recent_events||[]).filter(event=>event.mode!=='teste_tecnico').length>0?
      <div style={{marginTop:10}}>
        {(result.recent_events||[]).filter(event=>event.mode!=='teste_tecnico').map((event,i)=>
          <div className="detail-item" key={i} style={{fontSize:12}}><span>{event.event}</span><strong>{fmtDate(event.received_at)}</strong></div>
        )}
      </div>:
      <p className="muted" style={{marginTop:9,fontSize:13}}>Ainda não recebemos um evento real identificado nesta integração. O teste técnico não substitui a confirmação de uma entrega feita pelo Asaas.</p>
    }
    <p className="muted" style={{fontSize:12,marginTop:14}}>Para confirmar um evento real, consulte no Asaas: Menu do Usuário → Integrações → Logs de Webhooks. Confirme resposta HTTP 200. Nenhum evento modifica pedidos até que a operação real seja homologada.</p>
    <AsaasProductionPilot/>
    <ProductionCheckoutReadiness/>
    <ControlledPilotPreparation/>
  </section>;
}

function AsaasProductionPilot(){
  const [options,setOptions]=React.useState(null);
  const [customerId,setCustomerId]=React.useState('');
  const [productId,setProductId]=React.useState('');
  const [quantity,setQuantity]=React.useState(1);
  const [preview,setPreview]=React.useState(null);
  const [error,setError]=React.useState('');
  const [busy,setBusy]=React.useState('');
  const [filter,setFilter]=React.useState('');
  const [pilot,setPilot]=React.useState(null);
  const [confirmation,setConfirmation]=React.useState('');
  const [accepted,setAccepted]=React.useState(false);
  const load=React.useCallback(async(action,payload={})=>{
    const response=await fetch('/.netlify/functions/asaas-production-pilot',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action,...payload})
    });
    const body=await response.json().catch(()=>({ok:false,message:'Resposta inválida do servidor.'}));
    if(!response.ok||!body?.ok)throw Error(body?.message||'Falha ao consultar prévia.');
    return body;
  },[]);
  React.useEffect(()=>{
    let active=true;
    load('options').then(result=>{if(active)setOptions(result);})
      .catch(err=>{if(active)setError(err.message||'Não foi possível listar os cadastros.');});
    return()=>{active=false;};
  },[load]);
  React.useEffect(()=>{
    let active=true;
    load('status').then(response=>{if(active)setPilot(response.pilot||null);}).catch(()=>{});
    return()=>{active=false;};
  },[load]);
  async function refreshPilot(){
    setBusy('status');setError('');
    try{
      const result=await load('refresh_pix');
      setPilot(result.pilot||null);
      toast.success('Situação consultada no Asaas Produção.');
    }catch(err){setError(err?.message||'Não foi possível consultar a cobrança.');}
    finally{setBusy('');}
  }
  async function createRealPix(){
    if(pilot||!preview?.approved)return;
    if(confirmation.trim()!=='AUTORIZO PIX REAL'||!accepted){
      setError('Confirme a cobrança real de R$ 7,00 e digite AUTORIZO PIX REAL.');return;
    }
    const ok=window.confirm('ATENÇÃO: criar cobrança PIX REAL de R$ 7,00 no Asaas Produção para o cliente selecionado? Pode haver tarifa real. Nenhum pedido ou nota será enviado ao Bling.');
    if(!ok)return;
    setBusy('create');setError('');
    try{
      const result=await load('create_pix',{client_id:customerId,product_id:productId,
        quantity:Number(quantity),confirm_phrase:'AUTORIZO PIX REAL',confirm_real_payment:true});
      setPilot(result.pilot||null);
      setPreview(null);
      setAccepted(false);setConfirmation('');
      toast.success('PIX real criado. Nenhum pedido enviado ao Bling.');
    }catch(err){
      setError(err?.message||'Não foi possível confirmar. Confira o Asaas antes de tentar novamente.');
      try{const state=await load('status');setPilot(state.pilot||null);}catch{}
    }finally{setBusy('');}
  }
  async function copyPix(){
    if(!pilot?.pix_payload)return;
    try{await navigator.clipboard.writeText(pilot.pix_payload);toast.success('Pix Copia e Cola copiado.');}
    catch{toast.error('Selecione o código e copie manualmente.');}
  }
  async function review(event){
    event.preventDefault();
    setBusy('preview');setError('');setPreview(null);setAccepted(false);setConfirmation('');
    try{
      const result=await load('preview',{client_id:customerId,product_id:productId,quantity:Number(quantity)});
      setPreview(result);
      toast.success('Prévia concluída. Nenhuma cobrança real foi criada.');
    }catch(err){setError(err.message||'Não foi possível conferir o pedido.');}
    finally{setBusy('');}
  }
  const filteredProducts=(options?.products||[]).filter(p=>
    (p.name+' '+p.sku).toLowerCase().includes(filter.toLowerCase())
  );
  return <div style={{marginTop:20,borderTop:'1px solid #e3ece8',paddingTop:20}}>
    <h3 style={{fontSize:18}}>6. Primeiro pedido real — prévia e PIX controlado</h3>
    <p style={{marginTop:8,fontSize:13}}>Selecione um cliente, um produto e a quantidade para conferir cadastro, estoque, preço e integração no Asaas e Bling. <strong>Esta operação não cria PIX, boleto, cobrança ou pedido.</strong></p>
    {!options&&!error&&<p className="muted" style={{fontSize:13}}>Carregando clientes e produtos...</p>}
    <form onSubmit={review} style={{display:'grid',gap:12,marginTop:14}}>
      <div className="field">
        <label>Cliente da primeira venda</label>
        <select value={customerId} onChange={e=>{setCustomerId(e.target.value);setPreview(null);}} required style={{width:'100%',minHeight:44}}>
          <option value="">Selecione o cliente</option>
          {(options?.clients||[]).map(c=><option key={c.id} value={c.id}>
            {c.name}{!c.document_valid?' (revisar CPF/CNPJ)':!c.has_bling?' (sem ID Bling)':''}
          </option>)}
        </select>
      </div>
      <div className="field">
        <label>Produto da primeira venda</label>
        <input placeholder="Pesquisar por nome ou SKU" value={filter} onChange={e=>setFilter(e.target.value)}/>
        <select value={productId} onChange={e=>{setProductId(e.target.value);setPreview(null);}} required style={{width:'100%',minHeight:44,marginTop:8}}>
          <option value="">Selecione o produto</option>
          {filteredProducts.slice(0,200).map(p=><option value={p.id} key={p.id}>
            {p.name} · {p.sku||'sem SKU'} · {money(p.price)} · Estoque {p.stock}
          </option>)}
        </select>
        <p className="muted" style={{fontSize:11,marginTop:6}}>Exibindo até 200 produtos por pesquisa. Nenhum preço pode ser alterado neste teste.</p>
      </div>
      <div className="field" style={{maxWidth:170}}>
        <label>Quantidade</label>
        <input type="number" min="1" max="20" step="1" value={quantity} onChange={e=>{setQuantity(e.target.value);setPreview(null);}} required/>
      </div>
      <button className="btn btn-primary" disabled={!!busy||!customerId||!productId||!quantity} style={{justifyContent:'center',minHeight:45}}>
        <ShieldCheck size={16}/>{busy?'Conferindo...':'Simular e validar pedido (sem cobrança)'}
      </button>
    </form>
    {error&&<div className="form-error" style={{marginTop:12}}>{error}</div>}
    {preview&&<div style={{marginTop:16,padding:14,border:'1px solid #dce8e3',borderRadius:13}}>
      <strong style={{color:preview.approved?'#11644c':'#97501c'}}>
        {preview.approved?'Prévia aprovada — cobranças ainda desativadas':'Prévia com '+preview.issues+' pendência(s)'}
      </strong>
      <div className="detail-list" style={{marginTop:11}}>
        <div className="detail-item"><span>Cliente</span><strong>{preview.selection?.client_name}</strong></div>
        <div className="detail-item"><span>Produto</span><strong>{preview.selection?.product_name}</strong></div>
        <div className="detail-item"><span>Quantidade</span><strong>{preview.selection?.quantity}</strong></div>
        <div className="detail-item"><span>Valor unitário</span><strong>{money(preview.selection?.unit_price)}</strong></div>
        <div className="detail-item"><span>Valor total previsto</span><strong>{money(preview.selection?.total)}</strong></div>
      </div>
      <div style={{display:'grid',gap:8,marginTop:12}}>
        {(preview.checks||[]).map(item=><div key={item.id} style={{padding:'9px 10px',background:'#f9fbfa',border:'1px solid #e5ece8',borderRadius:9}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
            <strong style={{fontSize:12}}>{item.label}</strong>
            <strong style={{fontSize:12,color:item.ok?'#11644c':'#ac4c24'}}>{item.ok?'OK':'Pendente'}</strong>
          </div>
          <div className="muted" style={{fontSize:11,marginTop:4}}>{item.detail}</div>
        </div>)}
      </div>
      <p style={{fontSize:12,fontWeight:750,color:'#935317',marginTop:12}}>{preview.message}</p>
      {preview.approved&&!pilot&&preview.selection?.sku==='100388'&&preview.selection?.quantity===1&&Number(preview.selection?.total)===7&&<div style={{marginTop:15,padding:14,border:'2px solid #dbb16c',borderRadius:13,background:'#fffbf2'}}>
        <strong style={{fontSize:16,color:'#8a4a14'}}>Próxima ação opcional: criar PIX REAL de R$ 7,00</strong>
        <p style={{marginTop:9,fontSize:12,lineHeight:1.6}}>Este botão gera uma cobrança financeira verdadeira na conta de produção do Asaas. O pagamento é facultativo e pode ter tarifas. Para proteger sua conta, o primeiro piloto é limitado ao ÁLCOOL 70% 1L (SKU 100388), 1 unidade, R$ 7,00, com bloqueio de repetição. Clientes ausentes no Asaas serão cadastrados antes da cobrança, com notificações desabilitadas.</p>
        <label style={{display:'flex',gap:8,alignItems:'flex-start',margin:'12px 0',fontSize:13}}>
          <input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} style={{width:18,height:18,marginTop:2}}/>
          Estou ciente de que se trata de uma cobrança REAL de R$ 7,00, não de uma simulação.
        </label>
        <div className="field">
          <label>Digite AUTORIZO PIX REAL para confirmar</label>
          <input type="text" placeholder="AUTORIZO PIX REAL" value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" style={{width:'100%'}}/>
        </div>
        <button type="button" className="btn" onClick={createRealPix} disabled={!!busy||!accepted||confirmation.trim()!=='AUTORIZO PIX REAL'} style={{width:'100%',justifyContent:'center',background:'#975b1b',color:'white',marginTop:12,minHeight:46}}>
          <ShieldCheck size={16}/>{busy==='create'?'Criando cobrança real...':'CRIAR PIX REAL — R$ 7,00'}
        </button>
        <p style={{fontSize:12,color:'#8b551b',marginTop:8}}>O pedido NÃO será enviado ao Bling e a NF-e NÃO será emitida automaticamente.</p>
      </div>}
    </div>}
    {pilot&&<section style={{marginTop:16,padding:15,border:'1px solid #c9e6d6',borderRadius:14,background:'#f7fbf9'}}>
      <h3 style={{fontSize:18}}>Cobrança piloto de produção</h3>
      <p style={{fontSize:12,marginTop:8}}>Uma única tentativa está registrada e novas cobranças piloto estão bloqueadas para evitar duplicidades.</p>
      <div className="detail-list" style={{marginTop:12}}>
        <div className="detail-item"><span>Valor real</span><strong>{money(pilot.total)}</strong></div>
        <div className="detail-item"><span>Estado</span><strong>{pilot.state}</strong></div>
        <div className="detail-item"><span>Situação do pagamento</span><strong>{pilot.payment_status}</strong></div>
        <div className="detail-item"><span>Identificador Asaas</span><strong style={{fontSize:11,overflowWrap:'anywhere'}}>{pilot.payment_id||'Em conferência'}</strong></div>
      </div>
      {pilot.message&&<p style={{color:'#9a4a21',fontSize:12,marginTop:9}}>{pilot.message}</p>}
      {pilot.pix_image&&<div style={{marginTop:14,textAlign:'center'}}>
        <img src={'data:image/png;base64,'+pilot.pix_image} alt="QR Code PIX real do Asaas" style={{maxWidth:'min(100%,270px)',borderRadius:10}}/>
      </div>}
      {pilot.pix_payload&&<div style={{marginTop:10}}>
        <label style={{fontSize:12}}>Pix Copia e Cola — PRODUÇÃO REAL</label>
        <textarea rows={3} readOnly value={pilot.pix_payload} style={{width:'100%',marginTop:6,fontSize:12}}/>
        <button type="button" className="btn btn-white" onClick={copyPix} style={{marginTop:8}}><Copy size={16}/>Copiar PIX real</button>
      </div>}
      {pilot.invoice_url&&<p style={{marginTop:10,fontSize:13}}><a href={pilot.invoice_url} target="_blank" rel="noopener noreferrer">Abrir cobrança no Asaas</a></p>}
      <button type="button" className="btn btn-primary" onClick={refreshPilot} disabled={!!busy} style={{marginTop:12}}>
        <RefreshCw size={16}/>{busy==='status'?'Consultando...':'Atualizar situação no Asaas'}
      </button>
      <p className="muted" style={{marginTop:10,fontSize:12}}>Se a emissão retornou erro inconclusivo, NÃO repita a cobrança. Confira a conta Asaas usando o identificador externo. Pedidos Bling e notas fiscais seguem desativados.</p>
    </section>}
  </div>;
}

function BlingPreparation({data,navigate,reload:argumentsReload}){
  const callback='https://evercleancatalogo.netlify.app/.netlify/functions/bling-oauth-callback';
  const [bling,setBling]=React.useState(null);
  const [blingError,setBlingError]=React.useState('');
  const [busy,setBusy]=React.useState('');
  const message=new URLSearchParams(window.location.search).get('bling');
  const ready=(data.orders||[]).filter(o=>o.payment_status==='pago'&&String(o.source||'').includes('Asaas'));
  const incomplete=ready.map(order=>{
    const customer=(data.clients||[]).find(client=>client.id===order.customer_id);
    return {order,noDocument:!customer||![11,14].includes(String(customer.document||'').replace(/\D/g,'').length),noSku:!Array.isArray(order.items)||order.items.some(item=>!item.product_sku)};
  });
  const callBling=React.useCallback(async(url,action)=>{
    const response=await fetch('/.netlify/functions/'+url,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action})
    });
    return response.json().catch(()=>({ok:false,message:'Resposta inválida do servidor.'}));
  },[]);
  const loadStatus=React.useCallback(async()=>{
    try{
      const result=await callBling('bling-integration','status');
      if(result?.ok){setBling(result);setBlingError('');}
      else{setBlingError(result?.message||'Conexão indisponível.');setBling(null);}
    }catch{setBlingError('Falha ao consultar o estado da integração.');}
  },[callBling]);
  React.useEffect(()=>{loadStatus();},[loadStatus]);
  async function connect(){
    setBusy('connect');setBlingError('');
    try{
      const result=await callBling('bling-oauth-start','start');
      if(!result?.ok||!result?.url)throw Error(result?.message||'Falha ao abrir o Bling.');
      window.location.assign(result.url);
    }catch(error){setBlingError(error?.message||'Falha ao iniciar autorização.');setBusy('');}
  }
  async function testConnection(){
    setBusy('test');setBlingError('');
    try{
      const result=await callBling('bling-integration','test');
      if(!result?.ok)throw Error(result?.message||'Erro de conexão.');
      toast.success(result.message||'Conexão validada!');
      await loadStatus();
    }catch(error){setBlingError(error?.message||'Falha ao testar conexão.');}
    finally{setBusy('');}
  }
  async function copyCallback(){
    try{await navigator.clipboard.writeText(callback);toast.success('URL copiada!');}
    catch{toast.error('Não foi possível copiar. Selecione a URL.')}
  }
  return <>
    <section className="hero" style={{marginBottom:16}}>
      <div><span className="eyebrow">BLING • INTEGRAÇÃO PRIVADA</span>
        <h1>Integração Bling</h1>
        <p>Conexão OAuth segura. Pedidos automáticos e emissão de NF-e permanecem desativados até a validação.</p>
      </div>
      <button className="btn btn-white" onClick={()=>navigate('/admin')}>Voltar ao painel</button>
    </section>
    <section className="panel" style={{padding:18,marginBottom:16}}>
      <h2 style={{fontSize:18}}>1. Proteção do acesso administrativo</h2>
      <p>O acesso sem senha foi removido. Para habilitar a conexão com dados reais, configure a senha usando a variável <strong>EVERCLEAN_ADMIN_SETUP_KEY</strong> no Netlify.</p>
      <button className="btn btn-white" onClick={()=>navigate('/redefinir-senha')}><ShieldCheck size={16}/>Configurar ou recuperar senha</button>
      <p className="muted" style={{fontSize:12,marginTop:12}}>Depois de salvar a senha segura, faça login novamente. Isso invalida as sessões antigas.</p>
    </section>
    <section className="panel" style={{padding:18,marginBottom:16}}>
      <h2 style={{fontSize:18}}>2. Autorizar aplicativo Bling</h2>
      {message==='connected'&&<p style={{color:'#146044',fontWeight:700}}>O Bling confirmou a autorização e as credenciais foram armazenadas de forma protegida.</p>}
      {message&&message!=='connected'&&<p style={{color:'#a43a27'}}>A autorização não foi concluída ({message}). Revise os dados do aplicativo e tente novamente.</p>}
      <div className="detail-list">
        <div className="detail-item"><span>Credenciais no Netlify</span><strong>{bling?.configured?'Configuradas':bling?'Pendentes':'Verificando...'}</strong></div>
        <div className="detail-item"><span>Conexão OAuth</span><strong>{bling?.connected?'Conectado':bling?'Não conectado':'Verificando...'}</strong></div>
        {bling?.connected_at&&<div className="detail-item"><span>Conectado em</span><strong>{fmtDate(bling.connected_at)}</strong></div>}
      </div>
      {blingError&&<p className="form-error" style={{marginTop:12}}>{blingError}</p>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:16}}>
        <button className="btn btn-primary" onClick={connect} disabled={!!busy||!bling?.configured}><ExternalLink size={16}/>{busy==='connect'?'Abrindo Bling...':bling?.connected?'Autorizar novamente':'Conectar ao Bling'}</button>
        <button className="btn btn-white" onClick={testConnection} disabled={!!busy||!bling?.connected}><RefreshCw size={16}/>{busy==='test'?'Testando...':'Testar conexão'}</button>
        <button className="btn btn-white" onClick={loadStatus}><RefreshCw size={16}/>Atualizar estado</button>
      </div>
      <p className="muted" style={{fontSize:12,marginTop:12}}>A conexão permite somente os escopos autorizados no Bling. Nenhum pedido será enviado e nenhuma nota fiscal será emitida automaticamente nesta etapa.</p>
    </section>
    <BlingProductsSection connected={!!bling?.connected} stockSync={bling?.stock_sync} reloadStatus={loadStatus} reloadCatalog={argumentsReload} />
    <section className="panel" style={{padding:18,marginBottom:16}}>
      <h2 style={{fontSize:18}}>4. URL de retorno OAuth</h2>
      <div style={{overflowWrap:'anywhere',padding:12,background:'#f4f8f6',border:'1px solid #dce5e1',borderRadius:10,fontSize:13}}>{callback}</div>
      <button className="btn btn-white" onClick={copyCallback} style={{marginTop:10}}><Copy size={16}/>Copiar URL de retorno</button>
    </section>
    <section className="panel" style={{padding:18}}>
      <h2 style={{fontSize:18}}>5. Conferência dos pedidos pagos</h2>
      <div className="grid-stats" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))',marginTop:10}}>
        <div className="stat"><small>Pedidos de teste pagos</small><strong>{ready.length}</strong></div>
        <div className="stat"><small>Pendências de cadastro para integração</small><strong>{incomplete.filter(item=>item.noDocument||item.noSku).length}</strong></div>
      </div>
      {incomplete.length>0&&<div className="detail-list" style={{marginTop:12}}>
        {incomplete.slice(0,12).map(({order,noDocument,noSku})=><div className="detail-item" key={order.id} style={{alignItems:'flex-start',gap:8}}>
          <span>{order.order_number||'Pedido'} · {money(order.total_amount)}</span>
          <strong style={{fontSize:12,textAlign:'right'}}>{[noDocument?'Verificar CPF/CNPJ':null,noSku?'Verificar SKU':null].filter(Boolean).join(' • ')||'Campos básicos presentes'}</strong>
        </div>)}
      </div>}
      <p className="muted" style={{fontSize:12,marginTop:12}}>A presença de CPF/CNPJ e SKU não comprova correspondência com os IDs do Bling. A NF-e permanece manual.</p>
    </section>
    <BlingOrderPreflight connected={!!bling?.connected}/>
    <BlingPilotOrder connected={!!bling?.connected}/>
    <BlingSaleReconciliation connected={!!bling?.connected}/>
    <BlingProductionReadiness connected={!!bling?.connected}/>
  </>;
}

function BlingProductsSection({connected,stockSync,reloadStatus,reloadCatalog}){
  const [autoBusy,setAutoBusy]=React.useState('');
  const [autoMessage,setAutoMessage]=React.useState('');
  const [autoError,setAutoError]=React.useState('');
  const [preview,setPreview]=React.useState(null);
  const [busy,setBusy]=React.useState('');
  const [error,setError]=React.useState('');
  const [result,setResult]=React.useState('');
  const count=preview?.summary||{};
  async function syncAction(action){
    setAutoBusy(action);setAutoMessage('');setAutoError('');
    try{
      const response=await fetch('/.netlify/functions/bling-integration',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action})
      });
      const result=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!result?.ok)throw Error(result?.message||'Não foi possível concluir a sincronização.');
      setAutoMessage(result.message||'Ação concluída.');
      toast.success(result.message||'Ação concluída.');
      if(reloadStatus)await reloadStatus();
      if(action==='sync_now'&&reloadCatalog)await reloadCatalog();
    }catch(error){setAutoError(error?.message||'Falha na sincronização.');}
    finally{setAutoBusy('');}
  }
  async function request(payload){
    const response=await fetch('/.netlify/functions/bling-products',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida do servidor.'}));
    if(!response.ok||!data?.ok)throw Error(data?.message||'Não foi possível consultar produtos.');
    return data;
  }
  async function inspect(){
    setBusy('preview');setError('');setResult('');setPreview(null);
    try{
      const answer=await request({action:'preview'});
      setPreview(answer);
      toast.success('Produtos do Bling conferidos. Nenhum dado alterado.');
    }catch(e){setError(e?.message||'Falha ao consultar os produtos.');}
    finally{setBusy('');}
  }
  async function apply(mode){
    if(!preview?.preview_token)return;
    const confirmation=mode==='stock'
      ?'Atualizar o estoque dos produtos com SKU correspondente usando o saldo disponível do Bling? Os preços serão preservados.'
      :'Importar os produtos sem correspondência no Bling? Todos serão cadastrados OCULTOS e precisarão ser publicados individualmente.';
    if(!window.confirm(confirmation))return;
    setBusy(mode);setError('');setResult('');
    try{
      const answer=await request({action:'apply',mode,preview_token:preview.preview_token});
      setPreview(null);
      setResult(answer.message);
      toast.success(answer.message);
      if(reloadCatalog)await reloadCatalog();
    }catch(e){setError(e?.message||'Não foi possível aplicar as alterações.');}
    finally{setBusy('');}
  }
  return <section className="panel" style={{padding:18,marginBottom:16}}>
    <h2 style={{fontSize:18}}>3. Produtos e estoque do Bling</h2>
    <p>Compare os códigos SKU, confira o estoque disponível e escolha o que deseja atualizar. Os preços do catálogo nunca são modificados pela atualização de estoque.</p>
    <div style={{padding:14,border:'1px solid #dce8e3',borderRadius:14,marginTop:14,marginBottom:14,background:'#f7faf8'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',justifyContent:'space-between'}}>
        <strong style={{fontSize:15}}>Atualização automática de estoque</strong>
        <span className={`badge ${stockSync?.enabled===false?'orange':'green'}`}>{stockSync?.enabled===false?'Pausada':'A cada 30 minutos'}</span>
      </div>
      <div className="detail-list" style={{marginTop:10}}>
        <div className="detail-item"><span>Última sincronização bem-sucedida</span><strong>{stockSync?.last_success_at?fmtDate(stockSync.last_success_at):'Aguardando primeira execução'}</strong></div>
        <div className="detail-item"><span>Produtos conferidos na última execução</span><strong>{stockSync?.last_success_at?stockSync.updated_count??0:'—'}</strong></div>
        <div className="detail-item"><span>Quantidades alteradas</span><strong>{stockSync?.last_success_at?stockSync.changed_count??0:'—'}</strong></div>
        <div className="detail-item"><span>Produtos vinculados com ID Bling</span><strong>{stockSync?.linked_count??'—'}</strong></div>
      </div>
      {stockSync?.last_result==='error'&&<p style={{fontSize:12,color:'#9c3f27',marginTop:10}}>Falha mais recente: {stockSync.last_error||'Consulte os registros do Netlify.'} (tentativa em {fmtDate(stockSync.last_attempt_at)})</p>}
      {autoError&&<div className="form-error" style={{marginTop:10}}>{autoError}</div>}
      {autoMessage&&<p style={{marginTop:10,color:'#17654e',fontWeight:700,fontSize:13}}>{autoMessage}</p>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
        <button className="btn btn-primary" onClick={()=>syncAction('sync_now')} disabled={!connected||!!autoBusy||!!busy}>
          <RefreshCw size={16}/>{autoBusy==='sync_now'?'Atualizando...':'Sincronizar estoque agora'}
        </button>
        <button className="btn btn-white" onClick={()=>syncAction(stockSync?.enabled===false?'sync_resume':'sync_pause')} disabled={!connected||!!autoBusy||!!busy}>
          {autoBusy==='sync_pause'||autoBusy==='sync_resume'?'Salvando...':stockSync?.enabled===false?'Reativar automático':'Pausar automático'}
        </button>
      </div>
      <p className="muted" style={{fontSize:12,marginTop:9}}>A rotina consulta o Bling a cada meia hora. Atualiza apenas produtos com ID e SKU únicos já vinculados. Os preços não mudam; produtos pendentes permanecem de fora.</p>
    </div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
      <button className="btn btn-primary" disabled={!connected||!!busy} onClick={inspect}>
        <RefreshCw size={16}/>{busy==='preview'?'Consultando Bling...':'Conferir produtos e estoque'}
      </button>
    </div>
    {!connected&&<p className="muted" style={{marginTop:10,fontSize:12}}>Conecte o Bling e confirme a senha administrativa para consultar.</p>}
    {error&&<div className="form-error" style={{marginTop:14}}>{error}</div>}
    {result&&<p style={{marginTop:14,color:'#116347',fontWeight:700}}>{result}</p>}
    {preview&&<>
      <p className="muted" style={{fontSize:12,marginTop:14}}>Consulta em {fmtDate(preview.checked_at)} • Nenhuma alteração aplicada</p>
      <div className="grid-stats" style={{gridTemplateColumns:'repeat(3,minmax(0,1fr))',marginTop:8}}>
        <div className="stat"><small>Produtos Bling</small><strong>{preview.bling_total}</strong></div>
        <div className="stat"><small>SKU em comum</small><strong>{count.matched||0}</strong></div>
        <div className="stat"><small>Novos no catálogo</small><strong>{count.new||0}</strong></div>
      </div>
      <div className="detail-list" style={{marginTop:12}}>
        <div className="detail-item"><span>Estoque consultado para produtos vinculáveis</span><strong>{count.stock_ready||0}</strong></div>
        <div className="detail-item"><span>Sem estoque confirmado</span><strong>{count.stock_missing||0}</strong></div>
        <div className="detail-item"><span>SKUs repetidos / sem SKU</span><strong>{(count.duplicates||0)+(count.missing_sku||0)}</strong></div>
      </div>
      {preview.warning&&<p style={{marginTop:12,color:'#8b5a13',fontSize:13}}>{preview.warning}</p>}
      {preview.truncated&&<p style={{marginTop:12,color:'#8b5a13',fontSize:13}}>Há mais produtos do que o limite desta consulta. A alteração fica bloqueada até completar a varredura.</p>}
      <div style={{marginTop:12,maxHeight:360,overflowY:'auto',border:'1px solid #e4ece8',borderRadius:12}}>
        {(preview.products||[]).map((p,i)=><div key={p.bling_id||i} style={{padding:'10px 12px',borderBottom:'1px solid #e4ece8',display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',justifyContent:'space-between'}}>
          <div style={{minWidth:130,flex:'1 1 180px'}}>
            <strong style={{fontSize:13}}>{p.name||'Produto sem descrição'}</strong>
            <div className="muted" style={{fontSize:11}}>SKU: {p.sku||'ausente'} · Bling #{p.bling_id}</div>
          </div>
          <div style={{textAlign:'right',fontSize:12}}>
            <strong style={{color:p.status==='duplicate'||p.status==='missing_sku'?'#9c3f27':p.status==='matched'?'#17654e':'#666'}}>
              {p.status==='matched'?'Vinculável':p.status==='new'?'Novo (oculto)':p.status==='duplicate'?'SKU duplicado':'Sem SKU'}
            </strong>
            <div className="muted" style={{fontSize:11}}>Estoque: {p.stock_available?(p.status==='matched'?String(p.catalog_stock??'?')+' → ':'')+String(p.stock):'indisponível'}</div>
          </div>
        </div>)}
      </div>
      <p className="muted" style={{fontSize:12,marginTop:8}}>Exibindo amostra de até 48 produtos. A prévia considera os {preview.bling_total} produtos consultados. Produtos duplicados e sem SKU não são alterados.</p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:15}}>
        <button className="btn btn-primary" disabled={!!busy||!preview.stock_permission||preview.truncated||!(count.stock_ready>0)} onClick={()=>apply('stock')}>
          <Save size={15}/>{busy==='stock'?'Atualizando...':'Atualizar estoques vinculáveis'}
        </button>
        <button className="btn btn-white" disabled={!!busy||!preview.stock_permission||preview.truncated||!(count.new>0)} onClick={()=>apply('import')}>
          <Package size={15}/>{busy==='import'?'Importando...':'Importar produtos novos ocultos'}
        </button>
      </div>
      <p className="muted" style={{fontSize:12,marginTop:10}}>Importação cria apenas produtos ocultos, com SKU, preço e estoque confirmados; não publica automaticamente. Preços existentes não são substituídos. A prévia expira em 10 minutos.</p>
    </>}
  </section>;
}


function BlingOrderPreflight({connected}){
  const [result,setResult]=React.useState(null);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  async function check(){
    setBusy(true);setError('');setResult(null);
    try{
      const response=await fetch('/.netlify/functions/bling-orders',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'preview'})
      });
      const body=await response.json().catch(()=>({ok:false,message:'Resposta inválida do servidor.'}));
      if(!response.ok||!body?.ok)throw Error(body?.message||'Erro ao conferir pedidos.');
      setResult(body);
      toast.success('Pedidos conferidos. Nenhum dado enviado ao Bling.');
    }catch(err){setError(err?.message||'Não foi possível conferir pedidos.');}
    finally{setBusy(false);}
  }
  return <section className="panel" style={{padding:18,marginTop:16}}>
    <h2 style={{fontSize:18}}>6. Preparar envio de pedidos pagos</h2>
    <p>Confira a correspondência dos pedidos pagos com os contatos e produtos do Bling antes de autorizar qualquer envio real.</p>
    <div style={{background:'#fff8e8',border:'1px solid #f1e1b8',borderRadius:12,padding:12,margin:'12px 0',color:'#875a15',fontSize:13}}>
      <strong>Modo de homologação.</strong> Os pedidos pagos no Asaas Sandbox não podem ser registrados como vendas reais no Bling. Nenhum pedido ou nota fiscal será criado nesta etapa.
    </div>
    <button className="btn btn-primary" disabled={!connected||busy} onClick={check}>
      <RefreshCw size={16}/>{busy?'Validando pedidos...':'Conferir pedidos para o Bling'}
    </button>
    {error&&<div className="form-error" style={{marginTop:12}}>{error}</div>}
    {result&&<>
      <div className="grid-stats" style={{gridTemplateColumns:'repeat(3,minmax(0,1fr))',marginTop:16}}>
        <div className="stat"><small>Pedidos pagos</small><strong>{result.orders_found||0}</strong></div>
        <div className="stat"><small>Conferidos</small><strong>{result.reviewed||0}</strong></div>
        <div className="stat"><small>Bloqueados para envio</small><strong>{result.blocked||0}</strong></div>
      </div>
      <p className="muted" style={{fontSize:12,marginTop:12}}>Validações na API: {result.provider_check?.checked||0}; contatos conferidos: {result.provider_check?.contact_validated||0}; produtos conferidos: {result.provider_check?.products_validated||0}.</p>
      {(result.provider_check?.issues||[]).length>0&&<div style={{fontSize:12,marginTop:10,color:'#985b24'}}>{result.provider_check.issues.slice(0,8).map((issue,i)=><p key={i}>{issue}</p>)}</div>}
      <div style={{display:'grid',gap:9,marginTop:12}}>
        {(result.orders||[]).map(order=><div key={order.order_id} style={{border:'1px solid #e3ebe7',borderRadius:12,padding:12}}>
          <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:6}}>
            <strong>{order.order_number} · {money(order.amount)}</strong>
            <span className={`badge ${order.blocked?'orange':'green'}`}>{order.blocked?'Pendente / Teste':'Pré-validado'}</span>
          </div>
          <p style={{fontSize:12,margin:'7px 0 0',color:'#53656c'}}>{order.customer_name} · {order.items.length} produto(s) · {order.source}</p>
          {order.reasons?.length>0&&<div style={{marginTop:8,fontSize:12,color:'#9c3f27'}}>{order.reasons.map((reason,i)=><div key={i}>• {reason}</div>)}</div>}
        </div>)}
      </div>
      <p className="muted" style={{fontSize:12,marginTop:12}}>{result.message} O envio automático só será ativado depois de homologar pagamentos reais, vínculos dos clientes e regras de duplicidade.</p>
    </>}
  </section>;
}



function BlingPilotOrder({connected}){
  const [state,setState]=React.useState(null);
  const [preview,setPreview]=React.useState(null);
  const [busy,setBusy]=React.useState('');
  const [error,setError]=React.useState('');
  const [note,setNote]=React.useState('');
  const [accepted,setAccepted]=React.useState(false);
  const [phrase,setPhrase]=React.useState('');
  const [recoverAccepted,setRecoverAccepted]=React.useState(false);
  const [recoverPhrase,setRecoverPhrase]=React.useState('');
  const request=React.useCallback(async(action,extra={})=>{
    const response=await fetch('/.netlify/functions/bling-pilot-order',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action,...extra})
    });
    const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
    if(!response.ok||!data.ok){
      const error=new Error(data.message||'Operação não concluída.');
      error.record=data.export_record||null;
      throw error;
    }
    return data;
  },[]);
  const refresh=React.useCallback(async()=>{
    try{const result=await request('status');setState(result);}
    catch(error){setError(error.message);}
  },[request]);
  React.useEffect(()=>{if(connected)refresh();},[connected,refresh]);
  async function inspect(){
    setBusy('preview');setError('');setNote('');setPreview(null);setAccepted(false);setPhrase('');
    try{
      const result=await request('preview');
      setPreview(result);
      if(result.approved)toast.success('Pedido pago conferido. Nada enviado ao Bling.');
      else toast.warning('Existem pendências para registrar o pedido.');
    }catch(err){setError(err.message);}
    finally{setBusy('');}
  }
  async function send(){
    if(!preview?.approved||!accepted||phrase.trim()!=='AUTORIZO ENVIAR PEDIDO AO BLING')return;
    if(!window.confirm('Confirmar CRIAÇÃO REAL de um pedido de venda de R$ 7,00 no Bling? O estoque e a nota fiscal NÃO serão lançados automaticamente. Não clique novamente em caso de erro.'))return;
    setBusy('send');setError('');setNote('');
    try{
      const result=await request('send',{accepted:true,confirm_phrase:'AUTORIZO ENVIAR PEDIDO AO BLING'});
      setState(old=>({...old,export_record:result.export_record}));
      setPreview(null);
      setNote(result.message);
      toast.success('Pedido registrado no Bling!');
    }catch(err){
      setError(err.message);
      if(err.record)setState(old=>({...old,export_record:err.record}));
      try{await refresh();}catch{}
    }finally{setBusy('');}
  }
  async function reconcile(){
    setBusy('reconcile');setError('');setNote('');
    try{
      const result=await request('reconcile');
      setState(old=>({...old,export_record:result.export_record}));
      setNote(result.message);
    }catch(err){setError(err.message);}
    finally{setBusy('');}
  }
  async function recover(){
    if(!recoverAccepted||recoverPhrase.trim()!=='CONFIRMO PEDIDO AUSENTE NO BLING')return;
    if(!window.confirm('Você conferiu no Bling que NÃO existe pedido para este pagamento? A ação apenas libera uma NOVA tentativa; nenhum pedido será criado agora.'))return;
    setBusy('recover');setError('');setNote('');setPreview(null);
    try{
      const result=await request('recover',{
        confirm_phrase:'CONFIRMO PEDIDO AUSENTE NO BLING',
        manual_checked:true
      });
      setState(old=>({...old,export_record:result.export_record}));
      setRecoverAccepted(false);setRecoverPhrase('');
      setNote(result.message);
      toast.success(result.message);
    }catch(err){setError(err?.message||'Não foi possível liberar uma nova tentativa.');}
    finally{setBusy('');}
  }
  const record=state?.export_record;
  const retryOpen=record?.state==='retry_liberado';
  return <section className="panel" style={{padding:18,marginTop:16}}>
    <h2 style={{fontSize:18}}>7. Primeiro pedido pago — enviar ao Bling</h2>
    <p>Controle exclusivo da primeira cobrança PIX real de R$ 7,00 já recebida no Asaas Produção. Nenhum pedido será enviado sem sua autorização expressa.</p>
    <div style={{padding:12,borderRadius:10,background:'#fff7e8',border:'1px solid #ecd8b5',color:'#8a521c',marginTop:12,fontSize:13}}>
      <strong>Atenção:</strong> criar o pedido pode afetar processos comerciais configurados no Bling. A integração não lançará estoque, contas a receber nem emitirá NF-e. Confira no ERP o tratamento de estoque e faturamento após o envio.
    </div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:14}}>
      <button className="btn btn-primary" disabled={!connected||!!busy||(!!record&&!retryOpen)} onClick={inspect}>
        <RefreshCw size={16}/>{busy==='preview'?'Conferindo...':'Conferir pedido PIX pago'}
      </button>
      <button className="btn btn-white" disabled={!connected||!!busy} onClick={refresh}>Atualizar situação</button>
    </div>
    {error&&<div className="form-error" style={{marginTop:12}}>{error}</div>}
    {note&&<p style={{marginTop:12,color:'#17654e',fontWeight:700,fontSize:13}}>{note}</p>}
    {record&&<div style={{padding:13,marginTop:13,borderRadius:10,background:'#f5f9f7',border:'1px solid #dce8e3'}}>
      <strong>Registro de exportação</strong>
      <div className="detail-list" style={{marginTop:9}}>
        <div className="detail-item"><span>Estado</span><strong>{record.state}</strong></div>
        <div className="detail-item"><span>ID no Bling</span><strong>{record.bling_order_id||'Em conferência'}</strong></div>
        <div className="detail-item"><span>Número no Bling</span><strong>{record.order_number||'Não informado'}</strong></div>
        <div className="detail-item"><span>Referência de origem</span><strong style={{fontSize:11,overflowWrap:'anywhere',maxWidth:'60%',textAlign:'right'}}>{record.reference}</strong></div>
      </div>
      {record.message&&<p style={{fontSize:12,color:'#9c5227',marginTop:10}}>{record.message}</p>}
      <button className="btn btn-white" disabled={!!busy} onClick={reconcile} style={{marginTop:12}}>
        <RefreshCw size={16}/>{busy==='reconcile'?'Conferindo...':'Consultar pedido no Bling (sem recriar)'}
      </button>
      {record.state==='conferencia_manual'&&<div style={{marginTop:16,padding:14,border:'1px solid #dfbd8b',borderRadius:11,background:'#fffaf0'}}>
        <strong style={{color:'#8b4a19',fontSize:14}}>Recuperar tentativa bloqueada por limite da API Bling</strong>
        <p style={{fontSize:12,marginTop:8,lineHeight:1.6}}>O servidor registrou erro de limite de requisições do Bling (HTTP 429) na tentativa anterior. A API não encontrou um pedido com esta referência. Antes de liberar outro envio, confira também manualmente em <strong>Bling → Vendas → Pedidos de venda</strong> se o pedido pago de R$ 7,00 já está registrado.</p>
        <label style={{display:'flex',gap:8,alignItems:'flex-start',margin:'12px 0',fontSize:12}}>
          <input type="checkbox" checked={recoverAccepted} onChange={e=>setRecoverAccepted(e.target.checked)} style={{width:18,height:18,marginTop:2}}/>
          Consultei os pedidos de venda no Bling e confirmo que este pagamento não gerou pedido.
        </label>
        <div className="field">
          <label>Digite CONFIRMO PEDIDO AUSENTE NO BLING</label>
          <input value={recoverPhrase} onChange={e=>setRecoverPhrase(e.target.value)} placeholder="CONFIRMO PEDIDO AUSENTE NO BLING" autoComplete="off"/>
        </div>
        <button type="button" className="btn btn-white" style={{marginTop:10,width:'100%',justifyContent:'center',minHeight:46}}
          disabled={!!busy||!recoverAccepted||recoverPhrase.trim()!=='CONFIRMO PEDIDO AUSENTE NO BLING'} onClick={recover}>
          <ShieldCheck size={16}/>{busy==='recover'?'Verificando...':'Verificar novamente e liberar uma tentativa'}
        </button>
        <p style={{fontSize:12,color:'#91521a',marginTop:10}}>Este botão NÃO envia nada ao Bling: apenas verifica novamente se o pedido existe e, se estiver ausente, habilita uma única tentativa adicional.</p>
      </div>}
      {retryOpen&&<p style={{marginTop:12,color:'#17664c',fontWeight:700,fontSize:13}}>Uma nova tentativa controlada foi liberada. Clique em "Conferir pedido PIX pago" e autorize o envio apenas após a prévia aprovada.</p>}
      <p className="muted" style={{fontSize:12,marginTop:10}}>Uma tentativa já foi registrada; novas tentativas permanecem bloqueadas até passar pelas verificações de segurança.</p>
    </div>}
    {preview&&<div style={{marginTop:14,padding:13,border:'1px solid #dce8e3',borderRadius:12}}>
      <strong style={{color:preview.approved?'#17664c':'#934717'}}>
        {preview.approved?'Prévia aprovada — nenhum pedido criado':'Prévia com '+(preview.reasons||[]).length+' impedimento(s)'}
      </strong>
      <div className="detail-list" style={{marginTop:9}}>
        <div className="detail-item"><span>Pagamento Asaas</span><strong>{preview.payment_status||'Pendente'}</strong></div>
        <div className="detail-item"><span>Cliente</span><strong>{preview.customer_name||'—'}</strong></div>
        <div className="detail-item"><span>Produto</span><strong>{preview.product_name||'—'}</strong></div>
        <div className="detail-item"><span>SKU / Quantidade</span><strong>{preview.sku||'—'} / {preview.quantity||'—'}</strong></div>
        <div className="detail-item"><span>Valor recebido</span><strong>{money(preview.total||0)}</strong></div>
      </div>
      {(preview.reasons||[]).map((reason,i)=><p key={i} style={{fontSize:12,color:'#9b492a',marginTop:8}}>• {reason}</p>)}
      {preview.approved&&(!record||retryOpen)&&<div style={{marginTop:15,padding:13,borderRadius:10,background:'#fffaf0',border:'1px solid #eac98d'}}>
        <strong style={{color:'#91521a',fontSize:14}}>Autorização de lançamento REAL no Bling</strong>
        <p style={{fontSize:12,marginTop:8}}>Confirme que este pedido ainda não foi lançado manualmente no Bling. Esta ação cria apenas o pedido de venda e utiliza uma referência única para evitar duplicidades.</p>
        <label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:13,margin:'10px 0'}}>
          <input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} style={{width:18,height:18,marginTop:2}}/>
          Conferi que este pedido não está lançado manualmente e autorizo criar o registro no Bling.
        </label>
        <div className="field">
          <label>Digite AUTORIZO ENVIAR PEDIDO AO BLING</label>
          <input value={phrase} onChange={e=>setPhrase(e.target.value)} placeholder="AUTORIZO ENVIAR PEDIDO AO BLING" autoComplete="off"/>
        </div>
        <button type="button" className="btn btn-primary" style={{marginTop:10,width:'100%',justifyContent:'center',minHeight:48}}
          onClick={send} disabled={!!busy||!accepted||phrase.trim()!=='AUTORIZO ENVIAR PEDIDO AO BLING'}>
          <ShieldCheck size={16}/>{busy==='send'?'Enviando...':'CRIAR PEDIDO REAL NO BLING — R$ 7,00'}
        </button>
        <p className="muted" style={{fontSize:12,marginTop:8}}>Não serão enviados os pedidos Sandbox, nem geradas notas fiscais ou baixas de estoque pela API.</p>
      </div>}
    </div>}
  </section>;
}



function BlingSaleReconciliation({connected}){
  const [report,setReport]=React.useState(null);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  async function check(){
    setBusy(true);setError('');setReport(null);
    try{
      const response=await fetch('/.netlify/functions/bling-reconcile-sale',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'reconcile'})
      });
      const result=await response.json().catch(()=>({ok:false,message:'Resposta inválida do servidor.'}));
      if(!result.ok||!response.ok)throw Error(result.message||'Não foi possível conferir os registros.');
      setReport(result);
      if(result.reconciled)toast.success('Pedido e pagamento conferidos, sem alterações.');
      else toast.warning('Conferência concluída. Verifique os itens sinalizados.');
    }catch(err){setError(err.message||'Falha ao consultar Asaas e Bling.');}
    finally{setBusy(false);}
  }
  return <section className="panel" style={{padding:18,marginTop:16}}>
    <h2 style={{fontSize:18}}>8. Conciliação final — pedido de venda 1237</h2>
    <p>Compare o pagamento PIX real de R$ 7,00 com os dados do pedido no Bling. Esta conferência só consulta as plataformas: não altera situação comercial, estoque, contas ou NF-e.</p>
    <button className="btn btn-primary" style={{marginTop:12}} onClick={check} disabled={!connected||busy}>
      <RefreshCw size={16}/>{busy?'Conferindo...':'Conferir pagamento e pedido'}
    </button>
    {error&&<div className="form-error" style={{marginTop:12}}>{error}</div>}
    {report&&<div style={{marginTop:15}}>
      <strong style={{color:report.reconciled?'#17654e':'#955323',fontSize:15}}>
        {report.reconciled?'Conciliação aprovada':'Conciliação com verificações pendentes'}
      </strong>
      <div className="detail-list" style={{marginTop:12}}>
        <div className="detail-item"><span>Pagamento Asaas</span><strong>{report.payment?.status||'—'}</strong></div>
        <div className="detail-item"><span>Valor recebido</span><strong>{money(report.payment?.amount||0)}</strong></div>
        <div className="detail-item"><span>Pedido Bling</span><strong>{report.order?.number||'—'}</strong></div>
        <div className="detail-item"><span>ID Bling</span><strong>{report.order?.id||'—'}</strong></div>
        <div className="detail-item"><span>Última conferência</span><strong>{fmtDate(report.checked_at)}</strong></div>
      </div>
      <div style={{marginTop:12,display:'grid',gap:7}}>
        {(report.checks||[]).map((item,i)=><div key={i} style={{padding:'10px 12px',border:'1px solid #e3ebe7',borderRadius:10,background:'#f9fbfa'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}>
            <strong style={{fontSize:12}}>{item.label}</strong>
            <strong style={{fontSize:12,color:item.status==='ok'?'#17664c':item.status==='unverified'?'#805d2c':'#a94b24'}}>
              {item.status==='ok'?'OK':item.status==='unverified'?'Não confirmado':'Revisar'}
            </strong>
          </div>
          {item.details&&<p className="muted" style={{fontSize:11,marginTop:4}}>{item.details}</p>}
        </div>)}
      </div>
      <div style={{marginTop:13,padding:12,background:'#f6f9f8',borderRadius:11,border:'1px solid #dfe9e4'}}>
        <strong style={{fontSize:13}}>Conferência do estoque</strong>
        {report.stock?.checked?
          <div className="detail-list" style={{marginTop:8}}>
            <div className="detail-item"><span>Saldo virtual no Bling</span><strong>{report.stock.virtual??'Não informado'}</strong></div>
            <div className="detail-item"><span>Saldo físico no Bling</span><strong>{report.stock.physical??'Não informado'}</strong></div>
          </div>:
          <p className="muted" style={{fontSize:12,marginTop:6}}>Saldo não confirmado nesta consulta. Confira a movimentação diretamente no Bling.</p>}
        <p className="muted" style={{fontSize:12,marginTop:8}}>Não desconte a mesma unidade novamente sem verificar se o pedido já a reservou ou baixou. A sincronização de saldo do catálogo segue a configuração atual.</p>
      </div>
      <p style={{marginTop:12,fontSize:13,fontWeight:650,color:report.reconciled?'#17654e':'#955323'}}>{report.message}</p>
    </div>}
    <p style={{fontSize:12,marginTop:12,color:'#66777f'}}>A situação “Em aberto” no Bling é uma etapa comercial e não invalida o pagamento recebido no Asaas. Verifique manualmente os lançamentos financeiros, a movimentação de estoque e a emissão fiscal antes de concluir a venda.</p>
  </section>;
}



function BlingProductionReadiness({connected}){
  const [result,setResult]=React.useState(null);
  const [loading,setLoading]=React.useState(false);
  const [confirming,setConfirming]=React.useState(false);
  const [manualChecked,setManualChecked]=React.useState(false);
  const [error,setError]=React.useState('');
  async function audit(){
    setLoading(true);setError('');setResult(null);
    try{
      const response=await fetch('/.netlify/functions/bling-automation-readiness',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'audit'})
      });
      const body=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!body?.ok)throw Error(body.message||'Não foi possível concluir a auditoria.');
      setResult(body);
      toast.success('Auditoria concluída sem alterar pagamentos ou pedidos.');
    }catch(err){setError(err?.message||'Falha na auditoria.');}
    finally{setLoading(false);}
  }
  async function confirmMovement(){
    setConfirming(true);setError('');
    try{
      const response=await fetch('/.netlify/functions/bling-automation-readiness',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'confirm_stock_movement',confirmed:manualChecked,
          order_number:'1237',sku:'100388',quantity:1})
      });
      const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!data?.ok)throw Error(data.message||'Não foi possível registrar a conferência.');
      setManualChecked(false);toast.success('Conferência da baixa registrada. Nenhum estoque foi alterado.');
      await audit();
    }catch(err){setError(err?.message||'Falha ao conferir movimentação.');}
    finally{setConfirming(false);}
  }
  const rows=result?.blockers||[];
  const problems=result?.issue_counts||{};
  const canConfirmMovement=result?.pilot?.payment_confirmed&&result?.pilot?.order_linked&&
    result?.pilot?.order?.number==='1237'&&result?.pilot?.order?.quantity===1&&
    Number(result?.pilot?.stock?.physical)===0&&Number(result?.pilot?.stock?.virtual)===0&&
    !result?.remote_error;
  return <section className="panel" style={{padding:18,marginTop:16}}>
    <h2 style={{fontSize:18}}>9. Preparar automação dos próximos pedidos</h2>
    <p>Auditoria de segurança antes de ativar vendas reais pelo catálogo. Confere o estoque, os SKUs e o tratamento do pedido piloto nº 1237. Nenhuma cobrança ou novo pedido será criado.</p>
    <button className="btn btn-primary" style={{marginTop:12}} disabled={!connected||loading} onClick={audit}>
      <ShieldCheck size={16}/>{loading?'Auditando...':'Auditar prontidão para produção'}
    </button>
    {error&&<div className="form-error" style={{marginTop:12}}>{error}</div>}
    {result&&<>
      <div style={{padding:12,marginTop:14,borderRadius:12,background:'#fff7e9',border:'1px solid #ebd6b4',color:'#88521d',fontSize:12}}>
        <strong>Automação ainda desativada.</strong> O checkout segue no Asaas Sandbox. O envio automático de pedidos ao Bling e a emissão de NF-e permanecem desligados.
      </div>
      <div className="grid-stats" style={{gridTemplateColumns:'repeat(3,minmax(0,1fr))',marginTop:12}}>
        <div className="stat"><small>Produtos visíveis</small><strong>{result.active_products??0}</strong></div>
        <div className="stat"><small>Permitem encomenda</small><strong>{problems.allow_backorder??0}</strong></div>
        <div className="stat"><small>Sem estoque positivo</small><strong>{problems.zero_stock??0}</strong></div>
      </div>
      <div style={{marginTop:14,padding:14,border:'1px solid #dce8e3',borderRadius:12,background:'#f6fbf8'}}>
        <strong style={{fontSize:14,color:'#17654b'}}>Pedidos sob encomenda: permitidos</strong>
        <p style={{fontSize:12,marginTop:8,lineHeight:1.6}}>
          A Ever Clean aceita pedidos sem saldo em estoque. Os {problems.zero_stock??0} produtos com saldo zerado podem ser encomendados quando habilitados. Cada pedido sem disponibilidade deve ser revisado para reposição ou regularização do estoque físico no Bling. O sistema não fará baixa de estoque nem autorizará expedição automática desses itens.
        </p>
      </div>
      <div className="detail-list" style={{marginTop:12}}>
        <div className="detail-item"><span>Produtos sem SKU</span><strong>{problems.without_sku??0}</strong></div>
        <div className="detail-item"><span>SKU duplicado</span><strong>{problems.duplicate_sku??0}</strong></div>
        <div className="detail-item"><span>Sem vínculo com o Bling</span><strong>{problems.without_bling_id??0}</strong></div>
        <div className="detail-item"><span>Estoque sem sincronização confirmada</span><strong>{problems.not_verified_stock??0}</strong></div>
      </div>
      {result.pilot?.order_linked&&<div style={{border:'1px solid #e0e9e5',borderRadius:12,padding:12,marginTop:12}}>
        <strong style={{fontSize:13}}>Venda piloto nº {result.pilot?.order?.number||1237}</strong>
        <div className="detail-list" style={{marginTop:8}}>
          <div className="detail-item"><span>PIX de produção</span><strong>{result.pilot.payment_confirmed?'Recebido':'Revisar'}</strong></div>
          <div className="detail-item"><span>Saldo físico SKU 100388</span><strong>{result.pilot.stock?.physical??'Não confirmado'}</strong></div>
          <div className="detail-item"><span>Saldo virtual SKU 100388</span><strong>{result.pilot.stock?.virtual??'Não confirmado'}</strong></div>
          <div className="detail-item"><span>Movimentação de saída do pedido</span>
            <strong>{result.pilot.stock_release_not_yet_verified?'Conferência pendente':'Conferida manualmente'}</strong></div>
        </div>
      </div>}
      {result?.pilot?.order_linked&&result?.pilot?.stock_release_not_yet_verified&&
        <div style={{marginTop:12,padding:12,border:'1px solid #e0e9e5',borderRadius:12}}>
          <strong style={{fontSize:13}}>Confirmar baixa já efetuada no Bling</strong>
          <p style={{fontSize:12,marginTop:8}}>Somente após conferir no histórico do Bling: saída de 1,00 unidade do SKU 100388 com origem Venda 1237. Esta confirmação não realiza outra baixa.</p>
          <label style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:12,marginTop:9}}>
            <input type="checkbox" checked={manualChecked} onChange={event=>setManualChecked(event.target.checked)} />
            Conferi no Bling a movimentação de saída de 1 unidade vinculada à venda 1237.
          </label>
          <button className="btn btn-primary" style={{marginTop:10}} type="button"
            disabled={!manualChecked||!canConfirmMovement||confirming||loading}
            onClick={confirmMovement}>
            <ShieldCheck size={15}/>{confirming?'Registrando...':'Registrar conferência da baixa'}
          </button>
          {!canConfirmMovement&&<p style={{fontSize:12,marginTop:7,color:'#955323'}}>Confirme primeiro o pagamento, o pedido 1237 e ambos os saldos zerados pela auditoria.</p>}
        </div>}
      <div style={{marginTop:15,display:'grid',gap:8}}>
        {rows.map(item=><div key={item.key} style={{padding:'10px 12px',background:'#f9fbfa',border:'1px solid #e3ebe7',borderRadius:10}}>
          <div style={{display:'flex',gap:8,justifyContent:'space-between',alignItems:'center'}}>
            <strong style={{fontSize:12}}>{item.label}</strong>
            <strong style={{fontSize:12,color:item.ok?'#17654b':'#9c5527'}}>{item.ok?'OK':'Pendente'}</strong>
          </div>
          <p className="muted" style={{fontSize:11,marginTop:5}}>{item.details}</p>
        </div>)}
      </div>
      {result.remote_error&&<p style={{fontSize:12,color:'#9c5527',marginTop:12}}>Consulta do Bling incompleta: {result.remote_error}</p>}
      {result?.pilot?.stock_release_not_yet_verified?
        <p className="muted" style={{fontSize:12,marginTop:12}}>Próximo passo: conferir e registrar a saída de 1 unidade do pedido 1237 no Bling. A auditoria não cria outra movimentação.</p>:
        <div style={{marginTop:12,padding:12,borderRadius:10,border:'1px solid #dce8e3'}}>
          <strong style={{fontSize:13,color:'#17654e'}}>Baixa do pedido 1237 conferida.</strong>
          <p className="muted" style={{fontSize:12,marginTop:5}}>Próxima etapa: preparar o checkout público do Asaas em produção, sem ativar automaticamente cobranças, pedidos ou NF-e.</p>
          <a className="btn btn-primary btn-sm" style={{marginTop:9,display:'inline-flex'}} href="/admin/asaas">Verificar Asaas Produção</a>
        </div>}
    </>}
  </section>;
}


function Dashboard({data,reload,navigate}){
  const summary=data.financial_summary;
  const received=data.links.filter(l=>l.status==='enviado').length;
  const visible=data.products.filter(p=>p.catalog_visible!==false&&p.active!==false).length;
  const currentTotal=data.orders.filter(o=>o.status!=='historico').reduce((sum,o)=>sum+Number(o.total_amount||0),0);
  const heroAction=<><button className="btn btn-white" onClick={()=>navigate('/admin/asaas')}><RefreshCw size={16}/>Diagnosticar PIX Asaas</button><button className="btn btn-white" onClick={()=>navigate('/admin/bling')}><ExternalLink size={16}/>Preparar integração Bling</button><button className="btn btn-white" onClick={()=>navigate('/admin/importar')}><DatabaseBackup size={16}/>{summary?'Atualizar backup':'Importar backup Bling'}</button></>;
  return <><Hero eyebrow="CENTRAL EVER CLEAN • TESTE" title="Painel Geral" text={summary?'Operação enriquecida com o backup do Bling e dados temporários do Netlify.':'Dados temporários hospedados no Netlify, sem dependência do Supabase.'} onRefresh={reload} action={heroAction}/>
    <div className="grid-stats">
      <button className="stat stat-link" onClick={()=>navigate('/admin/clientes')}><small>Clientes</small><strong>{summary?.clients_with_history??data.clients.length}</strong><span>{summary?'Com histórico de compras':'Abrir clientes →'}</span></button>
      <button className="stat stat-link" onClick={()=>navigate('/admin/produtos')}><small>Produtos no catálogo</small><strong>{summary?.products_catalog_visible??visible}</strong><span>{summary?`${summary.products_active||data.products.length} ativos no cadastro`:'Abrir produtos →'}</span></button>
      <button className="stat stat-link" onClick={()=>navigate('/admin/pedidos')}><small>{summary?'Faturamento 2026':'Pedidos recebidos'}</small><strong>{summary?money(summary.sales_2026_total):received}</strong><span>{summary?`${summary.sales_2026_orders||0} pedidos • ticket ${money(summary.sales_2026_average_ticket)}`:'Abrir pedidos →'}</span></button>
      <button className="stat stat-link" onClick={()=>navigate('/admin/links-pedido')}><small>{summary?'A receber em aberto':'Valor conhecido'}</small><strong>{summary?money(summary.receivables_open):money(currentTotal)}</strong><span>{summary?`${summary.receivables_open_count||0} títulos`:'Abrir links →'}</span></button>
    </div>
    {summary?<div className="panel"><div className="panel-head"><h2>Resumo do backup • {summary.backup_date||'Bling'}</h2></div><div style={{padding:18}}><div className="detail-list"><div className="detail-item"><span>Histórico total de vendas</span><strong>{money(summary.historical_sales_total)}</strong></div><div className="detail-item"><span>Pedidos históricos</span><strong>{summary.historical_orders||0}</strong></div><div className="detail-item"><span>Contas a pagar em aberto</span><strong>{money(summary.payables_open)}</strong></div><div className="detail-item"><span>Pedidos recebidos pelo catálogo</span><strong>{received}</strong></div></div></div></div>
    :<div className="panel"><div className="panel-head"><h2>Próximo passo</h2></div><div style={{padding:20,lineHeight:1.7,color:'#53656c'}}>Importe o backup do Bling para trazer clientes, produtos, histórico de pedidos e indicadores. O arquivo é processado no navegador e os dados não são publicados no GitHub.</div></div>}</>;
}

function Clients({data,reload}){
  const [search,setSearch]=React.useState('');
  const [edit,setEdit]=React.useState(null);
  const [busy,setBusy]=React.useState('');
  const rows=data.clients.filter(c=>`${c.trade_name||''} ${c.legal_name||''} ${c.document||''} ${c.city||''} ${c.email||''}`.toLowerCase().includes(search.toLowerCase()));
  async function save(){setBusy('save');const res=await testApi('save_client',{client:edit});setBusy('');if(!res?.ok){toast.error(res?.message||'Erro ao salvar cliente');return;}toast.success('Cliente salvo');setEdit(null);await reload();}
  async function generate(c){setBusy(c.id);const res=await testApi('create_link',{customer_id:c.id});setBusy('');if(!res?.ok){toast.error(res?.message||'Erro ao gerar link');return;}const url=`${window.location.origin}/${res.link.checkout_mode==='production'?'pedido-producao':'pedido'}/${res.link.token}`;try{await navigator.clipboard.writeText(url)}catch{}toast.success(`${orderCode(res.link.request_number)} criado e copiado`);await reload();const phone=String(c.phone||'').replace(/\D/g,'');if(phone&&window.confirm('Link copiado. Abrir WhatsApp do cliente?')){const number=phone.startsWith('55')?phone:`55${phone}`;window.open(`https://wa.me/${number}?text=${encodeURIComponent(`Olá! Seu catálogo Ever Clean para reposição está disponível: ${url}`)}`,'_blank')}}
  return <><Hero eyebrow="CLIENTES • TESTE" title="Clientes" text="Cadastre clientes e gere links exclusivos de pedido." onRefresh={reload} action={<button className="btn btn-white" onClick={()=>setEdit({trade_name:'',legal_name:'',document:'',phone:'',email:'',invoice_email:'',city:'Campo Grande/MS',allow_boleto:false,payment_terms:'',credit_limit:0})}><Plus size={16}/>Novo cliente</button>}/><div className="panel"><div className="panel-head"><div style={{position:'relative'}}><Search size={16} style={{position:'absolute',left:12,top:13,color:'#819096'}}/><input className="search" style={{paddingLeft:36}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente..."/></div></div><div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Última compra</th><th>Histórico</th><th>Pagamento</th><th>Cidade</th><th style={{textAlign:'right'}}>Ações</th></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td><strong>{c.trade_name}</strong><div className="muted" style={{fontSize:11}}>{c.legal_name&&c.legal_name!==c.trade_name?c.legal_name:(c.document||'Guilherme Amaral')}</div></td><td>{c.last_order_at?fmtDate(c.last_order_at):'—'}</td><td><strong>{c.order_count||0} pedidos</strong><div className="muted" style={{fontSize:11}}>{c.historical_revenue!=null?money(c.historical_revenue):'Sem histórico'}</div></td><td><span className={`badge ${c.allow_boleto?'green':'orange'}`}>{c.allow_boleto?'Boleto liberado':'À vista'}</span><div className="muted" style={{fontSize:11,marginTop:4}}>{c.preferred_payment_method==='boleto'?'Preferência: boleto':'Preferência: PIX'}</div></td><td>{c.city||'—'}</td><td><div className="actions"><button className="icon-btn" title="Editar" onClick={()=>setEdit({...c})}><Save size={15}/></button><button className="btn btn-primary btn-sm" disabled={busy===c.id} onClick={()=>generate(c)}><Link2 size={14}/>{busy===c.id?'Gerando...':'Gerar link'}</button></div></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">Nenhum cliente encontrado.</div>}</div></div>{edit&&<ClientModal value={edit} setValue={setEdit} onClose={()=>setEdit(null)} onSave={save} saving={busy==='save'}/>}</>;
}

function ClientModal({value,setValue,onClose,onSave,saving}){return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>{value.id?'Editar cliente':'Novo cliente'}</h3><button className="icon-btn" onClick={onClose}><XCircle size={17}/></button></div><div className="modal-body">
  <div className="field"><label>Nome fantasia / identificação</label><input value={value.trade_name||''} onChange={e=>setValue({...value,trade_name:e.target.value})}/></div>
  <div className="field"><label>Razão social / nome</label><input value={value.legal_name||''} onChange={e=>setValue({...value,legal_name:e.target.value})}/></div>
  <div className="product-edit"><div className="field"><label>CPF/CNPJ</label><input value={value.document||''} onChange={e=>setValue({...value,document:e.target.value})}/></div><div className="field"><label>Telefone / WhatsApp</label><input value={value.phone||''} onChange={e=>setValue({...value,phone:e.target.value})}/></div></div>
  <div className="product-edit"><div className="field"><label>E-mail</label><input type="email" value={value.email||''} onChange={e=>setValue({...value,email:e.target.value})}/></div><div className="field"><label>E-mail para NFe</label><input type="email" value={value.invoice_email||''} onChange={e=>setValue({...value,invoice_email:e.target.value})}/></div></div>
  <div className="field"><label>Cidade</label><input value={value.city||''} onChange={e=>setValue({...value,city:e.target.value})}/></div>
  <div className="product-edit"><div className="field"><label>Condição de pagamento</label><input value={value.payment_terms||''} onChange={e=>setValue({...value,payment_terms:e.target.value})} placeholder="Ex.: 14 dias, 28 dias..."/></div><div className="field"><label>Limite de crédito</label><input type="number" min="0" step="0.01" value={value.credit_limit??0} onChange={e=>setValue({...value,credit_limit:e.target.value})}/></div></div>
  <label className="switch" style={{marginTop:10}}><input type="checkbox" checked={Boolean(value.allow_boleto)} onChange={e=>setValue({...value,allow_boleto:e.target.checked,payment_methods:e.target.checked?['pix','cartao','link_pagamento','boleto']:['pix','cartao','link_pagamento']})}/> Liberar boleto / compra a prazo</label>
</div><div className="modal-foot"><button className="btn btn-white" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={onSave} disabled={saving}><Save size={16}/>{saving?'Salvando...':'Salvar'}</button></div></div></div>}

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
  return <><Hero eyebrow="PEDIDOS • TESTE" title="Pedidos" text="Pedidos recebidos pelo catálogo online." onRefresh={reload}/><div className="panel"><div className="panel-head"><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pedido ou cliente..."/></div><div className="table-wrap"><table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Valor conhecido</th><th>Status</th></tr></thead><tbody>{rows.map(o=><tr key={o.id}><td><strong>{o.order_number||'—'}</strong></td><td>{o.customer_name||'—'}</td><td>{fmtDate(o.created_at)}</td><td>{money(o.total_amount||0)}</td><td><Status value={o.status}/>{o.fulfillment_requires_review&&<div style={{fontSize:11,fontWeight:700,color:'#a86d20',marginTop:5}}>Sob encomenda — conferir estoque</div>}</td></tr>)}</tbody></table>{!rows.length&&<div className="empty">Nenhum pedido recebido ainda.</div>}</div></div><ProductionOrdersPanel/></>;
}

function ProductionOrdersPanel(){
  const [rows,setRows]=React.useState([]);
  const [loading,setLoading]=React.useState(false);
  const [error,setError]=React.useState('');
  const load=React.useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const response=await fetch('/.netlify/functions/asaas-production-orders',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'list'})
      });
      const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!data?.ok)throw Error(data.message||'Falha ao consultar Neon.');
      setRows(data.orders||[]);
    }catch(err){setError(err.message||'Pedidos Neon indisponíveis.');}
    finally{setLoading(false);}
  },[]);
  React.useEffect(()=>{load();},[load]);
  return <section className="panel" style={{marginTop:16}}>
    <div className="panel-head">
      <div>
        <h2>Pedidos reais • Asaas Produção / Neon</h2>
        <p className="muted" style={{fontSize:12,marginTop:6}}>
          Consulta financeira separada do Sandbox. Baixa de estoque, envio ao Bling e NF-e permanecem manuais.
        </p>
      </div>
      <button className="btn btn-white btn-sm" onClick={load} disabled={loading}>
        <RefreshCw size={15}/>{loading?'Consultando...':'Atualizar'}
      </button>
    </div>
    {error&&<p className="form-error" style={{margin:14}}>{error}</p>}
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Solicitação</th><th>Cliente</th><th>Valor</th><th>Pagamento</th><th>Atendimento</th></tr></thead>
      <tbody>{rows.map((o,i)=><tr key={o.request_number+'-'+i}>
        <td><strong>{orderCode(o.request_number)}</strong><div className="muted" style={{fontSize:11}}>{fmtDate(o.created_at)}</div></td>
        <td>{o.customer_name}</td>
        <td>{money(o.amount)}</td>
        <td><Status value={o.status}/></td>
        <td>{o.requires_stock_review?'Sob encomenda — revisar':'Conferir e separar'}</td>
      </tr>)}</tbody>
    </table>
    {!rows.length&&!loading&&<div className="empty">Nenhum pedido real registrado no Neon.</div>}
    </div>
  </section>;
}

function Links({data,reload}){
  const [selected,setSelected]=React.useState(null);
  async function cancel(link){if(!window.confirm(`Cancelar ${orderCode(link.request_number)}?`))return;const res=await testApi('cancel_link',{id:link.id});if(!res?.ok){toast.error(res?.message||'Erro ao cancelar');return;}toast.success('Link cancelado');await reload();}
  function url(link){return `${window.location.origin}/${link.checkout_mode==='production'?'pedido-producao':'pedido'}/${link.token}`}
  async function copy(link){try{await navigator.clipboard.writeText(url(link));toast.success('Link copiado')}catch{toast.error('Não foi possível copiar')}}
  return <><Hero eyebrow="LINKS DE PEDIDO • TESTE" title="Links de Pedido" text="Acompanhe geração, abertura e envio dos pedidos." onRefresh={reload}/><div className="panel"><div className="table-wrap"><table className="table"><thead><tr><th>Solicitação</th><th>Cliente</th><th>Criado</th><th>Aberto</th><th>Enviado</th><th>Status</th><th style={{textAlign:'right'}}>Ações</th></tr></thead><tbody>{data.links.map(l=><tr key={l.id}><td><strong>{orderCode(l.request_number)}</strong></td><td>{l.customer_name}</td><td>{fmtDate(l.created_at)}</td><td>{fmtDate(l.first_opened_at)}</td><td>{fmtDate(l.submitted_at)}</td><td><Status value={l.status}/></td><td><div className="actions"><button className="icon-btn" title="Detalhes" onClick={()=>setSelected(l)}><ClipboardList size={15}/></button><button className="icon-btn" title="Copiar" onClick={()=>copy(l)}><Copy size={15}/></button><button className="icon-btn" title="Abrir" onClick={()=>window.open(url(l),'_blank')}><ExternalLink size={15}/></button>{!['enviado','cancelado','expirado'].includes(l.status)&&<button className="icon-btn" title="Cancelar" onClick={()=>cancel(l)}><XCircle size={15}/></button>}</div></td></tr>)}</tbody></table>{!data.links.length&&<div className="empty">Nenhum link gerado ainda. Vá em Clientes e toque em “Gerar link”.</div>}</div></div>{selected&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>{orderCode(selected.request_number)}</h3><button className="icon-btn" onClick={()=>setSelected(null)}><XCircle size={17}/></button></div><div className="modal-body"><div className="detail-list"><div className="detail-item"><span>Cliente</span><strong>{selected.customer_name}</strong></div><div className="detail-item"><span>Status</span><Status value={selected.status}/></div><div className="detail-item"><span>Validade</span><strong>{fmtDate(selected.expires_at)}</strong></div><div className="detail-item"><span>Itens</span><strong>{selected.items_count||0}</strong></div><div className="detail-item"><span>Unidades</span><strong>{selected.units_count||0}</strong></div><div className="detail-item"><span>Valor conhecido</span><strong>{money(selected.known_total||0)}</strong></div></div></div><div className="modal-foot"><button className="btn btn-white" onClick={()=>copy(selected)}><Copy size={15}/>Copiar link</button><button className="btn btn-primary" onClick={()=>window.open(url(selected),'_blank')}><ExternalLink size={15}/>Abrir catálogo</button></div></div></div>}</>;
}
