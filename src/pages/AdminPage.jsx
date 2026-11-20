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
      setResult(data);
      if(action==='verify')toast.success('Produção Asaas verificada, sem criar cobrança.');
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
    {(result?.recent_events||[]).length>0&&<div style={{marginTop:12}}>
      <strong style={{fontSize:13}}>Eventos reais recebidos — somente monitoramento</strong>
      {(result.recent_events||[]).map((event,i)=><div className="detail-item" key={i} style={{fontSize:12}}><span>{event.event}</span><strong>{fmtDate(event.received_at)}</strong></div>)}
    </div>}
    <p className="muted" style={{fontSize:12,marginTop:14}}>No Asaas de produção, o webhook pode receber PAYMENT_CONFIRMED, PAYMENT_RECEIVED e CHECKOUT_PAID. Nenhum evento modifica os pedidos até que a operação real seja homologada.</p>
  </section>;
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
  async function generate(c){setBusy(c.id);const res=await testApi('create_link',{customer_id:c.id});setBusy('');if(!res?.ok){toast.error(res?.message||'Erro ao gerar link');return;}const url=`${window.location.origin}/pedido/${res.link.token}`;try{await navigator.clipboard.writeText(url)}catch{}toast.success(`${orderCode(res.link.request_number)} criado e copiado`);await reload();const phone=String(c.phone||'').replace(/\D/g,'');if(phone&&window.confirm('Link copiado. Abrir WhatsApp do cliente?')){const number=phone.startsWith('55')?phone:`55${phone}`;window.open(`https://wa.me/${number}?text=${encodeURIComponent(`Olá! Seu catálogo Ever Clean para reposição está disponível: ${url}`)}`,'_blank')}}
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
  return <><Hero eyebrow="PEDIDOS • TESTE" title="Pedidos" text="Pedidos recebidos pelo catálogo online." onRefresh={reload}/><div className="panel"><div className="panel-head"><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pedido ou cliente..."/></div><div className="table-wrap"><table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Valor conhecido</th><th>Status</th></tr></thead><tbody>{rows.map(o=><tr key={o.id}><td><strong>{o.order_number||'—'}</strong></td><td>{o.customer_name||'—'}</td><td>{fmtDate(o.created_at)}</td><td>{money(o.total_amount||0)}</td><td><Status value={o.status}/></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">Nenhum pedido recebido ainda.</div>}</div></div></>;
}

function Links({data,reload}){
  const [selected,setSelected]=React.useState(null);
  async function cancel(link){if(!window.confirm(`Cancelar ${orderCode(link.request_number)}?`))return;const res=await testApi('cancel_link',{id:link.id});if(!res?.ok){toast.error(res?.message||'Erro ao cancelar');return;}toast.success('Link cancelado');await reload();}
  function url(link){return `${window.location.origin}/pedido/${link.token}`}
  async function copy(link){try{await navigator.clipboard.writeText(url(link));toast.success('Link copiado')}catch{toast.error('Não foi possível copiar')}}
  return <><Hero eyebrow="LINKS DE PEDIDO • TESTE" title="Links de Pedido" text="Acompanhe geração, abertura e envio dos pedidos." onRefresh={reload}/><div className="panel"><div className="table-wrap"><table className="table"><thead><tr><th>Solicitação</th><th>Cliente</th><th>Criado</th><th>Aberto</th><th>Enviado</th><th>Status</th><th style={{textAlign:'right'}}>Ações</th></tr></thead><tbody>{data.links.map(l=><tr key={l.id}><td><strong>{orderCode(l.request_number)}</strong></td><td>{l.customer_name}</td><td>{fmtDate(l.created_at)}</td><td>{fmtDate(l.first_opened_at)}</td><td>{fmtDate(l.submitted_at)}</td><td><Status value={l.status}/></td><td><div className="actions"><button className="icon-btn" title="Detalhes" onClick={()=>setSelected(l)}><ClipboardList size={15}/></button><button className="icon-btn" title="Copiar" onClick={()=>copy(l)}><Copy size={15}/></button><button className="icon-btn" title="Abrir" onClick={()=>window.open(url(l),'_blank')}><ExternalLink size={15}/></button>{!['enviado','cancelado','expirado'].includes(l.status)&&<button className="icon-btn" title="Cancelar" onClick={()=>cancel(l)}><XCircle size={15}/></button>}</div></td></tr>)}</tbody></table>{!data.links.length&&<div className="empty">Nenhum link gerado ainda. Vá em Clientes e toque em “Gerar link”.</div>}</div></div>{selected&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>{orderCode(selected.request_number)}</h3><button className="icon-btn" onClick={()=>setSelected(null)}><XCircle size={17}/></button></div><div className="modal-body"><div className="detail-list"><div className="detail-item"><span>Cliente</span><strong>{selected.customer_name}</strong></div><div className="detail-item"><span>Status</span><Status value={selected.status}/></div><div className="detail-item"><span>Validade</span><strong>{fmtDate(selected.expires_at)}</strong></div><div className="detail-item"><span>Itens</span><strong>{selected.items_count||0}</strong></div><div className="detail-item"><span>Unidades</span><strong>{selected.units_count||0}</strong></div><div className="detail-item"><span>Valor conhecido</span><strong>{money(selected.known_total||0)}</strong></div></div></div><div className="modal-foot"><button className="btn btn-white" onClick={()=>copy(selected)}><Copy size={15}/>Copiar link</button><button className="btn btn-primary" onClick={()=>window.open(url(selected),'_blank')}><ExternalLink size={15}/>Abrir catálogo</button></div></div></div>}</>;
}
