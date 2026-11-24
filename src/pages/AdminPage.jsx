import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { BarChart3, Box, ClipboardList, Copy, DatabaseBackup, ExternalLink, Link2, LogOut, Package, Plus, RefreshCw, Save, Search, ShoppingCart, Users, XCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getTestToken, logoutTest, testApi } from '../lib/testApi.js';
import OrderTracking from '../components/OrderTracking.jsx';
import AddressFields from '../components/AddressFields.jsx';
import {addressFromClient,addressIssues,isCompleteAddress,formatAddress} from '../lib/address.js';
import {FULFILLMENT_LABELS,normalizeStage} from '../lib/fulfillment.js';
import {SITE_URL,isOrderPageUrl} from '../lib/site.js';

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

async function productionLinksApi(action,params={}) {
  const auth=getTestToken();
  if(!auth)return {ok:false,message:'Sessão expirada. Entre novamente na administração.'};
  const response=await fetch('/.netlify/functions/production-general-links',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},
    body:JSON.stringify({action,...params})
  });
  const payload=await response.json().catch(()=>({ok:false,message:'Resposta inválida dos links de produção.'}));
  if(!response.ok||payload?.ok!==true)return {ok:false,message:payload?.message||'Não foi possível concluir a operação.'};
  return payload;
}

function Brand(){return <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>GESTÃO DE PRODUÇÃO</small></div></div>}
function Loading(){return <div className="loading"><div><div className="spinner"/>Carregando...</div></div>}
function Status({value}){const cls=['enviado','recebido','atendido','paid'].includes(value)?'green':['cancelado','expirado','refunded','chargeback'].includes(value)?'red':'orange';const labels={prepared:'Preparado',gerado:'Gerado',aberto:'Aberto',enviado:'Recebido',recebido:'Recebido',cancelado:'Cancelado',expirado:'Expirado',atendido:'Atendido',paid:'Pago',payment_pending:'Aguardando pagamento',refunded:'Estornado',chargeback:'Contestação',manual_review:'Revisão manual'};return <span className={`badge ${cls}`}>{labels[value]||value||'—'}</span>}

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
      {section==='dashboard'&&<Dashboard {...props}/>} {section==='asaas'&&<AsaasDiagnostics navigate={navigate}/>} {section==='bling'&&<BlingPreparation {...props}/>} {section==='clients'&&<><SignupApprovalsPanel reload={props.reload} version={props.data}/><Clients {...props}/><CustomerPortalAdminPanel/></>} {section==='products'&&<Products {...props}/>} {section==='orders'&&<ProductionOrders/>} {section==='ordersHistory'&&<OrdersHistory {...props}/>} {section==='links'&&<Links {...props}/>} 
    </div></main>
    <MobileNav/>
  </div>;
}

function Hero({eyebrow,title,text,onRefresh,action}){return <section className="hero"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{action}<button className="btn btn-white" onClick={onRefresh}><RefreshCw size={16}/>Atualizar</button></div></section>}


function AsaasDiagnostics({navigate}) {
  const [checking,setChecking]=React.useState(false);
  const [result,setResult]=React.useState(null);
  const [error,setError]=React.useState('');
  const [notificationOrder,setNotificationOrder]=React.useState('000029');
  const [notificationReport,setNotificationReport]=React.useState(null);
  const [notificationMessage,setNotificationMessage]=React.useState('');
  const [notificationBusy,setNotificationBusy]=React.useState(false);
  const [duplicateOrder,setDuplicateOrder]=React.useState('000029');
  const [duplicateCandidates,setDuplicateCandidates]=React.useState([]);
  const [duplicateSelected,setDuplicateSelected]=React.useState('');
  const [duplicateLinked,setDuplicateLinked]=React.useState('');
  const [duplicateNotificationPending,setDuplicateNotificationPending]=React.useState(false);
  const [duplicateMessage,setDuplicateMessage]=React.useState('');
  const [duplicateBusy,setDuplicateBusy]=React.useState(false);
  async function inspectDuplicateCustomer(bind=false){
    if(duplicateBusy)return;
    const number=String(duplicateOrder||'').trim().replace(/^EC-/i,'').padStart(6,'0');
    if(!/^[0-9]{6}$/.test(number)){
      setDuplicateMessage('Informe um pedido Sandbox válido (ex.: EC-000029).');
      return;
    }
    if(bind){
      if(!duplicateCandidates.some(c=>c.id===duplicateSelected)){
        setDuplicateMessage('Escolha um cadastro Asaas antes de vincular.');return;
      }
      const chosen=duplicateCandidates.find(c=>c.id===duplicateSelected);
      if(!window.confirm('Vincular o cadastro Asaas '+chosen.name+
        ' ('+chosen.email_hint+') ao cliente Ever Clean do pedido EC-'+number+
        '? O CPF/CNPJ será validado no Asaas, as notificações pagas serão '+
        'desativadas e o e-mail mantido. Não cria cobrança, não exclui clientes.'))return;
    }
    setDuplicateBusy(true);setDuplicateMessage('');
    try{
      const result=await testApi(bind?'sandbox_customer_bind':'sandbox_customer_candidates',{
        request_number:number,
        ...(bind?{asaas_customer_id:duplicateSelected,confirm:true,
          confirm_phrase:'VINCULAR CLIENTE EC-'+number}:{})
      });
      // Nunca mostrar sucesso quando o servidor recusou o vínculo.
      // A API devolve erros comerciais em JSON, sem lançar exceção no fetch.
      if(!result?.ok){
        const message=result?.message||'Não foi possível confirmar o vínculo no Asaas.';
        setDuplicateMessage(message);
        if(bind)toast.error(message);
        else{
          setDuplicateCandidates([]);
          setDuplicateSelected('');
          setDuplicateLinked('');
        }
        return;
      }
      if(bind){
        if(result.linked!==true||result.verified_persisted!==true){
          setDuplicateMessage('O servidor não confirmou a gravação do cliente. Tente consultar novamente.');
          toast.error('Vínculo não confirmado.');
          return;
        }
        setDuplicateLinked(duplicateSelected);
        setDuplicateNotificationPending(result.notifications_ready===false);
        setDuplicateCandidates([]);setDuplicateSelected('');
        // O diagnóstico deve tratar o mesmo cliente recém-vinculado, não um
        // pedido antigo fixado no campo de notificações.
        setNotificationOrder(number);
        setNotificationReport(null);
        setNotificationMessage('Vínculo do pedido EC-'+number+
          ' salvo. Consulte as notificações deste mesmo cliente antes de pagar.');
        if(result.notifications_ready===false)
          toast.warning('Cliente vinculado. Pagamento bloqueado até desativar os canais pagos no Asaas.');
        else
          toast.success('Cliente Asaas Sandbox vinculado e canais de e-mail conferidos.');
      }else{
        const candidates=Array.isArray(result.candidates)?result.candidates:[];
        const previous=candidates.some(c=>c.id===result.current_customer_id)?
          result.current_customer_id:'';
        setDuplicateCandidates(candidates);
        setDuplicateSelected(previous);
        setDuplicateLinked(previous);
      }
      setDuplicateMessage(result.message||'Consulta concluída.');
    }catch(e){
      setDuplicateMessage(e?.message||'Não foi possível consultar o cliente Sandbox.');
      if(!bind)setDuplicateCandidates([]);
    }finally{setDuplicateBusy(false);}
  }
  async function reviewNotificationSettings(repair=false){
    if(notificationBusy)return;
    const normalized=String(notificationOrder||'').trim().replace(/^EC-/i,'').padStart(6,'0');
    if(!/^[0-9]{6}$/.test(normalized)){
      setNotificationMessage('Informe um pedido do Sandbox, como EC-000028.');
      return;
    }
    if(repair&&!window.confirm('Desativar APENAS SMS, WhatsApp, ligações e SMS da empresa '+
      'nas notificações do cliente do pedido EC-'+normalized+' no Asaas Sandbox? '+
      'As notificações por e-mail e o estado dos eventos serão preservados. '+
      'Nenhuma cobrança será criada.'))return;
    setNotificationBusy(true);setNotificationMessage('');
    try{
      const response=await testApi(repair?
        'repair_customer_notifications':'diagnose_customer_notifications',{
        request_number:normalized,
        ...(repair?{confirm:true,
          confirm_phrase:'REVISAR NOTIFICACOES EC-'+normalized}:{})
      });
      if(response.diagnostic)setNotificationReport(response.diagnostic);
      else if(!repair)setNotificationReport(null);
      setNotificationMessage(response.message||
        (response.ok?'Consulta concluída.':'Não foi possível concluir a consulta.'));
      if(repair&&response.ok)toast.success('Notificações do Sandbox conferidas.');
    }catch(e){
      setNotificationMessage(e?.message||'Falha na consulta ao Asaas Sandbox.');
    }finally{setNotificationBusy(false);}
  }
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
    <section id="asaas-notifications" className="panel" style={{padding:18,marginTop:16}}>
      <h2 style={{fontSize:17,marginBottom:8}}>
        Notificações do cliente · Asaas Sandbox
      </h2>
      <p className="muted" style={{fontSize:12,lineHeight:1.6}}>
        Verifique quais canais estão ativos para o cliente de um pedido
        antigo. A consulta não altera notificações, pedidos ou pagamentos.
      </p>
      <label style={{display:'block',fontSize:13,fontWeight:600,marginTop:12}}>
        Número do pedido de teste
        <input aria-label="Pedido de teste" type="text" inputMode="numeric"
          value={notificationOrder} maxLength={9}
          onChange={e=>{setNotificationOrder(e.target.value);
            setNotificationReport(null);setNotificationMessage('')}}
          placeholder="EC-000029"
          style={{display:'block',width:'100%',marginTop:6,maxWidth:260,
            border:'1px solid #cbd5d1',borderRadius:8,padding:11}}/>
      </label>
      <button className="btn btn-white" type="button"
        style={{marginTop:12}} disabled={notificationBusy}
        onClick={()=>reviewNotificationSettings(false)}>
        <ShieldCheck size={17}/>{notificationBusy?
          'Consultando Asaas...':'Revisar notificações do cliente'}
      </button>
      {notificationMessage&&<p role="status" style={{
        color:notificationReport?.channels_safe?'#176a4c':'#8b5c22',
        marginTop:12,fontSize:12,lineHeight:1.55}}>
        {notificationMessage}
      </p>}
      {notificationReport&&<>
        <div className="detail-list" style={{marginTop:12}}>
          <div className="detail-item"><span>Eventos ativos</span>
            <strong>{notificationReport.active} de {notificationReport.count}</strong></div>
          <div className="detail-item"><span>E-mail para cliente</span>
            <strong>{notificationReport.channels?.customer_email||0}</strong></div>
          <div className="detail-item"><span>E-mail para Ever Clean</span>
            <strong>{notificationReport.channels?.provider_email||0}</strong></div>
          <div className="detail-item"><span>SMS para cliente</span>
            <strong>{notificationReport.channels?.customer_sms||0}</strong></div>
          <div className="detail-item"><span>WhatsApp para cliente</span>
            <strong>{notificationReport.channels?.customer_whatsapp||0}</strong></div>
          <div className="detail-item"><span>Ligações automáticas</span>
            <strong>{notificationReport.channels?.customer_voice||0}</strong></div>
          <div className="detail-item"><span>SMS para Ever Clean</span>
            <strong>{notificationReport.channels?.provider_sms||0}</strong></div>
          <div className="detail-item"><span>WhatsApp sem confirmação</span>
            <strong>{notificationReport.missing_whatsapp_fields||0}</strong></div>
        </div>
        {notificationReport.needs_change&&<div style={{marginTop:14}}>
          <p className="muted" style={{fontSize:12,lineHeight:1.5}}>
            Para evitar tarifas, desligue apenas os canais pagos.
            Os avisos por e-mail continuarão com suas preferências atuais.
            Esta operação não cria nem modifica cobranças.
          </p>
          <button type="button" className="btn btn-primary"
            style={{marginTop:9}} disabled={notificationBusy}
            onClick={()=>reviewNotificationSettings(true)}>
            <ShieldCheck size={16}/>Desativar canais pagos deste cliente
          </button>
        </div>}
        {notificationReport.channels_safe&&
          <p style={{color:'#17694c',fontSize:12,marginTop:12}}>
            Canais pagos desligados. Configuração segura para o próximo teste.
          </p>}
      </>}
    </section>
    <section className="panel" style={{padding:18,marginTop:16}}>
      <h2 style={{fontSize:17,marginBottom:8}}>Resolver cliente duplicado · Asaas Sandbox</h2>
      <p className="muted" style={{fontSize:12,lineHeight:1.55}}>
        Se o Asaas encontrar cadastros duplicados, confira o já vinculado
        ou selecione o correto. O sistema sincronizará o vínculo no cliente
        e no pedido e verificará a gravação. Não cria cobrança.
      </p>
      <label style={{display:'block',fontWeight:600,fontSize:13,marginTop:12}}>
        Pedido de teste
        <input aria-label="Pedido com cliente Asaas duplicado"
          type="text" inputMode="numeric" maxLength={9}
          value={duplicateOrder}
          onChange={e=>{
            setDuplicateOrder(e.target.value);setDuplicateCandidates([]);
            setDuplicateSelected('');setDuplicateLinked('');
            setDuplicateNotificationPending(false);setDuplicateMessage('');
          }}
          placeholder="000029"
          style={{display:'block',width:'100%',maxWidth:240,
            boxSizing:'border-box',marginTop:6,padding:11,
            border:'1px solid #cbd5d1',borderRadius:8}}/>
      </label>
      <button className="btn btn-white" type="button"
        style={{marginTop:12}} disabled={duplicateBusy}
        onClick={()=>inspectDuplicateCustomer(false)}>
        <ShieldCheck size={16}/>
        {duplicateBusy?'Consultando...':'Localizar cadastros no Asaas'}
      </button>
      {duplicateMessage&&<p role="status" style={{
        fontSize:12,lineHeight:1.6,marginTop:12,
        color:duplicateNotificationPending?'#9a5013':duplicateLinked?'#17694c':'#785b2f'}}>
        {duplicateMessage}
      </p>}
      {duplicateNotificationPending&&<button type="button" className="btn btn-primary"
        style={{marginTop:12}} onClick={()=>{
          setNotificationOrder(String(duplicateOrder||'').trim().replace(/^EC-/i,'').padStart(6,'0'));
          document.getElementById('asaas-notifications')?.scrollIntoView({behavior:'smooth',block:'start'});
        }}>
        <ShieldCheck size={16}/>Corrigir notificações deste cliente
      </button>}
      {duplicateCandidates.length>0&&<>
        <p style={{fontSize:12,marginTop:12,color:'#53645d'}}>
          {duplicateCandidates.length} cadastro(s) encontrados. Confirme
          qual deles pertence ao cliente antes de continuar.
        </p>
        {duplicateCandidates.map(c=><label key={c.id}
          style={{display:'flex',gap:12,alignItems:'flex-start',
            padding:12,marginTop:8,borderRadius:9,
            border:'1px solid '+(duplicateSelected===c.id?'#0f766e':'#d6e2dc'),
            background:duplicateSelected===c.id?'#edfaf5':'#fff',
            cursor:'pointer'}}>
          <input type="radio" name="asaas-customer-candidate"
            checked={duplicateSelected===c.id} value={c.id}
            onChange={()=>setDuplicateSelected(c.id)}/>
          <span style={{fontSize:13,overflowWrap:'anywhere'}}>
            <strong>{c.name}</strong>
            <span className="muted" style={{display:'block',fontSize:12,marginTop:3}}>
              {c.email_hint} · ID termina em {c.id.slice(-6)}
            </span>
            {c.email_matches&&<span style={{fontSize:11,color:'#17694c',
              display:'block',marginTop:4}}>E-mail confere com cadastro Ever Clean</span>}
            {c.used_in_previous_orders>0&&<span style={{
              fontSize:11,color:'#17694c',display:'block',marginTop:4}}>
              Já usado em {c.used_in_previous_orders} pedido(s) deste cliente
            </span>}
            {duplicateLinked===c.id&&<span style={{
              fontSize:11,color:'#17694c',display:'block',marginTop:4}}>
              Vínculo atualmente cadastrado
            </span>}
          </span>
        </label>)}
        <p className="muted" style={{fontSize:12,lineHeight:1.5,marginTop:12}}>
          O vínculo só é salvo depois da conferência do CPF/CNPJ e da
          configuração de notificações apenas por e-mail.
        </p>
        <button className="btn btn-primary" type="button"
          style={{marginTop:10}} disabled={duplicateBusy||!duplicateSelected}
          onClick={()=>inspectDuplicateCustomer(true)}>
          <ShieldCheck size={16}/>{duplicateLinked===duplicateSelected?
            'Confirmar e sincronizar vínculo':'Vincular cadastro selecionado'}
        </button>
      </>}
    </section>
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
    <h2 style={{fontSize:18}}>8. Homologação controlada — PIX piloto</h2>
    <p style={{fontSize:13,lineHeight:1.6,marginTop:9}}>
      Um único pedido piloto, Álcool 70% 1L (SKU 100388), quantidade 1,
      limite de R$ 7,00. O link é exclusivo, com validade de 7 dias.
      <strong> A liberação não cria cobrança automaticamente. O PIX só é gerado mediante sua confirmação no checkout.</strong>
    </p>
    {error&&<div className="form-error" style={{marginTop:10}}>{error}</div>}
    {pilot?<div style={{padding:13,border:'1px solid #c9e6d6',borderRadius:12,marginTop:12}}>
      <strong style={{color:'#17654e'}}>Link exclusivo preparado</strong>
      <div className="detail-list" style={{marginTop:9}}>
        <div className="detail-item"><span>Cliente do teste</span><strong>{pilot.client_name}</strong></div>
        <div className="detail-item"><span>Solicitação</span><strong>{pilot.request_number}</strong></div>
        <div className="detail-item"><span>Produto / valor máximo</span><strong>{pilot.sku} / R$ 7,00</strong></div>
        <div className="detail-item"><span>Gerar PIX real</span>
          <strong style={{color:pilot.payment_enabled?'#17654e':'#8c5423'}}>
            {pilot.payment_enabled?'Liberado somente para este piloto':'Ainda bloqueado'}
          </strong>
        </div>
      </div>
      <p className="muted" style={{fontSize:11,marginTop:10,overflowWrap:'anywhere'}}>{pilot.link}</p>
      <button className="btn btn-white" style={{marginTop:12}} type="button" onClick={copyLink}>
        <Copy size={15}/> Copiar link de homologação
      </button>
      <p className="muted" style={{fontSize:12,marginTop:10}}>
        Acesso exclusivo do cliente do teste. Apenas um PIX de R$ 7,00 poderá ser solicitado
        mediante confirmação expressa na própria página. Não compartilhar publicamente.
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


// Aviso no Painel quando há cadastros de clientes esperando aprovação.
function PendingSignupsNotice({navigate}){
  const [signups,setSignups]=React.useState(0);
  const [requests,setRequests]=React.useState(0);
  React.useEffect(()=>{
    let alive=true;
    const ask=action=>fetch('/.netlify/functions/customer-portal',{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action})}).then(r=>r.json()).catch(()=>null);
    ask('admin_signups').then(d=>{if(alive&&d?.ok)setSignups((d.signups||[]).filter(x=>x.status==='pending').length);});
    ask('admin_requests').then(d=>{if(alive&&d?.ok)setRequests((d.requests||[])
      .filter(x=>['received','in_review'].includes(x.status)).length);});
    return ()=>{alive=false;};
  },[]);
  const style={width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,
    margin:'0 0 10px',padding:'13px 16px',borderRadius:14,border:'1px solid #f1dcc0',
    background:'#fff8ef',color:'#674d26',fontWeight:800,fontSize:14,cursor:'pointer',textAlign:'left'};
  return <>
    {requests>0&&<button type="button" style={style} onClick={()=>navigate('/admin/pedidos')}>
      <span>{requests===1?'1 solicitação de pedido aguardando análise':requests+' solicitações de pedido aguardando análise'}</span>
      <span style={{whiteSpace:'nowrap'}}>Ver em Pedidos →</span></button>}
    {signups>0&&<button type="button" style={style} onClick={()=>navigate('/admin/clientes')}>
      <span>{signups===1?'1 cadastro de cliente aguardando aprovação':signups+' cadastros de clientes aguardando aprovação'}</span>
      <span style={{whiteSpace:'nowrap'}}>Ver em Clientes →</span></button>}
  </>;
}

function Dashboard({data,reload,navigate}){
  const summary=data.financial_summary;
  const received=data.links.filter(l=>l.status==='enviado').length;
  const visible=data.products.filter(p=>p.catalog_visible!==false&&p.active!==false).length;
  const currentTotal=data.orders.filter(o=>o.status!=='historico').reduce((sum,o)=>sum+Number(o.total_amount||0),0);
  const heroAction=<><button className="btn btn-white" onClick={()=>navigate('/admin/links-pedido')}><Link2 size={16}/>Links de produção</button><button className="btn btn-white" onClick={()=>navigate('/admin/bling')}><ExternalLink size={16}/>Preparar integração Bling</button><button className="btn btn-white" onClick={()=>navigate('/admin/importar')}><DatabaseBackup size={16}/>{summary?'Atualizar backup':'Importar backup Bling'}</button></>;
  return <><Hero eyebrow="CENTRAL EVER CLEAN • PRODUÇÃO" title="Painel Geral" text={summary?'Operação enriquecida com o backup do Bling e dados temporários do Netlify.':'Dados temporários hospedados no Netlify, sem dependência do Supabase.'} onRefresh={reload} action={heroAction}/><PendingSignupsNotice navigate={navigate}/>
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
  async function generate(c){
    if(busy)return;
    setBusy(c.id);
    try{
      const res=await productionLinksApi('prepare',{customer_id:c.id,accept:true});
      if(!res.ok){toast.error(res.message||'Não foi possível gerar link de produção.');return;}
      const url=String(res.link?.url||'');
      if(!isOrderPageUrl(url))
        throw Error('O servidor retornou um link de produção inválido.');
      let copied=false;
      try{await navigator.clipboard.writeText(url);copied=true;}
      catch{}
      toast.success(orderCode(res.link.request_number)+
        (copied?' · Link de produção copiado':' · Link real preparado. Abra a aba Links para copiar.'));
      await reload();
      const phone=String(c.phone||'').replace(/\D/g,'');
      if(phone&&window.confirm('Enviar link de PRODUÇÃO ao cliente por WhatsApp? A cobrança PIX só será criada após a confirmação do comprador.')){
        const number=phone.startsWith('55')?phone:'55'+phone;
        window.open('https://wa.me/'+number+'?text='+encodeURIComponent(
          'Olá! Seu catálogo Ever Clean para reposição está disponível: '+url),'_blank','noopener,noreferrer');
      }
    }catch(error){toast.error(error?.message||'Falha ao gerar link de produção.');}
    finally{setBusy('');}
  }
  return <><Hero eyebrow="CLIENTES • PRODUÇÃO" title="Clientes" text="Cadastre clientes e gere links exclusivos para pagamentos PIX reais. O cliente confirma antes de criar a cobrança." onRefresh={reload} action={<button className="btn btn-white" onClick={()=>setEdit({trade_name:'',legal_name:'',document:'',phone:'',email:'',invoice_email:'',city:'Campo Grande/MS',allow_boleto:false,payment_terms:'',credit_limit:0})}><Plus size={16}/>Novo cliente</button>}/><div className="panel"><div className="panel-head"><div style={{position:'relative'}}><Search size={16} style={{position:'absolute',left:12,top:13,color:'#819096'}}/><input className="search" style={{paddingLeft:36}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente..."/></div></div><div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Última compra</th><th>Histórico</th><th>Pagamento</th><th>Cidade</th><th style={{textAlign:'right'}}>Ações</th></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td><strong>{c.trade_name}</strong><div className="muted" style={{fontSize:11}}>{c.legal_name&&c.legal_name!==c.trade_name?c.legal_name:(c.document||'Guilherme Amaral')}</div></td><td>{c.last_order_at?fmtDate(c.last_order_at):'—'}</td><td><strong>{c.order_count||0} pedidos</strong><div className="muted" style={{fontSize:11}}>{c.historical_revenue!=null?money(c.historical_revenue):'Sem histórico'}</div></td><td><span className={`badge ${c.allow_boleto?'green':'orange'}`}>{c.allow_boleto?'Boleto liberado':'À vista'}</span><div className="muted" style={{fontSize:11,marginTop:4}}>{c.preferred_payment_method==='boleto'?'Preferência: boleto':'Preferência: PIX'}</div></td><td>{c.city||'—'}</td><td><div className="actions"><button className="icon-btn" title="Editar" onClick={()=>setEdit({...c,payment_terms:c.allow_boleto&&!c.payment_terms?'Boleto 30 dias':c.payment_terms})}><Save size={15}/></button><button className="btn btn-primary btn-sm" disabled={busy===c.id} onClick={()=>generate(c)}><Link2 size={14}/>{busy===c.id?'Gerando...':'Gerar link'}</button></div></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">Nenhum cliente encontrado.</div>}</div></div>{edit&&<ClientModal value={edit} setValue={setEdit} onClose={()=>setEdit(null)} onSave={save} saving={busy==='save'}/>}</>;
}

function ClientModal({value,setValue,onClose,onSave,saving}){return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>{value.id?'Editar cliente':'Novo cliente'}</h3><button className="icon-btn" onClick={onClose}><XCircle size={17}/></button></div><div className="modal-body">
  <div className="field"><label>Nome fantasia / identificação</label><input value={value.trade_name||''} onChange={e=>setValue({...value,trade_name:e.target.value})}/></div>
  <div className="field"><label>Razão social / nome</label><input value={value.legal_name||''} onChange={e=>setValue({...value,legal_name:e.target.value})}/></div>
  <div className="product-edit"><div className="field"><label>CPF/CNPJ</label><input value={value.document||''} onChange={e=>setValue({...value,document:e.target.value})}/></div><div className="field"><label>Telefone / WhatsApp</label><input value={value.phone||''} onChange={e=>setValue({...value,phone:e.target.value})}/></div></div>
  <div className="product-edit"><div className="field"><label>E-mail</label><input type="email" value={value.email||''} onChange={e=>setValue({...value,email:e.target.value})}/></div><div className="field"><label>E-mail para NFe</label><input type="email" value={value.invoice_email||''} onChange={e=>setValue({...value,invoice_email:e.target.value})}/></div></div>
  <div style={{borderTop:'1px solid #e3ebe6',marginTop:12,paddingTop:10}}>
    <strong style={{fontSize:13}}>Endereço para nota fiscal</strong>
    <p className="muted" style={{fontSize:11,margin:'2px 0 8px'}}>
      {isCompleteAddress(value.address||addressFromClient(value))?'Completo. É enviado ao cadastro do cliente no Bling.':
        'Necessário para emitir nota. Falta: '+addressIssues(value.address||addressFromClient(value)).join(', ')+'.'}
    </p>
    <AddressFields value={value.address||addressFromClient(value)}
      onChange={address=>setValue({...value,address,
        city:[address.city,address.uf].filter(Boolean).join('/')||value.city})}/>
    <div className="field"><label>Inscrição estadual (opcional)</label>
      <input value={value.state_registration||''} placeholder="Vazio = não contribuinte · ISENTO · ou o número"
        onChange={e=>setValue({...value,state_registration:e.target.value})}/></div>
  </div>
  <div className="product-edit"><div className="field"><label>Condição de pagamento</label><input value={value.payment_terms||''} onChange={e=>setValue({...value,payment_terms:e.target.value})} placeholder="Ex.: 14 dias, 28 dias..."/></div><div className="field"><label>Limite de crédito</label><input type="number" min="0" step="0.01" value={value.credit_limit??0} onChange={e=>setValue({...value,credit_limit:e.target.value})}/></div></div>
  <label className="switch" style={{marginTop:10}}><input type="checkbox" checked={Boolean(value.allow_boleto)}
    onChange={e=>{
      const enabled=e.target.checked;
      const daysMatch=String(value.payment_terms||'').match(/(?:^|\b)(\d{1,2})\s*dias?\b/i);
      const days=daysMatch?Number(daysMatch[1]):30;
      setValue({...value,allow_boleto:enabled,
        preferred_payment_method:enabled?'boleto':'pix',
        payment_terms:enabled?'Boleto '+days+' dias':'À vista',
        payment_methods:enabled?['pix','boleto']:['pix']});
    }}/> Liberar boleto / compra a prazo (padrão: 30 dias)</label>
  {value.allow_boleto&&<p className="muted" style={{marginTop:8,fontSize:12}}>
    Boleto com vencimento em 30 dias, salvo se houver prazo diferente no campo acima.
    O limite de crédito personalizado é opcional. Sem limite definido, aplica-se o
    teto de segurança do catálogo para pedidos em aberto.
  </p>}
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

function Orders({data,reload,navigate}){
  const count=(data.orders||[]).length;
  return <>
    <Hero eyebrow="PEDIDOS • EVER CLEAN" title="Pedidos"
      text="Acompanhe as vendas reais, o Asaas e a integração com o Bling."
      onRefresh={reload}/>
    <div className="panel" style={{padding:16,marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        flexWrap:'wrap',gap:12,minWidth:0}}>
        <div style={{flex:'1 1 190px',minWidth:0}}>
          <strong style={{fontSize:17}}>Histórico de pedidos</strong>
          <p className="muted" style={{fontSize:13,marginTop:6}}>
            {count} pedidos preservados. O histórico foi separado desta página
            para facilitar o acesso ao painel de pagamentos e automações.
          </p>
        </div>
        <button type="button" className="btn btn-white"
          style={{width:'100%',maxWidth:280,minWidth:0,whiteSpace:'normal',
            justifyContent:'center',boxSizing:'border-box'}}
          onClick={()=>navigate('/admin/historico-pedidos')}>
          <ClipboardList size={17}/>Consultar histórico
        </button>
      </div>
    </div>
    <CustomerOrderRequestsPanel/>
    <ProductionOrdersPanel/>
  </>;
}

function OrdersHistory({data,reload,navigate}){
  const [search,setSearch]=React.useState('');
  const [pageSize,setPageSize]=React.useState(25);
  const [page,setPage]=React.useState(1);
  const [expanded,setExpanded]=React.useState(true);
  const listRef=React.useRef(null);
  const rows=React.useMemo(()=>[...(data.orders||[])]
    .filter(o=>`${o.order_number||''} ${o.customer_name||''}`.toLowerCase()
      .includes(search.trim().toLowerCase()))
    .sort((a,b)=>{
      const aDate=Date.parse(a.created_at||'')||0;
      const bDate=Date.parse(b.created_at||'')||0;
      return bDate-aDate;
    }),[data.orders,search]);
  const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));
  const currentPage=Math.min(page,pageCount);
  const from=(currentPage-1)*pageSize;
  const visibleRows=rows.slice(from,from+pageSize);
  const navigateToPage=nextPage=>{
    setPage(Math.min(pageCount,Math.max(1,nextPage)));
    listRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  const paging=(position)=><div style={{padding:'12px 16px',display:'flex',
    flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',
    gap:10,borderTop:position==='bottom'?'1px solid #e4ebe9':undefined,
    borderBottom:position==='top'?'1px solid #e4ebe9':undefined}}>
    <span style={{fontSize:12,color:'#61716e'}}>
      {rows.length?`Pedidos ${from+1}–${Math.min(from+pageSize,rows.length)} de ${rows.length}`:'0 pedidos'}
    </span>
    <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,maxWidth:'100%'}}>
      {position==='top'&&<>
        <label htmlFor="orders-page-size" style={{fontSize:12,color:'#61716e'}}>
          Por página
        </label>
        <select id="orders-page-size" aria-label="Pedidos por página" value={pageSize}
          onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}
          style={{fontSize:13,padding:'8px 7px',border:'1px solid #d5e1de',
            borderRadius:8,background:'#fff',maxWidth:'100%'}}>
          {[10,25,50].map(n=><option key={n} value={n}>{n}</option>)}
        </select>
      </>}
      <button type="button" className="btn btn-white btn-sm"
        disabled={currentPage===1} onClick={()=>navigateToPage(currentPage-1)}>
        Anterior
      </button>
      <span style={{fontSize:12,whiteSpace:'nowrap',color:'#415952'}}>
        {currentPage} / {pageCount}
      </span>
      <button type="button" className="btn btn-white btn-sm"
        disabled={currentPage>=pageCount} onClick={()=>navigateToPage(currentPage+1)}>
        Próxima
      </button>
    </div>
  </div>;
  return <>
    <Hero eyebrow="HISTÓRICO DE PEDIDOS" title="Histórico de pedidos"
      text="Consulte os pedidos antigos em páginas de até 50 registros."
      onRefresh={reload}
      action={<button type="button" className="btn btn-white"
        onClick={()=>navigate('/admin/pedidos')}>Voltar aos pedidos reais</button>}/>
    <div className="panel" ref={listRef}>
      <div className="panel-head" style={{display:'flex',flexWrap:'wrap',
        alignItems:'center',gap:10,justifyContent:'space-between'}}>
        <div style={{minWidth:0,flex:'1 1 180px'}}>
          <h2 style={{fontSize:17,margin:0}}>Histórico de pedidos</h2>
          <p className="muted" style={{fontSize:12,marginTop:5}}>
            {data.orders?.length||0} pedidos no histórico · no máximo 50 por bloco
          </p>
        </div>
        <button type="button" className="btn btn-white btn-sm"
          aria-expanded={expanded} aria-controls="everclean-historico-pedidos"
          onClick={()=>setExpanded(v=>!v)}
          style={{whiteSpace:'normal',minWidth:0,maxWidth:'100%',textAlign:'center'}}>
          {expanded?'Ocultar histórico':'Exibir pedidos'}
        </button>
      </div>
      {expanded&&<div id="everclean-historico-pedidos">
      <div style={{padding:'8px 16px',display:'flex',gap:9,alignItems:'center',
        flexWrap:'wrap',borderTop:'1px solid #e4ebe9'}}>
        <input className="search" style={{flex:'1 1 190px',minWidth:0,maxWidth:'100%'}}
          value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}
          placeholder="Buscar pedido ou cliente..."/>
        <span style={{fontSize:12,color:'#61716e'}}>Lista com rolagem própria</span>
      </div>
      {paging('top')}
      <div className="table-wrap" style={{maxHeight:460,overflowY:'auto',
        overscrollBehavior:'contain',WebkitOverflowScrolling:'touch'}}>
        <table className="table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th>
            <th>Valor conhecido</th><th>Status</th></tr></thead>
          <tbody>{visibleRows.map(o=><tr key={o.id}>
            <td><strong>{o.order_number||'—'}</strong></td>
            <td>{o.customer_name||'—'}</td>
            <td>{fmtDate(o.created_at)}</td>
            <td>{money(o.total_amount||0)}</td>
            <td><Status value={o.status}/>
              {o.fulfillment_requires_review&&<div style={{fontSize:11,
                fontWeight:700,color:'#a86d20',marginTop:5}}>
                Sob encomenda — conferir estoque
              </div>}
            </td>
          </tr>)}</tbody>
        </table>
        {!rows.length&&<div className="empty">Nenhum pedido encontrado.</div>}
      </div>
      {paging('bottom')}
      </div>}
    </div>
  </>;
}

function CustomerOrderRequestsPanel(){
  const [reviewId,setReviewId]=React.useState(null);
  const [reviewNote,setReviewNote]=React.useState('');
  const [stockChecked,setStockChecked]=React.useState(false);
  const [pricesChecked,setPricesChecked]=React.useState(false);
  const [reviewBusy,setReviewBusy]=React.useState(false);
  const [reviewError,setReviewError]=React.useState('');
  const [rows,setRows]=React.useState([]);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [page,setPage]=React.useState(1);
  const [filter,setFilter]=React.useState('all');
  const load=React.useCallback(async()=>{
    setBusy(true);setError('');
    try{
      const response=await fetch('/.netlify/functions/customer-portal',{
        method:'POST',
        headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'admin_requests'})
      });
      const result=await response.json().catch(()=>({ok:false}));
      if(!response.ok||result.ok!==true)
        throw Error(result.message||'Não foi possível consultar solicitações.');
      setRows(Array.isArray(result.requests)?result.requests:[]);
    }catch(e){setError(e.message)}
    finally{setBusy(false)}
  },[]);
  React.useEffect(()=>{void load()},[load]);
  function openReview(request){
    setReviewId(request.id);
    setReviewNote(request.review_note||'');
    setStockChecked(false);setPricesChecked(false);setReviewError('');
  }
  async function reviewRequest(request,next){
    if(reviewBusy)return;
    if(next==='quoted'&&(!stockChecked||!pricesChecked)){
      setReviewError('Confirme o estoque/prazo e os preços antes de aprovar.');return;
    }
    if(next==='rejected'&&reviewNote.trim().length<5){
      setReviewError('Informe o motivo da recusa (mínimo 5 caracteres).');return;
    }
    const number=request.request_number;
    const label=next==='quoted'?'APROVAR':next==='rejected'?'RECUSAR':'INICIAR ANÁLISE DE';
    if(!window.confirm(label+' a solicitação '+number+'?\n'+
      'A operação atualiza apenas o status comercial. NÃO cria PIX, venda no Bling ou NF-e.'))return;
    setReviewBusy(true);setReviewError('');
    try{
      const response=await fetch('/.netlify/functions/customer-portal',{
        method:'POST',
        headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'admin_review_request',id:request.id,
          expected_status:request.status,status:next,
          review_note:reviewNote.trim(),stock_checked:stockChecked,
          prices_checked:pricesChecked,approve_confirm:next==='quoted'})
      });
      const result=await response.json().catch(()=>({ok:false}));
      if(!response.ok||result.ok!==true)
        throw Error(result.message||'Não foi possível registrar a análise.');
      toast.success(result.message||'Solicitação atualizada.');
      setReviewId(null);
      await load();
    }catch(error){setReviewError(error.message||'Falha ao salvar a decisão.');}
    finally{setReviewBusy(false);}
  }
  // Solicitação que virou pedido aparece só como pedido (evita duplicidade).
  const turned=rows.filter(row=>row.checkout_order===true||row.checkout_paid===true);
  const openRows=rows.filter(row=>!turned.includes(row));
  const filtered=openRows.filter(row=>filter==='all'||
    (filter==='quoted'?row.status==='quoted':row.status===filter));
  const pages=Math.max(1,Math.ceil(filtered.length/10));
  const currentPage=Math.min(page,pages);
  const visible=filtered.slice((currentPage-1)*10,currentPage*10);
  const newCount=rows.filter(row=>row.status==='received').length;
  const statusName={received:'Recebida · aguarda análise',
    in_review:'Em análise',quoted:'Aprovada · aguardando atendimento',
    rejected:'Não aprovada',completed:'Concluída'};
  return <section className="panel" style={{marginBottom:16}}>
    <div className="panel-head" style={{display:'flex',gap:9,alignItems:'center',
      justifyContent:'space-between',flexWrap:'wrap'}}>
      <div>
        <h2 style={{fontSize:18,margin:0}}>Solicitações recebidas pelo portal</h2>
        <p className="muted" style={{fontSize:12,marginTop:6}}>
          {newCount} aguardando análise · {openRows.length} em aberto
          {turned.length>0&&' · '+turned.length+' já viraram pedido (estão na lista de pedidos)'}
        </p>
      </div>
      <button type="button" className="btn btn-white btn-sm"
        disabled={busy} onClick={load}><RefreshCw size={15}/>
        {busy?'Consultando...':'Atualizar'}
      </button>
    </div>
    <div style={{padding:'12px 15px 14px'}}>
      <p className="muted" style={{fontSize:12,lineHeight:1.6}}>
        Solicitações em análise não são vendas. Quando a solicitação vira pedido,
        ela sai daqui e passa a ser acompanhada na lista de pedidos abaixo.
        Esta lista não cria PIX, vendas no Bling ou notas fiscais.
      </p>
      <label style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',
        fontSize:12,marginTop:11}}>
        Situação
        <select aria-label="Filtrar solicitações do portal" value={filter}
          onChange={e=>{setFilter(e.target.value);setPage(1)}}
          style={{padding:'9px 12px',borderRadius:9,border:'1px solid #d6e4dc'}}>
          <option value="all">Todas as solicitações</option>
          <option value="received">Aguardando análise</option>
          <option value="in_review">Em análise</option>
          <option value="quoted">Aprovadas · aguardando pagamento</option>
          <option value="completed">Concluídas</option>
          <option value="rejected">Não aprovadas</option>
        </select>
      </label>
      {error&&<p role="alert" style={{color:'#ac432c',fontSize:13,marginTop:10}}>
        {error}
      </p>}
      <div style={{display:'grid',gap:9,marginTop:12}}>
        {visible.map(request=><article key={request.id}
          style={{padding:13,border:'1px solid #dce6df',borderRadius:11}}>
          <div style={{display:'flex',flexWrap:'wrap',gap:9,
            justifyContent:'space-between'}}>
            <div style={{minWidth:0,flex:'1 1 175px'}}>
              <strong>{request.request_number}</strong>
              <div style={{fontSize:12,marginTop:4,overflowWrap:'anywhere'}}>
                {request.customer_name}
              </div>
              <div className="muted" style={{fontSize:11,marginTop:3}}>
                {fmtDate(request.created_at)}
              </div>
            </div>
            <div style={{textAlign:'right'}}>
              <strong>{money(request.amount)}</strong>
              <div style={{fontSize:12,
                color:request.checkout_paid?'#17694c':'#8a6029',marginTop:4}}>
                {request.checkout_paid?
                  'Pagamento confirmado · EC-'+request.checkout_number:
                  request.approval_source==='automatic_stock'&&request.status==='quoted'?
                    'Estoque disponível · aguardando PIX':
                    statusName[request.status]||request.status}
              </div>
              {request.checkout_paid&&<div style={{
                fontSize:11,color:'#17694c',marginTop:4}}>
                {request.checkout_bling_registered?'Registrado no Bling':
                  'Registro no Bling pendente'}
              </div>}
            </div>
          </div>
          <div style={{fontSize:12,marginTop:9}}>
            {(request.items||[]).map((item,index)=><div key={index}
              style={{padding:'4px 0',overflowWrap:'anywhere'}}>
              {item.quantity} × {item.name} · {money(item.quantity*item.unit_price_cents/100)}
            </div>)}
          </div>
          {request.requires_stock_review&&<p style={{fontSize:12,color:'#92601c',
            marginTop:8}}>Atenção: existem produtos sob encomenda.</p>}
          {request.notes&&<p style={{fontSize:12,marginTop:8,whiteSpace:'pre-wrap',
            overflowWrap:'anywhere'}}>Observações: {request.notes}</p>}
          {request.invoice_requested&&<p style={{fontSize:12,marginTop:6}}>
            Solicitação de nota fiscal: {request.invoice_channel} · {request.invoice_contact}
          </p>}
          {request.review_note&&<p style={{fontSize:12,marginTop:7,
            background:'#f5f9f6',padding:8,borderRadius:8,overflowWrap:'anywhere'}}>
            Mensagem ao cliente: {request.review_note}
          </p>}
          {['received','in_review'].includes(request.status)&&
            <div style={{borderTop:'1px solid #e1ece4',marginTop:13,paddingTop:12}}>
              {reviewId===request.id?<>
                <strong style={{fontSize:13}}>Analisar solicitação {request.request_number}</strong>
                <p className="muted" style={{fontSize:12,lineHeight:1.5,marginTop:5}}>
                  A aprovação é comercial. Nenhum PIX, pedido no Bling ou
                  nota fiscal será gerado automaticamente.
                </p>
                <label style={{display:'flex',alignItems:'flex-start',gap:8,
                  fontSize:12,marginTop:11}}>
                  <input type="checkbox" checked={stockChecked}
                    onChange={e=>setStockChecked(e.target.checked)}/>
                  Conferi disponibilidade e prazo, inclusive itens sob encomenda.
                </label>
                <label style={{display:'flex',alignItems:'flex-start',gap:8,
                  fontSize:12,marginTop:9}}>
                  <input type="checkbox" checked={pricesChecked}
                    onChange={e=>setPricesChecked(e.target.checked)}/>
                  Conferi produtos, quantidades e preços da solicitação.
                </label>
                <label style={{fontSize:12,fontWeight:600,
                  display:'block',marginTop:11}}>
                  Observação visível ao cliente
                  <textarea rows={2} maxLength={240} value={reviewNote}
                    onChange={e=>setReviewNote(e.target.value)}
                    placeholder="Prazo estimado ou motivo de eventual recusa..."
                    style={{display:'block',width:'100%',boxSizing:'border-box',
                      padding:10,marginTop:5,borderRadius:9,
                      border:'1px solid #cadcd2'}}/>
                </label>
                {reviewError&&<p role="alert"
                  style={{fontSize:12,color:'#a44330',marginTop:8}}>
                  {reviewError}
                </p>}
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
                  <button className="btn btn-primary btn-sm" type="button"
                    disabled={reviewBusy||!stockChecked||!pricesChecked}
                    onClick={()=>reviewRequest(request,'quoted')}>
                    {reviewBusy?'Salvando...':'Aprovar solicitação'}
                  </button>
                  <button className="btn btn-white btn-sm" type="button"
                    disabled={reviewBusy||reviewNote.trim().length<5}
                    onClick={()=>reviewRequest(request,'rejected')}>
                    Recusar
                  </button>
                  {request.status==='received'&&
                    <button className="btn btn-white btn-sm" type="button"
                      disabled={reviewBusy}
                      onClick={()=>reviewRequest(request,'in_review')}>
                      Marcar em análise
                    </button>}
                  <button className="btn btn-white btn-sm" type="button"
                    disabled={reviewBusy} onClick={()=>setReviewId(null)}>
                    Cancelar
                  </button>
                </div>
              </>:<button className="btn btn-primary btn-sm"
                type="button" onClick={()=>openReview(request)}>
                Analisar / Aprovar
              </button>}
            </div>}
        </article>)}
        {!visible.length&&!busy&&
          <p className="muted" style={{fontSize:13,marginTop:10}}>
            Nenhuma solicitação corresponde ao filtro.
          </p>}
      </div>
      {pages>1&&<div style={{display:'flex',justifyContent:'space-between',
        flexWrap:'wrap',alignItems:'center',gap:8,marginTop:12}}>
        <button className="btn btn-white btn-sm" type="button"
          disabled={currentPage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>
          Anterior
        </button>
        <span style={{fontSize:12}}>Página {currentPage} de {pages}</span>
        <button className="btn btn-white btn-sm" type="button"
          disabled={currentPage>=pages} onClick={()=>setPage(p=>Math.min(pages,p+1))}>
          Próxima
        </button>
      </div>}
    </div>
  </section>;
}

// Pedido em operação: pago, ou boleto a prazo liberado (cliente autorizado).
const isLive=o=>o?.status==='paid'||o?.released===true;
function ProductionOrdersPanel(){
  const FULFILLMENT_STAGES=FULFILLMENT_LABELS;
  // Ordem dos botões de etapa no admin.
  const FULFILLMENT_ORDER=['received','preparing','ready_for_delivery','out_for_delivery',
    'delivered','on_hold'];
  const nextStageFor=stage=>({received:'ready_for_delivery',preparing:'ready_for_delivery',
    ready_for_delivery:'out_for_delivery',out_for_delivery:'delivered',on_hold:'ready_for_delivery',
    delivered:'delivered'})[normalizeStage(stage)];
  const [fulfillmentHistory,setFulfillmentHistory]=React.useState({});
  const [fulfillmentEditing,setFulfillmentEditing]=React.useState(null);
  const [fulfillmentSelected,setFulfillmentSelected]=React.useState('');
  const [fulfillmentNote,setFulfillmentNote]=React.useState('');
  const [fulfillmentBusy,setFulfillmentBusy]=React.useState(false);
  const [fulfillmentError,setFulfillmentError]=React.useState('');
  const [rows,setRows]=React.useState([]);
  const [loading,setLoading]=React.useState(false);
  const [error,setError]=React.useState('');
  const [blingAudit,setBlingAudit]=React.useState(null);
  const [blingAuditError,setBlingAuditError]=React.useState('');
  const [auditing,setAuditing]=React.useState(false);
  const [exportRecord,setExportRecord]=React.useState(null);
  const [exportChecked,setExportChecked]=React.useState(false);
  const [sending,setSending]=React.useState(false);
  const [exportError,setExportError]=React.useState('');
  const fetchExportStatus=React.useCallback(async()=>{
    const response=await fetch('/.netlify/functions/bling-production-order-send',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action:'status'})
    });
    const body=await response.json().catch(()=>({ok:false}));
    if(response.ok&&body.ok)setExportRecord(body.export_record||null);
  },[]);
  async function sendControlled(){
    if(!exportChecked||!blingAudit?.approved||
      (exportRecord&&exportRecord.state!=='retry_liberado')||sending)return;
    if(!window.confirm('Enviar UMA única venda HOMOLOG-01, de R$ 7,00, para o Bling? A integração não lançará estoque, contas ou NF-e.'))return;
    setSending(true);setExportError('');
    try{
      const response=await fetch('/.netlify/functions/bling-production-order-send',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'send',accepted:true,
          confirm_phrase:'AUTORIZO ENVIAR HOMOLOG-01 AO BLING'})
      });
      const body=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      setExportRecord(body.export_record||null);
      setExportChecked(false);
      if(!response.ok||!body.ok)throw Error(body.message||'Envio inconclusivo. Não repetir.');
      toast.success('HOMOLOG-01 registrado no Bling. Conferir estoque e NF-e manualmente.');
      setBlingAudit(null);
    }catch(err){setExportError(err?.message||'Resultado inconclusivo. Não repetir envio.');}
    finally{setSending(false);}
  }
  async function reconcileControlled(){
    setSending(true);setExportError('');
    try{
      const response=await fetch('/.netlify/functions/bling-production-order-send',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'reconcile'})
      });
      const body=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(body.export_record)setExportRecord(body.export_record);
      if(!response.ok||!body.ok)throw Error(body.message||'Conferência não concluída.');
      toast.success(body.message||'Consulta Bling concluída sem novo pedido.');
    }catch(err){setExportError(err.message||'Não foi possível consultar o Bling.');}
    finally{setSending(false);}
  }
  async function inspectBling(){
    setAuditing(true);setBlingAuditError('');
    try{
      const response=await fetch('/.netlify/functions/bling-production-order-audit',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'audit'})
      });
      const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!data?.ok)throw Error(data.message||'Não foi possível consultar o Bling.');
      setBlingAudit(data);
      await fetchExportStatus();
      toast.success('Conferência Neon → Bling concluída sem criar pedidos.');
    }catch(err){setBlingAuditError(err?.message||'Falha na conferência.');}
    finally{setAuditing(false);}
  }
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
  React.useEffect(()=>{load();fetchExportStatus().catch(()=>{});},[load,fetchExportStatus]);
  const [invoiceBusy,setInvoiceBusy]=React.useState('');
  async function invoiceCall(action,order){
    setInvoiceBusy(order.request_number);
    try{
      const response=await fetch('/.netlify/functions/asaas-production-orders',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action,request_number:order.request_number})
      });
      const data=await response.json().catch(()=>({ok:false}));
      if(!response.ok||!data?.ok)throw Error(data.message||'Falha ao consultar a nota.');
      if(action==='invoice_refresh'){
        setRows(list=>list.map(row=>row.request_number===order.request_number?
          {...row,invoice:{...(row.invoice||{}),...data.invoice,checked_at:new Date().toISOString()}}:row));
        toast.success(data.invoice?.status==='authorized'?
          'Nota nº '+data.invoice.number+' disponível para o cliente.':
          data.invoice?.status==='none'?'O pedido ainda não tem nota no Bling.':
          'Situação da nota: '+(data.invoice?.bling_status_label||data.invoice?.status));
      }else{
        setRows(list=>list.map(row=>row.request_number===order.request_number?
          {...row,invoice:{...row.invoice,shared_at:data.shared_at}}:row));
      }
    }catch(err){toast.error(err.message||'Falha ao consultar a nota.');}
    finally{setInvoiceBusy('');}
  }
  function invoiceMessage(order){
    return 'Olá! A nota fiscal nº '+(order.invoice?.number||'')+' do seu pedido EC-'+
      order.request_number+' da Ever Clean está disponível. Baixe o PDF e o XML em: '+order.order_url;
  }
  function whatsappHref(order){
    const raw=String(order.invoice_channel==='whatsapp'&&order.invoice_contact?
      order.invoice_contact:order.customer_phone||'').replace(/\D/g,'');
    const phone=raw.length>=10&&raw.length<=11?'55'+raw:raw;
    return 'https://wa.me/'+(phone.length>=12?phone:'')+'?text='+encodeURIComponent(invoiceMessage(order));
  }
  async function fulfillmentCall(body){
    const response=await fetch('/.netlify/functions/order-fulfillment',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify(body)
    });
    const result=await response.json().catch(()=>({ok:false}));
    if(!response.ok||result.ok!==true)throw Error(result.message||'Falha no acompanhamento.');
    return result;
  }
  async function loadFulfillmentHistory(number){
    try{
      const result=await fulfillmentCall({action:'history',request_number:number});
      setFulfillmentHistory(h=>({...h,[number]:result.events||[]}));
    }catch(error){setFulfillmentError(error.message);}
  }
  // Publica a movimentação (etapa e/ou comentário) que o cliente vê no pedido.
  async function updateFulfillment(order){
    if(fulfillmentBusy||fulfillmentEditing!==order.request_number)return;
    const current=normalizeStage(order.fulfillment_stage);
    if(fulfillmentSelected===current&&!fulfillmentNote.trim()){
      setFulfillmentError('Escreva um comentário ou escolha outra etapa.');return;
    }
    setFulfillmentBusy(true);setFulfillmentError('');
    try{
      const result=await fulfillmentCall({action:'update',request_number:order.request_number,
        expected_stage:current,stage:fulfillmentSelected,public_note:fulfillmentNote});
      toast.success(result.message||'Atualização publicada para o cliente.');
      setFulfillmentNote('');
      await load();
      await loadFulfillmentHistory(order.request_number);
      setFulfillmentSelected(nextStageFor(fulfillmentSelected));
    }catch(error){setFulfillmentError(error.message||'Falha na atualização.');}
    finally{setFulfillmentBusy(false);}
  }
  function openFulfillment(order){
    setFulfillmentEditing(order.request_number);
    setFulfillmentSelected(nextStageFor(order.fulfillment_stage));
    setFulfillmentNote('');
    setFulfillmentError('');
    loadFulfillmentHistory(order.request_number);
  }

  // Acompanhamento logístico manual: limitado a pedidos pagos e conciliados no Bling.
  const [productionFilter,setProductionFilter]=React.useState('todos');
  const [productionSearch,setProductionSearch]=React.useState('');
  const [productionPage,setProductionPage]=React.useState(1);
  const paidOrders=rows.filter(o=>isLive(o));
  const receivedOrders=rows.filter(o=>o.status==='paid');
  const pendingBling=paidOrders.filter(o=>!o.bling_export_confirmed);
  const reviewStock=paidOrders.filter(o=>o.requires_stock_review);
  const inDelivery=paidOrders.filter(o=>['preparing','ready_for_delivery',
    'out_for_delivery'].includes(normalizeStage(o.fulfillment_stage)));
  const awaitingPix=rows.filter(o=>o.status==='payment_pending');
  const paidTotal=receivedOrders.reduce((total,o)=>total+Number(o.amount||0),0);
  const filteredProductionOrders=rows.filter(o=>{
    if(productionFilter==='paid'&&!isLive(o))return false;
    if(productionFilter==='stock'&&!(isLive(o)&&o.requires_stock_review))return false;
    if(productionFilter==='bling'&&!(isLive(o)&&!o.bling_export_confirmed))return false;
    if(productionFilter==='payment'&&o.status!=='payment_pending')return false;
    if(productionFilter==='fulfillment'&&!(isLive(o)&&
      normalizeStage(o.fulfillment_stage)!=='delivered'))return false;
    if(productionFilter==='delivered'&&normalizeStage(o.fulfillment_stage)!=='delivered')return false;
    const query=productionSearch.trim().toLocaleLowerCase('pt-BR');
    if(!query)return true;
    return [o.request_number,o.customer_name,o.bling_order_number,o.bling_order_id]
      .some(value=>String(value||'').toLocaleLowerCase('pt-BR').includes(query));
  }).sort((a,b)=>{
    // Pedidos pagos com ação operacional pendente no topo; demais por data.
    const priority=o=>isLive(o)&&!o.bling_export_confirmed?0:
      isLive(o)&&o.requires_stock_review?1:
      o.status==='payment_pending'?2:isLive(o)?3:4;
    return priority(a)-priority(b)||
      new Date(b.created_at).getTime()-new Date(a.created_at).getTime();
  });
  const productionPageCount=Math.max(1,Math.ceil(filteredProductionOrders.length/10));
  const currentProductionPage=Math.min(productionPage,productionPageCount);
  const visibleProductionOrders=filteredProductionOrders.slice(
    (currentProductionPage-1)*10,currentProductionPage*10);
  return <section className="panel" style={{marginTop:16}}>
    <div className="panel-head">
      <div>
        <h2>Pedidos e acompanhamento</h2>
        <p className="muted" style={{fontSize:12,marginTop:6}}>
          Pagamentos e Bling conciliados automaticamente. Separação e entrega são atualizadas manualmente. A nota fiscal é emitida no Bling e aparece aqui e para o cliente em até 10 minutos.
        </p>
      </div>
      <button className="btn btn-white btn-sm" onClick={load} disabled={loading}>
        <RefreshCw size={15}/>{loading?'Consultando...':'Atualizar'}
      </button>
    </div>
    {error&&<p className="form-error" style={{margin:14}}>{error}</p>}
    <div style={{padding:'12px 14px',borderTop:'1px solid #e4ece8'}}>
      <div style={{display:'grid',
        gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,140px),1fr))',gap:8}}>
        {[
          {label:'Pedidos pagos',value:receivedOrders.length,description:money(paidTotal)+
            (paidOrders.length>receivedOrders.length?' · +'+(paidOrders.length-receivedOrders.length)+' a prazo':'')},
          {label:'Revisar estoque',value:reviewStock.length,description:'Separação manual'},
          {label:'Pendentes no Bling',value:pendingBling.length,description:'Conferir integração'},
          {label:'Aguardando PIX',value:awaitingPix.length,description:'Ainda não recebidos'},
          {label:'Em atendimento',value:inDelivery.length,description:'Separação e entrega'}
        ].map(metric=><div key={metric.label} style={{padding:11,borderRadius:10,
          border:'1px solid #dbe7e1',background:'#f8faf9',minWidth:0}}>
          <div style={{fontSize:11,color:'#596d65'}}>{metric.label}</div>
          <strong style={{display:'block',fontSize:22,marginTop:4,color:'#194e3e'}}>
            {metric.value}
          </strong>
          <div style={{fontSize:11,color:'#64736e',marginTop:3}}>{metric.description}</div>
        </div>)}
      </div>
      <p className="muted" style={{fontSize:11,marginTop:9,lineHeight:1.5}}>
        Resumo dos {rows.length} pedidos consultados. A revisão de estoque é apenas um
        alerta operacional: não representa baixa ou confirmação de entrega.
      </p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,190px),1fr))',
        gap:9,marginTop:12}}>
        <input type="search" aria-label="Buscar pedido de produção"
          placeholder="Buscar pedido ou cliente" value={productionSearch}
          onChange={e=>{setProductionSearch(e.target.value);setProductionPage(1);}}
          style={{width:'100%',boxSizing:'border-box',minWidth:0,padding:10,
            border:'1px solid #d6e1dc',borderRadius:9}}/>
        <select aria-label="Filtrar pedidos de produção" value={productionFilter}
          onChange={e=>{setProductionFilter(e.target.value);setProductionPage(1);}}
          style={{width:'100%',boxSizing:'border-box',minWidth:0,padding:10,
            border:'1px solid #d6e1dc',borderRadius:9}}>
          <option value="todos">Todos os pedidos</option>
          <option value="paid">Pagos ou liberados (boleto a prazo)</option>
          <option value="stock">Revisar estoque</option>
          <option value="bling">Pendentes no Bling</option>
          <option value="payment">Aguardando PIX</option>
          <option value="fulfillment">Em atendimento / aguardando</option>
          <option value="delivered">Entregues</option>
        </select>
      </div>
      <p className="muted" style={{fontSize:12,marginTop:10}}>
        {filteredProductionOrders.length} pedido(s) encontrado(s) ·
        até 10 por página · prioridade para pendências operacionais
      </p>
      <div style={{display:'grid',gap:9,marginTop:12}}>
        {visibleProductionOrders.map((o,i)=><div key={o.request_number+'-'+i}
          style={{border:'1px solid #dce6e1',borderRadius:11,padding:12,
            background:'#fff',minWidth:0}}>
          <div style={{display:'flex',flexWrap:'wrap',alignItems:'flex-start',
            justifyContent:'space-between',gap:8}}>
            <div style={{flex:'1 1 180px',minWidth:0}}>
              <strong style={{fontSize:14}}>{orderCode(o.request_number)}</strong>
              <div className="muted" style={{fontSize:11,marginTop:3}}>
                {fmtDate(o.created_at)}
              </div>
              <div style={{fontSize:13,marginTop:5,overflowWrap:'anywhere'}}>
                {o.customer_name}
              </div>
            </div>
            <div style={{textAlign:'right'}}>
              <strong style={{fontSize:15}}>{money(o.amount)}</strong>
              <div style={{marginTop:5}}><Status value={o.status}/></div>
              {o.released&&<div style={{marginTop:4}}><span className="badge green"
                title="Cliente autorizado a boleto a prazo: pedido liberado para separação, Bling e nota fiscal.">
                Liberado · boleto a prazo{o.payment_due_date?' · vence '+
                  String(o.payment_due_date).slice(0,10).split('-').reverse().join('/'):''}</span></div>}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:
            'repeat(auto-fit,minmax(min(100%,170px),1fr))',gap:9,
            borderTop:'1px solid #ebf0ed',marginTop:11,paddingTop:10}}>
            <div style={{minWidth:0}}>
              <div className="muted" style={{fontSize:11}}>Bling</div>
              <strong style={{fontSize:12,color:o.bling_export_confirmed?'#17654e':'#946020'}}>
                {!isLive(o)?'Após pagamento':
                  o.bling_export_confirmed?'Registrado':
                  ['blocked','inconclusive','manual_review'].includes(o.bling_export_state)?
                    'Conferência necessária':
                  o.bling_export_state==='sending'?'Em processamento':
                  o.bling_issue?'Pendente de ajuste':'Aguardando integração'}
              </strong>
              {isLive(o)&&!o.bling_export_confirmed&&o.bling_issue?.issues?.length>0&&
                <div style={{fontSize:11,color:'#9c3d2e',overflowWrap:'anywhere',marginTop:2}}>
                  {o.bling_issue.issues.join(' ')}
                  <span className="muted"> · nova tentativa automática a cada 5 min</span>
                </div>}
              {o.bling_export_confirmed&&
                <div className="muted" style={{fontSize:11,overflowWrap:'anywhere'}}>
                  {o.bling_order_number?'Pedido nº '+o.bling_order_number:
                    'ID '+o.bling_order_id}
                </div>}
            </div>
            <div style={{minWidth:0}}>
              <div className="muted" style={{fontSize:11}}>PDF do cliente</div>
              <strong style={{fontSize:12,color:o.customer_pdf_ready?'#17654e':'#946020'}}>
                {o.customer_pdf_ready?'Disponível no link':
                  !isLive(o)?'Após pagamento':
                  o.bling_export_confirmed?'Prazo encerrado':'Aguardando Bling'}
              </strong>
            </div>
            <div style={{minWidth:0}}>
              <div className="muted" style={{fontSize:11}}>Nota fiscal</div>
              {(()=>{
                const inv=o.invoice;
                const color=inv?.status==='authorized'?'#17654e':inv?.status==='problem'?'#9c3d2e':'#946020';
                return <>
                  <strong style={{fontSize:12,color}}>
                    {!isLive(o)?'Após pagamento':
                      !o.bling_export_confirmed?'Após registro no Bling':
                      inv?.status==='authorized'?'Nº '+(inv.number||'—')+(inv.series?' · série '+inv.series:''):
                      inv?.status==='pending'?'Em processamento ('+(inv.bling_status_label||'pendente')+')':
                      inv?.status==='problem'?(inv.bling_status_label||'Problema')+' no Bling':
                      inv?.status==='cancelled'?'Cancelada':'Aguardando emissão no Bling'}
                  </strong>
                  {inv?.status==='authorized'&&inv.issued_at&&<div className="muted" style={{fontSize:11}}>
                    Emitida em {fmtDate(inv.issued_at)}{inv.shared_at?' · enviada ao cliente':''}</div>}
                  {o.invoice_requested&&<div style={{fontSize:11,color:'#674d26',marginTop:2,overflowWrap:'anywhere'}}>
                    Cliente pediu nota{o.invoice_contact?' · '+(o.invoice_channel==='whatsapp'?'WhatsApp ':'e-mail ')+
                      o.invoice_contact:''}</div>}
                  {isLive(o)&&o.bling_export_confirmed&&
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                      <button type="button" className="btn btn-white btn-sm" disabled={invoiceBusy===o.request_number}
                        onClick={()=>invoiceCall('invoice_refresh',o)}>
                        <RefreshCw size={13}/>{invoiceBusy===o.request_number?'Consultando…':'Consultar Bling'}
                      </button>
                      {inv?.status==='authorized'&&o.order_url&&<>
                        <a className="btn btn-primary btn-sm" target="_blank" rel="noopener noreferrer"
                          href={whatsappHref(o)} onClick={()=>invoiceCall('invoice_shared',o)}>
                          Enviar pelo WhatsApp</a>
                        {o.invoice_channel==='email'&&o.invoice_contact&&
                          <a className="btn btn-white btn-sm" onClick={()=>invoiceCall('invoice_shared',o)}
                            href={'mailto:'+encodeURIComponent(o.invoice_contact)+'?subject='+
                              encodeURIComponent('Nota fiscal do pedido EC-'+o.request_number)+
                              '&body='+encodeURIComponent(invoiceMessage(o))}>Enviar por e-mail</a>}
                      </>}
                    </div>}
                </>;
              })()}
            </div>
            <div style={{minWidth:0}}>
              <div className="muted" style={{fontSize:11}}>Atendimento</div>
              <strong style={{fontSize:12,
                color:o.fulfillment_stage==='delivered'?'#17654e':'#674d26'}}>
                {!isLive(o)?'Aguardando pagamento':
                  FULFILLMENT_STAGES[normalizeStage(o.fulfillment_stage)]}
              </strong>
              {o.requires_stock_review&&o.fulfillment_stage!=='delivered'&&
                <div style={{fontSize:11,color:'#95651e',marginTop:4}}>
                  Sob encomenda · verificar disponibilidade
                </div>}
              {o.fulfillment_note&&<p className="muted"
                style={{fontSize:11,marginTop:5,overflowWrap:'anywhere'}}>
                {o.fulfillment_note}
              </p>}
              {o.item_count>0&&<div className="muted" style={{fontSize:11}}>
                {o.item_count} produto(s) diferente(s)
              </div>}
            </div>
          </div>
          {isLive(o)&&
            <div style={{borderTop:'1px solid #e4ece8',paddingTop:11,marginTop:11}}>
              {fulfillmentEditing===o.request_number?<>
                <strong style={{fontSize:13}}>Atualizar o cliente</strong>
                <p className="muted" style={{fontSize:11,marginTop:3}}>
                  Etapa atual: {FULFILLMENT_STAGES[normalizeStage(o.fulfillment_stage)]}.
                  Escolha a nova etapa ou mantenha a atual para só publicar um comentário.
                </p>
                <div role="radiogroup" aria-label={'Etapa do pedido '+o.request_number}
                  style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:9}}>
                  {FULFILLMENT_ORDER.map(stage=>{
                    const isCurrent=stage===normalizeStage(o.fulfillment_stage);
                    const selected=stage===fulfillmentSelected;
                    return <button key={stage} type="button" role="radio" aria-checked={selected}
                      disabled={fulfillmentBusy} onClick={()=>setFulfillmentSelected(stage)}
                      className={'btn btn-sm '+(selected?'btn-primary':'btn-white')}
                      style={{fontSize:12}}>
                      {FULFILLMENT_STAGES[stage]}{isCurrent?' (atual)':''}
                    </button>;
                  })}
                </div>
                <label style={{fontSize:12,fontWeight:700,display:'block',marginTop:10}}>
                  Comentário para o cliente {fulfillmentSelected===normalizeStage(o.fulfillment_stage)?
                    '(obrigatório)':'(opcional)'}
                  <textarea maxLength={240} rows={3} value={fulfillmentNote}
                    onChange={e=>setFulfillmentNote(e.target.value)}
                    placeholder={({
                      received:'Ex.: recebemos seu pedido, a separação começa amanhã cedo.',
                      preparing:'Ex.: estamos separando os produtos.',
                      ready_for_delivery:'Ex.: pedido separado, entrega prevista para amanhã à tarde.',
                      out_for_delivery:'Ex.: saiu para entrega com o motorista Carlos, chega até 16h.',
                      delivered:'Ex.: entregue para a recepção. Obrigado!',
                      on_hold:'Ex.: o álcool 70% chega na quinta; enviamos tudo junto.'
                    })[fulfillmentSelected]||''}
                    style={{display:'block',width:'100%',marginTop:6,
                      boxSizing:'border-box',padding:10,borderRadius:9,
                      border:'1px solid #cbdcd2',fontWeight:400}}/>
                  <span className="muted" style={{fontSize:11,fontWeight:400}}>
                    {fulfillmentNote.length}/240 · aparece no acompanhamento do pedido do cliente
                  </span>
                </label>
                {!o.bling_export_confirmed&&<p style={{fontSize:11,color:'#946020',marginTop:7}}>
                  Pedido ainda não registrado no Bling. O acompanhamento funciona mesmo assim.
                </p>}
                {fulfillmentError&&<p role="alert"
                  style={{fontSize:12,color:'#9c3d2e',marginTop:8}}>
                  {fulfillmentError}
                </p>}
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
                  <button type="button" className="btn btn-primary btn-sm"
                    disabled={fulfillmentBusy||!fulfillmentSelected||
                      (fulfillmentSelected===normalizeStage(o.fulfillment_stage)&&!fulfillmentNote.trim())}
                    onClick={()=>updateFulfillment(o)}>
                    {fulfillmentBusy?'Publicando...':
                      fulfillmentSelected===normalizeStage(o.fulfillment_stage)?'Publicar comentário':
                      'Mudar para '+FULFILLMENT_STAGES[fulfillmentSelected]}
                  </button>
                  <button type="button" className="btn btn-white btn-sm"
                    disabled={fulfillmentBusy} onClick={()=>setFulfillmentEditing(null)}>
                    Fechar
                  </button>
                </div>
                <div style={{marginTop:14,padding:12,borderRadius:10,background:'#f7faf9',
                  border:'1px solid #e1ebe6'}}>
                  <div className="muted" style={{fontSize:11,marginBottom:6}}>
                    Como o cliente vê o acompanhamento:
                  </div>
                  <OrderTracking compact stage={o.fulfillment_stage}
                    events={fulfillmentHistory[o.request_number]||[]}/>
                </div>
              </>:<button type="button" className="btn btn-white btn-sm"
                onClick={()=>openFulfillment(o)}>
                <Package size={15}/>{normalizeStage(o.fulfillment_stage)==='delivered'?
                  'Ver acompanhamento':'Atualizar acompanhamento'}
              </button>}
            </div>}
        </div>)}
        {!filteredProductionOrders.length&&!loading&&
          <div className="empty">
            {rows.length?'Nenhum pedido corresponde aos filtros.':
              'Nenhum pedido real registrado no Neon.'}
          </div>}
      </div>
      {productionPageCount>1&&<div style={{display:'flex',gap:10,
        justifyContent:'space-between',alignItems:'center',marginTop:14,flexWrap:'wrap'}}>
        <button type="button" className="btn btn-white btn-sm"
          disabled={currentProductionPage===1}
          onClick={()=>setProductionPage(p=>Math.max(1,p-1))}>Anterior</button>
        <span style={{fontSize:12,color:'#50665d'}}>
          Página {currentProductionPage} de {productionPageCount}
        </span>
        <button type="button" className="btn btn-white btn-sm"
          disabled={currentProductionPage===productionPageCount}
          onClick={()=>setProductionPage(p=>Math.min(productionPageCount,p+1))}>
          Próxima
        </button>
      </div>}
    </div>
    <ProductionAutomationQueue/>
    {rows.some(o=>o.request_number==='HOMOLOG-01'&&isLive(o))&&
      <div style={{padding:16,borderTop:'1px solid #e0e9e5'}}>
        <h3 style={{fontSize:15}}>Conferir HOMOLOG-01 antes do Bling</h3>
        <p className="muted" style={{fontSize:12,marginTop:7}}>
          Compara o pagamento no Neon, o contato e o SKU com o Bling e pesquisa
          pedidos com a mesma referência de origem. Somente leitura: não cria
          pedidos, não movimenta estoque e não emite nota fiscal.
        </p>
        <button className="btn btn-white" type="button" style={{marginTop:11}}
          disabled={auditing} onClick={inspectBling}>
          <ShieldCheck size={16}/>{auditing?'Conferindo...':'Conferir Neon → Bling (sem envio)'}
        </button>
        {blingAuditError&&<p className="form-error" style={{marginTop:10}}>{blingAuditError}</p>}
        {blingAudit&&<div style={{marginTop:12,padding:12,border:'1px solid #d5e4df',borderRadius:10}}>
          <strong style={{color:blingAudit.approved?'#17654e':'#925321'}}>
            {blingAudit.approved?'Conferência técnica aprovada':'Conferência com pendências'}
          </strong>
          <div className="detail-list" style={{marginTop:9}}>
            <div className="detail-item"><span>Neon: pagamento</span><strong>{blingAudit.neon_paid?'Pago':'Conferir'}</strong></div>
            <div className="detail-item"><span>SKU / quantidade</span><strong>{blingAudit.sku} / {blingAudit.quantity}</strong></div>
            <div className="detail-item"><span>Referência para buscar no Bling</span>
              <strong>{blingAudit.origin_reference}</strong></div>
            <div className="detail-item"><span>Pedido já vinculado no Bling</span>
              <strong>{blingAudit.existing_bling_order_number||'Não encontrado pela referência'}</strong></div>
            <div className="detail-item"><span>Envio automático</span><strong>Desativado</strong></div>
          </div>
          {(blingAudit.reasons||[]).map((reason,i)=><p key={i}
            style={{fontSize:12,marginTop:7,color:'#955323'}}>{reason}</p>)}
          <p style={{fontSize:12,marginTop:10}}>{blingAudit.message}</p>
        </div>}
        {blingAudit?.approved&&(!exportRecord||exportRecord.state==='retry_liberado')&&
          <div style={{marginTop:12,padding:13,borderRadius:12,border:'1px solid #cbded7'}}>
            <strong style={{fontSize:13}}>Envio único ao Bling — autorização manual</strong>
            <p className="muted" style={{fontSize:12,marginTop:7}}>
              Registrar uma venda de R$ 7,00 para HOMOLOG-01, origem EC-HOMOLOG-01.
              {exportRecord?.state==='retry_liberado'&&
                <strong> Esta é a única nova tentativa após a conferência de ausência.</strong>}
              A integração não executa
              baixa de estoque, lançamento de contas ou emissão de NF-e.
            </p>
            <label style={{display:'flex',alignItems:'flex-start',gap:8,marginTop:10,fontSize:12}}>
              <input type="checkbox" checked={exportChecked}
                onChange={event=>setExportChecked(event.target.checked)}/>
              Conferi o pagamento e autorizo o envio de um único pedido HOMOLOG-01 ao Bling.
            </label>
            <button type="button" className="btn btn-primary" style={{marginTop:10}}
              disabled={!exportChecked||sending} onClick={sendControlled}>
              <ShieldCheck size={16}/>{sending?'Enviando...':
                (exportRecord?.state==='retry_liberado'?'Enviar uma única nova tentativa':'Enviar HOMOLOG-01 ao Bling')}
            </button>
          </div>}
        {exportRecord&&<div style={{marginTop:12,padding:13,borderRadius:12,border:'1px solid #d6e1dd'}}>
          <strong>Registro do envio: {exportRecord.state==='retry_liberado'?'Nova tentativa preparada':exportRecord.state}</strong>
          <div className="detail-list" style={{marginTop:8}}>
            <div className="detail-item"><span>Referência</span><strong>{exportRecord.reference}</strong></div>
            <div className="detail-item"><span>Pedido no Bling</span>
              <strong>{exportRecord.bling_order_number||'Conferência pendente'}</strong></div>
          </div>
          <p className="muted" style={{fontSize:12,marginTop:8}}>
            {exportRecord.message||'Não repetir envio. Confirmar no Bling.'}
          </p>
          <button type="button" className="btn btn-white" style={{marginTop:10}}
            disabled={sending} onClick={reconcileControlled}>
            <RefreshCw size={15}/>Conferir registro no Bling (sem novo envio)
          </button>
          {exportRecord.state==='conferencia_manual'&&
            <RecoveryBlingControl onUpdated={setExportRecord}/>}
          {exportRecord.state==='retry_liberado'&&
            <p className="muted" style={{fontSize:12,marginTop:11}}>
              A conferência manual foi registrada. Nenhum pedido foi reenviado.
              Uma única nova tentativa dependerá da confirmação expressa acima.
            </p>}
        </div>}
        {exportError&&<p className="form-error" style={{marginTop:10}}>{exportError}</p>}
      </div>}
  </section>;
}

function ProductionGeneralLinksSetup(){
  const [liveCheckout,setLiveCheckout]=React.useState(false);
  const [maximum,setMaximum]=React.useState(null);
  const [clients,setClients]=React.useState([]);
  const [selected,setSelected]=React.useState('');
  const [links,setLinks]=React.useState([]);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [notificationDiagnosis,setNotificationDiagnosis]=React.useState(null);
  const [diagnosingNotifications,setDiagnosingNotifications]=React.useState(false);
  const [fixingNotifications,setFixingNotifications]=React.useState(false);
  const [disablingUncertainNotice,setDisablingUncertainNotice]=React.useState(false);
  async function diagnoseAsaasNotifications(){
    setDiagnosingNotifications(true);setError('');
    try{
      const res=await fetch('/.netlify/functions/asaas-notifications-diagnostic',{
        method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'diagnose',request_number:'1000000000'})
      });
      const data=await res.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!res.ok||!data.ok)throw Error(data.message||'Diagnóstico indisponível.');
      setNotificationDiagnosis(data);
      toast.success('Diagnóstico Asaas concluído sem cobrar.');
    }catch(e){setError(e.message||'Não foi possível consultar as notificações do Asaas.');}
    finally{setDiagnosingNotifications(false);}
  }
  async function repairAsaasNotifications(){
    if(fixingNotifications||diagnosingNotifications||busy)return;
    if(!window.confirm('Corrigir os canais pagos das notificações do cliente piloto no Asaas? Apenas SMS, WhatsApp e ligação serão desativados; as opções de e-mail serão preservadas. Nenhuma cobrança PIX será criada.'))return;
    setFixingNotifications(true);setError('');
    try{
      const res=await fetch('/.netlify/functions/asaas-notifications-diagnostic',{
        method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'repair',request_number:'1000000000',confirm:true})
      });
      const data=await res.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!res.ok||!data?.ok)throw Error(data.message||'Correção indisponível.');
      setNotificationDiagnosis(data);
      if(data.repair_result?.verified)
        toast.success('Canais pagos desativados e conferidos, sem gerar PIX.');
      else toast.error('Asaas ainda não confirmou a correção. Não gerar PIX.');
    }catch(e){setError(e.message||'Não foi possível corrigir canais no Asaas.');}
    finally{setFixingNotifications(false);}
  }
  async function disableUncertainNotice(){
    if(disablingUncertainNotice||fixingNotifications||diagnosingNotifications||busy)return;
    const unresolved=(notificationDiagnosis?.mismatches||[]).filter(entry=>
      entry.active&&entry.fields?.some(field=>field.includes('whatsappEnabledForCustomer')));
    if(unresolved.length!==1)return;
    const event=unresolved[0].event||'desconhecido';
    if(!window.confirm(
      'ATENÇÃO: o Asaas não confirma o WhatsApp desta notificação. '+
      'A alternativa desativa SOMENTE a notificação '+(unresolved[0].index+1)+
      ' ('+event+'), inclusive o E-MAIL desse evento. '+
      'As outras notificações e seus e-mails serão mantidos. '+
      'Nenhum PIX será criado. Deseja desativar esta notificação específica?'
    ))return;
    setDisablingUncertainNotice(true);setError('');
    try{
      const response=await fetch('/.netlify/functions/asaas-notifications-diagnostic',{
        method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'disable_uncertain',request_number:'1000000000',
          confirm:true,acknowledge:'DESATIVAR_NOTIFICACAO_E_EMAIL_DO_EVENTO'})
      });
      const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!data?.ok)throw Error(data.message||'Falha na conferência do Asaas.');
      setNotificationDiagnosis(data);
      if(data.repair_result?.verified)
        toast.success('Notificação específica desativada e conferida, sem PIX.');
      else toast.error('Asaas não confirmou a desativação. PIX permanece bloqueado.');
    }catch(e){setError(e.message||'A alteração não foi confirmada no Asaas.');}
    finally{setDisablingUncertainNotice(false);}
  }
  async function api(action,extra={}){
    const response=await fetch('/.netlify/functions/production-general-links',{
      method:'POST',headers:{'Content-Type':'application/json',
        Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action,...extra})
    });
    const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
    if(!response.ok||!data?.ok)throw Error(data.message||'Não foi possível consultar links de produção.');
    return data;
  }
  async function refresh(){
    setBusy(true);setError('');
    try{
      const [a,b]=await Promise.all([api('options'),api('list')]);
      setClients(a.clients||[]);setLinks(b.links||[]);
      setLiveCheckout(b.payment_enabled===true);
      setMaximum(b.max_payment_amount||null);
    }catch(e){setError(e.message||'Erro na consulta de links.');}
    finally{setBusy(false);}
  }
  async function prepare(){
    if(!selected||busy)return;
    if(!window.confirm(liveCheckout?
      'Criar link de pedido de PRODUÇÃO para este cliente, com possibilidade de PIX REAL após confirmação do comprador? Nenhuma cobrança será criada agora.':
      'Preparar link de produção somente para prévia, sem gerar PIX ou pedido?'))return;
    setBusy(true);setError('');
    try{
      const result=await api('prepare',{customer_id:selected,accept:true});
      setLinks(old=>[result.link,...old]);
      toast.success(result.link?.payment_enabled?
        'Link real criado. O cliente confirma o PIX no checkout.':
        'Link de prévia criado sem cobrança.');
    }catch(e){setError(e.message||'Não foi possível preparar link.');}
    finally{setBusy(false);}
  }
  async function copy(link){
    try{await navigator.clipboard.writeText(link.url);toast.success(link.payment_enabled?
      'Link PIX real copiado.':'Link de prévia copiado.');}
    catch(e){setError('Falha ao copiar link.');}
  }
  return <div style={{marginTop:14,padding:12,border:'1px solid #d6e6df',borderRadius:12,
    width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box',overflow:'hidden'}}> 
    <strong style={{fontSize:14}}>Links de pedidos da Ever Clean · produção</strong>
    <p className="muted" style={{fontSize:12,marginTop:7}}>
      {liveCheckout?
        'Novos links de produção permitem ao cliente concluir compras com PIX real, até '+
          money(maximum||0)+' por pedido. Criar ou copiar um link não gera cobrança. '+
          'Os links antigos continuam no Sandbox.':
        'Os links de produção permitem conferir produtos e valores. O PIX geral continua bloqueado. Os links antigos permanecem no Sandbox.'}
    </p>
    <button type="button" className="btn btn-white" onClick={refresh}
      style={{marginTop:10,width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box',
        whiteSpace:'normal',textAlign:'center',justifyContent:'center',overflowWrap:'anywhere'}}
      disabled={busy}>
      <RefreshCw size={16}/>{busy?'Consultando...':'Carregar clientes e links de produção'}
    </button>
    <div style={{marginTop:12,padding:12,border:'1px solid #dbe5e1',borderRadius:11,
      minWidth:0,maxWidth:'100%',boxSizing:'border-box'}}>
      <strong style={{fontSize:13}}>Diagnóstico Asaas do piloto R$ 26,69</strong>
      <p className="muted" style={{fontSize:12,marginTop:5}}>
        Conferência técnica dos campos de notificação que bloquearam a cobrança.
        Somente leitura: não gera PIX, não envia mensagens e não altera cadastro.
      </p>
      <button type="button" className="btn btn-white" style={{marginTop:10,
        whiteSpace:'normal',width:'100%',minWidth:0,maxWidth:'100%',
        boxSizing:'border-box',justifyContent:'center',textAlign:'center'}}
        disabled={diagnosingNotifications||busy} onClick={diagnoseAsaasNotifications}>
        <ShieldCheck size={16}/>{diagnosingNotifications?'Verificando...':
          'Diagnosticar notificações Asaas (sem cobrança)'}
      </button>
      {notificationDiagnosis?.mismatches?.some(entry=>entry.active&&
        entry.fields?.some(field=>field.includes('whatsappEnabledForCustomer')))&&
        <button type="button" className="btn btn-white"
          style={{marginTop:10,width:'100%',maxWidth:'100%',minWidth:0,
            boxSizing:'border-box',justifyContent:'center',textAlign:'center',
            whiteSpace:'normal',lineHeight:1.4}}
          disabled={fixingNotifications||diagnosingNotifications||busy}
          onClick={repairAsaasNotifications}>
          <ShieldCheck size={16}/>
          {fixingNotifications?'Corrigindo no Asaas...':
            'Corrigir canais pagos no Asaas (sem PIX)'}
        </button>}
      {notificationDiagnosis?.mismatches?.filter(entry=>entry.active&&
        entry.fields?.some(field=>field.includes('whatsappEnabledForCustomer'))).length===1&&
        <div style={{marginTop:12,padding:11,border:'1px solid #ead9c0',
          borderRadius:10,minWidth:0}}>
          <strong style={{fontSize:13,color:'#924e25'}}>
            Alternativa para a notificação sem confirmação
          </strong>
          <p style={{fontSize:12,marginTop:7,color:'#775f47'}}>
            A API continua sem informar o WhatsApp mesmo após a correção.
            Você pode desativar exclusivamente essa notificação, incluindo
            o e-mail associado a esse evento. As demais notificações e seus e-mails
            permanecerão ativos. Nenhum PIX é gerado nesta operação.
          </p>
          <button type="button" className="btn btn-white"
            style={{width:'100%',maxWidth:'100%',minWidth:0,marginTop:10,
              boxSizing:'border-box',whiteSpace:'normal',justifyContent:'center',
              textAlign:'center',lineHeight:1.4}}
            disabled={disablingUncertainNotice||fixingNotifications||
              diagnosingNotifications||busy}
            onClick={disableUncertainNotice}>
            <ShieldCheck size={16}/>
            {disablingUncertainNotice?'Verificando no Asaas...':
              'Desativar apenas a notificação com campo indefinido'}
          </button>
        </div>}
      {notificationDiagnosis&&<div style={{marginTop:10,overflowWrap:'anywhere'}}>
        <strong style={{fontSize:12,color:notificationDiagnosis.paid_channels_verified||
          notificationDiagnosis.diagnosis==='schema_valid'?'#17654e':'#9d5527'}}>
          Diagnóstico: {notificationDiagnosis.paid_channels_verified?
            'canais pagos verificados e seguros':
            notificationDiagnosis.diagnosis==='schema_valid'?
            'campos reconhecidos':'verificar campo WhatsApp ausente'}
        </strong>
        <p style={{fontSize:12,marginTop:5}}>
          {notificationDiagnosis.total_notifications||0} notificações consultadas.
          {' '}{notificationDiagnosis.mismatches?.length||0} configurações com campos divergentes.
        </p>
        {(notificationDiagnosis.mismatches||[]).map((entry,i)=>
          <p key={i} style={{fontSize:12,marginTop:5,color:'#915126'}}>
            Notificação {entry.index+1} ({entry.event||'evento não identificado'}):
            {' '}{entry.fields.join(', ')}.
            {' '}{entry.active?
              'ATIVA: bloqueio preventivo mantido até confirmar o canal WhatsApp.':
              'DESATIVADA: não envia mensagens; omissão aceita na validação.'}
          </p>)}
        {notificationDiagnosis.repair_result&&<p style={{
          fontSize:12,marginTop:10,
          color:notificationDiagnosis.repair_result.verified?'#17654e':'#9d5527'}}>
          {notificationDiagnosis.repair_result.verified?
            (notificationDiagnosis.repair_result.mode==='disable_one'?
              'Apenas uma notificação foi desativada, inclusive o e-mail deste evento. As outras foram preservadas. Nenhum PIX gerado.':
              'Canais pagos desativados e confirmados. E-mails preservados. PIX não gerado.'):
            'Correção não confirmada pela API. PIX continua bloqueado; verificar no Asaas.'}
        </p>}
        <p style={{fontSize:11,color:'#61756e',marginTop:7}}>
          {notificationDiagnosis.repair_result?
            'Nenhuma cobrança PIX ou pedido foi criado. Somente configurações de notificações podem ter sido atualizadas.':
            'Diagnóstico somente de leitura: nenhuma cobrança, pedido ou notificação foi criado ou alterado.'}
        </p>
      </div>}
    </div>
    {!!clients.length&&<div style={{marginTop:10,display:'grid',gap:8,
      gridTemplateColumns:'minmax(0,1fr)',width:'100%',minWidth:0,maxWidth:'100%'}}> 
      <select value={selected} onChange={e=>setSelected(e.target.value)}
        disabled={busy} style={{padding:10,border:'1px solid #d5e1dd',borderRadius:9,
          width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box',fontSize:14,
          textOverflow:'ellipsis'}}> 
        <option value="">Selecione o cliente do link</option>
        {clients.map(x=><option key={x.id} value={x.id} disabled={!x.has_document}>
          {x.name}{!x.has_document?' · CPF/CNPJ pendente':''}
        </option>)}
      </select>
      <button type="button" className="btn btn-white" disabled={!selected||busy}
        style={{width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box',
          whiteSpace:'normal',textAlign:'center',justifyContent:'center',
          overflowWrap:'anywhere',padding:'12px 10px',lineHeight:1.35}}
        onClick={prepare}>
        <ShieldCheck size={16}/>{liveCheckout?
          'Criar novo link de compra REAL (sem cobrança agora)':
          'Preparar link de produção (sem PIX)'}
      </button>
    </div>}
    {error&&<p className="form-error" style={{marginTop:9}}>{error}</p>}
    {!!links.length&&<div style={{display:'grid',gap:10,marginTop:12,
      gridTemplateColumns:'minmax(0,1fr)',width:'100%',minWidth:0}}> 
      {links.slice(0,12).map(link=><div key={link.id}
        style={{padding:10,border:'1px solid #e2e9e6',borderRadius:10,
          maxWidth:'100%',minWidth:0,overflowWrap:'anywhere',boxSizing:'border-box'}}> 
        <strong style={{fontSize:13}}>{link.customer_name}</strong>
        <p className="muted" style={{fontSize:12,marginTop:5}}>
          Solicitação EC-{link.request_number} · {link.status==='prepared'?
            (link.payment_enabled?'Compra PIX real habilitada':'Prévia preparada'):link.status}
        </p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
          <button type="button" className="btn btn-white btn-sm" onClick={()=>copy(link)}>
            <Copy size={14}/>Copiar link
          </button>
          <button type="button" className="btn btn-white btn-sm"
            onClick={()=>window.open(link.url,'_blank','noopener,noreferrer')}>
            <ExternalLink size={14}/>{link.payment_enabled?'Abrir compra':'Abrir prévia'}
          </button>
        </div>
      </div>)}
    </div>}
    <FinancialPreflightPanel links={links}/>
  </div>;
}
function FinancialPreflightPanel({links}){
  const [linkId,setLinkId]=React.useState('');
  const [catalog,setCatalog]=React.useState(null);
  const [productId,setProductId]=React.useState('');
  const [quantity,setQuantity]=React.useState(1);
  const [cart,setCart]=React.useState([]);
  const [result,setResult]=React.useState(null);
  const [busy,setBusy]=React.useState('');
  const [error,setError]=React.useState('');
  const available=links.filter(link=>link.status==='prepared'&&
    new Date(link.expires_at).getTime()>Date.now());
  async function preflight(action,body={}){
    const response=await fetch('/.netlify/functions/production-financial-preflight',{
      method:'POST',headers:{'Content-Type':'application/json',
        Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action,link_id:linkId,...body})
    });
    const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
    if(!response.ok||!data.ok)throw Error(data.message||'Conferência indisponível.');
    return data;
  }
  async function inspect(){
    if(!linkId||busy)return;
    setBusy('catalog');setError('');setResult(null);setCart([]);setCatalog(null);
    try{
      const response=await preflight('catalog');
      setCatalog(response);
      if(!response.link_unused)setError('Este link já possui pedido. Selecione outro para não duplicar.');
    }catch(e){setError(e.message||'Link indisponível.');}
    finally{setBusy('');}
  }
  function add(){
    if(!catalog?.link_unused||!productId||busy)return;
    const product=(catalog.products||[]).find(p=>String(p.id)===productId);
    const qty=Math.trunc(Number(quantity));
    if(!product||!product.can_order||!Number.isSafeInteger(qty)||qty<1||qty>10000||
      cart.some(p=>p.product_id===productId)||cart.length>=50)return;
    setCart(list=>[...list,{product_id:productId,quantity:qty}]);
    setProductId('');setQuantity(1);setResult(null);
  }
  function restorePreparedCart(){
    if(!catalog?.link_unused||!['awaiting_final_confirmation','authorized_for_single_pix'].includes(catalog?.preparation?.state))return;
    const prepared=catalog.preparation.items||[];
    const mapped=prepared.map(item=>{
      const product=(catalog.products||[]).find(p=>String(p.sku)===String(item.sku)&&
        Math.round(Number(p.price)*100)===Number(item.unit_price_cents));
      return product?{product_id:String(product.id),quantity:Number(item.quantity)}:null;
    });
    if(mapped.length!==2||mapped.some(x=>!x)){
      setError('Os valores do catálogo mudaram; revalidar antes da autorização financeira.');
      return;
    }
    setCart(mapped);setResult(null);setError('');
  }
  async function validate(){
    if(!catalog?.link_unused||!cart.length||busy)return;
    setBusy('validate');setError('');setResult(null);
    try{
      const response=await preflight('validate',{items:cart});
      setResult(response);
      toast.success('Carrinho validado sem criar PIX.');
    }catch(e){setError(e.message||'Não foi possível validar o carrinho.');}
    finally{setBusy('');}
  }
  return <section style={{marginTop:14,padding:12,border:'1px solid #d5e6dd',
    borderRadius:12,width:'100%',minWidth:0,boxSizing:'border-box'}}>
    <strong style={{fontSize:15}}>Pré-homologação financeira · sem cobrança</strong>
    <p className="muted" style={{fontSize:12,marginTop:7,lineHeight:1.6}}>
      Escolha um link existente, selecione produtos e quantidades e confirme
      o valor calculado no servidor. Nenhum PIX é criado e nenhuma autorização financeira é ativada.
    </p>
    <select value={linkId} onChange={e=>{
      setLinkId(e.target.value);setCatalog(null);setCart([]);setResult(null);setError('');
    }} style={{width:'100%',minWidth:0,boxSizing:'border-box',
      border:'1px solid #d5e1dd',borderRadius:9,padding:11,marginTop:12}}>
      <option value="">Selecione um link de produção</option>
      {available.map(link=><option key={link.id} value={link.id}>
        {'EC-'+link.request_number+' · '+link.customer_name}
      </option>)}
    </select>
    <button type="button" className="btn btn-white"
      disabled={!linkId||!!busy} onClick={inspect}
      style={{width:'100%',whiteSpace:'normal',justifyContent:'center',marginTop:9}}>
      <ShieldCheck size={16}/>{busy==='catalog'?'Conferindo link...':'Conferir link sem cobrança'}
    </button>
    {catalog&&<div style={{marginTop:12}}>
      <p style={{fontSize:12,color:catalog.link_unused?'#17654e':'#9c5527',fontWeight:650}}>
        {'Solicitação EC-'+catalog.request_number+' · '+
        (catalog.link_unused?'Disponível para validar':'Já utilizada, nova cobrança bloqueada')}
      </p>
      {['awaiting_final_confirmation','authorized_for_single_pix'].includes(catalog.preparation?.state)&&<div
        style={{marginTop:12,padding:12,borderRadius:10,background:'#f0f8f3',
          border:'1px solid #c8dfd1'}}>
        <strong style={{fontSize:13,color:'#17654e'}}>
          {catalog.preparation.payment_authorized?'PIX real autorizado exclusivamente — ':'Preparação exclusiva registrada — '}
          {money(catalog.preparation.amount_cents/100)}
        </strong>
        <p style={{fontSize:12,marginTop:7}}>
          Pedido EC-1000000001 · 2 produtos ·
          {catalog.preparation.payment_authorized?
            ' Autorização ativa. A cobrança ainda NÃO foi criada. Para gerar uma única cobrança, abra o link do cliente na seção acima, confira o carrinho e confirme no botão Gerar PIX real.':
            ' pagamento ainda NÃO autorizado. Não houve geração de PIX nem criação de venda.'}
        </p>
        {(catalog.preparation.items||[]).map((item,i)=>
          <p key={i} className="muted" style={{fontSize:12,marginTop:4}}>
            SKU {item.sku} · {item.quantity} × {money(item.unit_price_cents/100)}
          </p>)}
        <button type="button" className="btn btn-white" onClick={restorePreparedCart}
          disabled={!!busy} style={{marginTop:10,width:'100%',whiteSpace:'normal',
            justifyContent:'center'}}>
          {catalog.preparation.payment_authorized?'Carregar os dois produtos autorizados':'Carregar os dois produtos preparados'}
        </button>
      </div>}
      {catalog.link_unused&&<>
        <p className="muted" style={{fontSize:12,marginTop:7}}>
          Selecione até {catalog.max_items||50} produtos diferentes. Estoque zerado poderá
          constar como encomenda, conforme a configuração do item.
        </p>
        <select value={productId} onChange={e=>{setProductId(e.target.value);setResult(null);}}
          style={{width:'100%',minWidth:0,boxSizing:'border-box',border:'1px solid #d5e1dd',
            borderRadius:9,padding:10,marginTop:10}}>
          <option value="">Selecione um produto</option>
          {(catalog.products||[]).filter(p=>p.can_order).map(p=>
            <option key={p.id} value={p.id}>
              {p.name+' · '+p.sku+' · '+money(p.price)}
            </option>)}
        </select>
        <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginTop:9}}>
          <input type="number" min="1" max="10000" step="1" value={quantity}
            aria-label="Quantidade para pré-homologação"
            onChange={e=>setQuantity(e.target.value)}
            style={{width:110,minWidth:0,padding:10,borderRadius:9,
              border:'1px solid #d5e1dd',boxSizing:'border-box'}}/>
          <button type="button" className="btn btn-white" onClick={add}
            disabled={!productId||!!busy||cart.length>=50}>
            <Plus size={15}/>Adicionar
          </button>
        </div>
        {cart.map(item=>{
          const p=(catalog.products||[]).find(x=>String(x.id)===String(item.product_id));
          return <div key={item.product_id} style={{display:'flex',flexWrap:'wrap',
            alignItems:'center',justifyContent:'space-between',gap:8,padding:'9px 0',
            borderBottom:'1px solid #e8eeeb',fontSize:12}}>
            <span style={{flex:'1 1 190px',minWidth:0}}>
              {p?.name||item.product_id} · {item.quantity} × {money(p?.price)}
            </span>
            <button type="button" className="btn btn-white btn-sm"
              onClick={()=>{setCart(xs=>xs.filter(x=>x.product_id!==item.product_id));setResult(null);}}>
              Remover
            </button>
          </div>;
        })}
        <button type="button" className="btn btn-primary"
          disabled={!cart.length||!!busy} onClick={validate}
          style={{marginTop:12,width:'100%',whiteSpace:'normal',justifyContent:'center'}}>
          <ShieldCheck size={16}/>{busy==='validate'?'Validando...':'Validar carrinho e valor (sem PIX)'}
        </button>
      </>}
    </div>}
    {result?.validation&&<div style={{padding:12,marginTop:12,borderRadius:10,
      border:'1px solid #d3e3d9',background:'#f7fbf9'}}>
      <strong style={{color:result.ready_for_manual_authorization_review?'#17654e':'#985b21'}}>
        {result.preparation?.payment_authorized&&result.prepared_cart_matches?
          'PIX real autorizado para este carrinho — cobrança ainda não emitida':
          result.ready_for_manual_authorization_review?
            'Carrinho idêntico à preparação — aguarda confirmação final':
            result.preparation?.state==='awaiting_final_confirmation'?
              'Carrinho diferente dos itens preparados':'Link ou referência com restrição'}
      </strong>
      <p style={{fontSize:14,marginTop:8}}>
        {result.validation.item_count} produtos · {result.validation.quantity_total} unidades
        {' · '}<strong>{money(result.validation.amount)}</strong>
      </p>
      <p className="muted" style={{fontSize:12,marginTop:6}}>
        {result.validation.requires_stock_review?'Inclui itens sob encomenda. ':''}
        Pagamento, emissão fiscal e baixa de estoque não foram executados.
      </p>
      <p style={{fontSize:12,marginTop:8,color:'#875b2b',fontWeight:650}}>
        {result.preparation?.payment_authorized?
          'A autorização exclusiva está ativa. Para emitir o PIX, abra o link do cliente EC-1000000001; nenhuma cobrança é criada por esta validação.':
          'Próxima ação: revisão e autorização específica do PIX para este carrinho. Não há botão para gerar cobrança nesta etapa.'}
      </p>
    </div>}
    {error&&<p className="form-error" style={{marginTop:10}}>{error}</p>}
    {!available.length&&<p className="muted" style={{fontSize:12,marginTop:10}}>
      Carregue os links de produção acima para iniciar a pré-homologação.
    </p>}
  </section>;
}
function ProductionAutomationQueue(){
  const [audit,setAudit]=React.useState(null);
  const [loading,setLoading]=React.useState(false);
  const [checking,setChecking]=React.useState('');
  const [error,setError]=React.useState('');
  const [lockTest,setLockTest]=React.useState(null);
  const [testingLock,setTestingLock]=React.useState(false);
  const [engineState,setEngineState]=React.useState(null);
  const [checkingEngine,setCheckingEngine]=React.useState(false);
  const [publicAudit,setPublicAudit]=React.useState(null);
  const [checkingPublic,setCheckingPublic]=React.useState(false);
  async function auditPublicCheckout(){
    setCheckingPublic(true);setError('');
    try{
      const response=await fetch('/.netlify/functions/production-public-launch-audit',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'audit'})
      });
      const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!data.ok)throw Error(data.message||'Auditoria do checkout não concluída.');
      setPublicAudit(data);
      toast.success('Auditoria do catálogo concluída sem cobranças.');
    }catch(err){setError(err.message||'Erro ao conferir checkout público.');}
    finally{setCheckingPublic(false);}
  }
  async function checkEngine(){
    setCheckingEngine(true);setError('');
    try{
      const response=await fetch('/.netlify/functions/bling-production-dispatch',{
        method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'status'})
      });
      const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!data.ok)throw Error(data.message||'Motor indisponível.');
      setEngineState(data);
      toast.success('Travas conferidas. Nenhum pedido enviado.');
    }catch(err){setError(err.message||'Falha ao conferir motor de envio.');}
    finally{setCheckingEngine(false);}
  }
  const [payloads,setPayloads]=React.useState({});
  const [previewing,setPreviewing]=React.useState('');
  const [homologating,setHomologating]=React.useState('');
  const [homologations,setHomologations]=React.useState({});
  async function homologate(number){
    setHomologating(number);setError('');
    try{
      const response=await fetch('/.netlify/functions/bling-production-payload-preview',{
        method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'verify_external',request_number:number})
      });
      const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!data.ok)throw Error(data.message||'Homologação externa indisponível.');
      setHomologations(old=>({...old,[number]:data}));
      if(data.external_verified)toast.success('Conferência Asaas + Bling concluída sem envio.');
      else toast.error('Homologação com pendências. Nenhum pedido foi enviado.');
    }catch(err){setError(err.message||'Erro ao consultar Asaas e Bling.');}
    finally{setHomologating('');}
  }
  async function previewPayload(number){
    setPreviewing(number);setError('');
    try{
      const response=await fetch('/.netlify/functions/bling-production-payload-preview',{
        method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'preview_payload',request_number:number})
      });
      const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!response.ok||!data.ok)throw Error(data.message||'Prévia indisponível.');
      setPayloads(old=>({...old,[number]:data}));
      toast.success('Prévia preparada. Nenhuma venda foi enviada ao Bling.');
    }catch(err){setError(err.message||'Erro na prévia.');}
    finally{setPreviewing('');}
  }
  async function testTransactionalLock(){
    setTestingLock(true);setError('');setLockTest(null);
    try{
      const res=await fetch('/.netlify/functions/bling-export-transaction-audit',{
        method:'POST',headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+getTestToken()},
        body:JSON.stringify({action:'test_lock'})
      });
      const data=await res.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
      if(!res.ok||!data.ok)throw Error(data.message||'Teste da trava transacional falhou.');
      setLockTest(data);
      toast.success('Teste de unicidade aprovado. Nenhuma venda foi criada.');
    }catch(err){setError(err.message||'Teste de segurança não concluído.');}
    finally{setTestingLock(false);}
  }
  async function query(action,number){
    const response=await fetch('/.netlify/functions/bling-production-automation-readiness',{
      method:'POST',headers:{'Content-Type':'application/json',
        Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action,request_number:number})
    });
    const data=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
    if(!response.ok||!data.ok)throw Error(data.message||'Não foi possível conferir a automação.');
    return data;
  }
  async function load(){
    setLoading(true);setError('');
    try{
      const response=await query('preview');
      setAudit(response);
    }catch(err){setError(err.message||'Erro na auditoria.');}
    finally{setLoading(false);}
  }
  async function check(number){
    setChecking(number);setError('');
    try{
      const response=await query('verify',number);
      setAudit(previous=>previous?{
        ...previous,orders:previous.orders.map(o=>o.request_number===number?response.order:o)
      }:previous);
      toast.success(response.message||'Conferência concluída sem envios.');
    }catch(err){setError(err.message||'Falha ao conferir pedido.');}
    finally{setChecking('');}
  }
  return <div style={{padding:16,borderTop:'1px solid #e0e9e5'}}>
    <h3 style={{fontSize:16}}>Pedidos reais • integração Asaas → Neon → Bling</h3>
    <p className="muted" style={{fontSize:12,marginTop:8}}>
      PIX confirmado no Asaas → conciliação no Neon →
      validação de cliente, SKU e duplicidade → envio controlado ao Bling.
      {' '}<strong>{engineState?.automatic_scheduling_enabled?
        'Motor habilitado para pedidos novos após o marco de ativação.':
        engineState?'Motor bloqueado por configuração privada.':
        'Consulte o motor abaixo para verificar se a automação está habilitada.'}</strong>
      {' '}Os botões de auditoria e prévia apenas consultam dados.
      Expedição, baixa de estoque, financeiro e NF-e permanecem manuais.
    </p>
    <div style={{padding:12,border:'1px solid #d6e6df',borderRadius:12,marginTop:14}}>
      <strong style={{fontSize:14}}>Próxima etapa: checkout público de produção</strong>
      <p className="muted" style={{fontSize:12,marginTop:8}}>
        Os links antigos permanecem no Sandbox. Agora você pode preparar
        links gerais separados para clientes da Ever Clean e conferir vários
        produtos e valores na nova prévia de produção. A cobrança PIX real
        do catálogo geral continua bloqueada até a homologação final.
        A auditoria abaixo mostra as pendências sem gerar cobranças.
      </p>
      <button type="button" className="btn btn-white" style={{marginTop:10}}
        disabled={checkingPublic||loading||checkingEngine} onClick={auditPublicCheckout}>
        <ShieldCheck size={16}/>
        {checkingPublic?'Auditando...':'Auditar liberação do catálogo público (sem cobrança)'}
      </button>
      {publicAudit&&<div style={{marginTop:12}}>
        <strong style={{fontSize:13,color:publicAudit.ready_for_public_launch?'#17654e':'#a46426'}}>
          Checkout público: {publicAudit.ready_for_public_launch?'PRONTO PARA REVISÃO':'AINDA BLOQUEADO'}
        </strong>
        <p style={{fontSize:12,marginTop:7}}>
          {publicAudit.catalog?.visible||0} produtos visíveis ·
          {' '}{publicAudit.catalog?.backorder||0} sem estoque positivo ·
          {' '}{publicAudit.catalog?.duplicate_sku||0} SKUs duplicados ·
          {' '}{publicAudit.catalog?.no_bling||0} sem vínculo com Bling
        </p>
        <p style={{fontSize:12,marginTop:5}}>
          {publicAudit.links?.sandbox||0} links antigos no Sandbox ·
          {' '}{publicAudit.prepared_general_links||0} novos links exclusivos de produção
        </p>
        <p style={{fontSize:12,marginTop:8,fontWeight:650,
          color:publicAudit.technical_prerequisites_ready?'#17654e':'#9c5527'}}>
          Pré-requisitos técnicos: {publicAudit.technical_prerequisites_ready?'CONFERIDOS':'EM VERIFICAÇÃO'}
          {' '}· Limite: {publicAudit.max_items_per_order||50} produtos diferentes por pedido
          {' '}· Links de produção válidos: {publicAudit.valid_general_links||0}
        </p>
        <p className="muted" style={{fontSize:12,marginTop:6}}>
          Produtos sem estoque positivo podem ser vendidos sob encomenda quando habilitados.
          Isso não libera automaticamente o PIX.
        </p>
        {(publicAudit.checks||[]).map(item=>
          <div key={item.key} style={{padding:'9px 0',borderTop:'1px solid #e7eeeb',marginTop:6}}>
            <strong style={{fontSize:12,color:item.passed?'#17654e':'#9c5527'}}>
              {item.passed?'OK':'PENDENTE'} · {item.label}
            </strong>
            <p className="muted" style={{fontSize:11,marginTop:4}}>{item.description}</p>
          </div>
        )}
        <p className="muted" style={{fontSize:12,marginTop:10}}>
          Auditoria somente de leitura: nenhuma cobrança criada. Mesmo com pré-requisitos
          técnicos conferidos, o PIX geral permanece bloqueado até homologação e
          autorização financeira específica.
        </p>
      </div>}
    </div>
    <ProductionGeneralLinksSetup/>
    <button type="button" className="btn btn-white" style={{marginTop:12}}
      disabled={loading||!!checking} onClick={load}>
      <ShieldCheck size={16}/>{loading?'Auditando...':'Auditar fila de produção (sem envio)'}
    </button>
    <button type="button" className="btn btn-white" style={{marginTop:10}}
      disabled={testingLock||loading||!!checking} onClick={testTransactionalLock}>
      <ShieldCheck size={16}/>{testingLock?'Testando...':'Testar trava transacional (sem envio)'}
    </button>
    <button type="button" className="btn btn-white" style={{marginTop:10}}
      disabled={checkingEngine||testingLock||loading||!!checking||!!homologating}
      onClick={checkEngine}>
      <ShieldCheck size={16}/>{checkingEngine?'Verificando...':'Conferir motor de envio (sem ativar)'}
    </button>
    {engineState&&<div style={{padding:12,border:'1px solid #d6e6df',
      borderRadius:10,marginTop:12}}>
      <strong style={{color:'#17654e'}}>
        Envio automático: {engineState.automatic_scheduling_enabled?'HABILITADO':'DESLIGADO'}
      </strong>
      <p className="muted" style={{fontSize:12,marginTop:7}}>
        {engineState.automatic_scheduling_enabled?
          'Rotina de 5 minutos configurada e habilitada para novos pedidos. A execução efetiva depende de existir pedido elegível.':
          'Rotina de 5 minutos instalada, porém bloqueada por configuração privada.'}
        {' '}Webhook somente registra pagamentos. Pedido HOMOLOG-01 excluído
        dos próximos envios. Estoque, financeiro e NF-e permanecem manuais.
      </p>
      <p className="muted" style={{fontSize:12,marginTop:6}}>
        {engineState.manual_dispatch_enabled?
          'Envio administrativo individual habilitado: requer aprovação expressa por pedido.':
          'Envio administrativo individual também bloqueado.'}
      </p>
    </div>}
    {error&&<p className="form-error" style={{marginTop:12}}>{error}</p>}
    {lockTest&&<p style={{fontSize:12,color:'#17654e',marginTop:10}}>
      Trava de pedido único: OK. Reenvio duplicado: bloqueado. ROLLBACK: OK.
      Nenhum pedido, cobrança, estoque ou NF-e modificado.
    </p>}
    {audit&&<div style={{marginTop:14,padding:12,border:'1px solid #d6e6df',borderRadius:12}}>
      <strong style={{color:'#17654e'}}>
        Motor de exportação: {engineState?
          (engineState.automatic_scheduling_enabled?'HABILITADO':'DESLIGADO'):
          'NÃO CONSULTADO'}
      </strong>
      <p className="muted" style={{fontSize:12,marginTop:6}}>
        {audit.total_paid} pedido(s) pago(s) no Neon;
        {' '}{audit.already_exported} registro(s) com envio conhecido no Bling.
      </p>
      {(audit.orders||[]).map(o=><div key={o.request_number}
        style={{marginTop:10,padding:12,border:'1px solid #e1e8e4',borderRadius:10}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
          <strong>{o.request_number}</strong><strong>{money(o.amount)}</strong>
        </div>
        <p style={{fontSize:12,marginTop:6}}>{o.customer_name} · {o.item_count} produto(s)</p>
        <p style={{fontSize:12,marginTop:6}}>
          Bling: {o.bling_status==='registrado'?('pedido '+(o.bling_number||'localizado')):
            o.bling_status==='referencia_ausente'?'sem registro com a mesma referência':'aguardando verificação'}
        </p>
        <p style={{fontSize:12,marginTop:4}}>
          {o.status==='ja_enviado'?'Já exportado':
          o.status==='pendente_cadastro'?'Ajuste cadastral necessário':
          o.status==='validado_para_planejamento'?'Pagamento validado — sem envio':
          o.status==='duplicidade_detectada'?'Duplicidade: revisão obrigatória':
          'Aguardando conferência'}
          {o.requires_stock_review?' · Sob encomenda':''}
        </p>
        {(o.issues||[]).map((issue,i)=><p key={i}
          style={{fontSize:12,color:'#94542b',marginTop:4}}>{issue}</p>)}
        <button type="button" className="btn btn-white btn-sm"
          disabled={loading||!!checking||!!previewing} style={{marginTop:10}}
          onClick={()=>check(o.request_number)}>
          <RefreshCw size={14}/>{checking===o.request_number?
            'Consultando...':'Conferir pedido no Bling (sem envio)'}
        </button>
        <button type="button" className="btn btn-white btn-sm"
          disabled={loading||!!checking||!!previewing}
          style={{marginTop:9}} onClick={()=>previewPayload(o.request_number)}>
          <ShieldCheck size={14}/>{previewing===o.request_number?
            'Preparando...':'Prévia do pedido Bling (sem envio)'}
        </button>
        {payloads[o.request_number]&&<div style={{
          marginTop:10,padding:11,border:'1px solid #d9e5e0',
          borderRadius:10,background:'#fafcfb'}}>
          <strong style={{fontSize:12}}>Prévia técnica — não enviada</strong>
          <div className="detail-list" style={{marginTop:9}}>
            <div className="detail-item"><span>Referência</span>
              <strong>{payloads[o.request_number].reference}</strong></div>
            <div className="detail-item"><span>Pedido Bling</span>
              <strong>{payloads[o.request_number].already_exported?
                ('Já registrado • '+(payloads[o.request_number].bling_order_number||'conferir')):
                'Não enviado nesta prévia'}</strong></div>
            <div className="detail-item"><span>Valor</span>
              <strong>{payloads[o.request_number].amount!=null?
                money(payloads[o.request_number].amount):'Conferir'}</strong></div>
            <div className="detail-item"><span>Produtos</span>
              <strong>{payloads[o.request_number].item_count}</strong></div>
            <div className="detail-item"><span>Esta prévia foi enviada?</span>
              <strong>Não</strong></div>
          </div>
          {(payloads[o.request_number].issues||[]).map((issue,i)=>
            <p key={i} style={{fontSize:12,color:'#944b26',marginTop:7}}>{issue}</p>)}
          {payloads[o.request_number].valid&&
            <p style={{fontSize:12,color:'#17654e',marginTop:8}}>
              Estrutura validada localmente. Ainda exige homologação externa
              antes da ativação.
            </p>}
          <p className="muted" style={{fontSize:12,marginTop:8}}>
            {payloads[o.request_number].message}
          </p>
          <button type="button" className="btn btn-white btn-sm"
            style={{marginTop:10}}
            disabled={!!homologating||!!previewing||loading||!!checking}
            onClick={()=>homologate(o.request_number)}>
            <ShieldCheck size={14}/>
            {homologating===o.request_number?'Consultando...':
              'Homologar Asaas + Bling (sem envio)'}
          </button>
          {homologations[o.request_number]&&<div style={{marginTop:10,
            padding:10,border:'1px solid #d9e5e0',borderRadius:10}}>
            <strong style={{fontSize:12,color:homologations[o.request_number].external_verified?
              '#17654e':'#9b4e20'}}>
              {homologations[o.request_number].external_verified?
                'Homologação externa: aprovada':'Homologação externa: pendências'}
            </strong>
            {(homologations[o.request_number].external_checks||[]).map((s,i)=>
              <p key={i} style={{fontSize:12,marginTop:6}}>{s}</p>)}
            {(homologations[o.request_number].external_issues||[]).map((s,i)=>
              <p key={i} style={{fontSize:12,color:'#9b4e20',marginTop:6}}>{s}</p>)}
            <p className="muted" style={{fontSize:12,marginTop:8}}>
              Somente consultas GET. Nenhuma venda, cobrança, estoque ou NF-e alterado.
              A exportação automática permanece desativada.
            </p>
          </div>}
        </div>}
      </div>)}
      {!audit.orders?.length&&<p className="muted" style={{fontSize:12,marginTop:10}}>
        Nenhum pagamento de produção registrado no Neon.
      </p>}
      <p className="muted" style={{fontSize:12,marginTop:11}}>
        Nenhuma liberação de venda pública, automação de Bling, estoque ou NF-e nesta auditoria.
      </p>
    </div>}
  </div>;
}

function RecoveryBlingControl({onUpdated}){
  const [checked,setChecked]=React.useState(false);
  const [notFound,setNotFound]=React.useState(false);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [notice,setNotice]=React.useState('');
  async function call(action,extras={}){
    const res=await fetch('/.netlify/functions/bling-production-order-send',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action,...extras})
    });
    const body=await res.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
    if(!res.ok||!body.ok)throw Error(body.message||'Falha na verificação do Bling.');
    return body;
  }
  async function check(){
    setBusy(true);setError('');setNotice('');setNotFound(false);setChecked(false);
    try{
      const data=await call('reconcile');
      if(data.export_record)onUpdated(data.export_record);
      if(data.not_found===true){
        setNotFound(true);
        setNotice('API não encontrou a referência. Confira também o histórico no Bling antes de prosseguir.');
      }else{
        setNotice(data.message||'Consulta concluída. Não liberar nova tentativa.');
      }
    }catch(err){setError(err.message||'Não foi possível conferir o pedido.');}
    finally{setBusy(false);}
  }
  async function prepare(){
    if(!checked||!notFound||busy)return;
    if(!window.confirm('Você confirmou que NÃO existe pedido correspondente no Bling, conferindo referência, cliente, data, SKU e valor? Este procedimento NÃO faz novo envio.'))return;
    setBusy(true);setError('');
    try{
      const data=await call('prepare_recovery',{
        manual_checked:true,confirm_phrase:'CONFIRMO HOMOLOG-01 AUSENTE NO BLING'
      });
      if(data.export_record)onUpdated(data.export_record);
      setNotice(data.message||'Preparação concluída sem envio.');
      setNotFound(false);setChecked(false);
    }catch(err){setError(err.message||'A recuperação não foi autorizada.');}
    finally{setBusy(false);}
  }
  return <div style={{borderTop:'1px solid #dfe7e3',paddingTop:12,marginTop:12}}>
    <strong style={{fontSize:13}}>Recuperar tentativa bloqueada — sem envio</strong>
    <p className="muted" style={{fontSize:12,marginTop:7}}>
      Confirme a ausência no Bling: referência EC-HOMOLOG-01 e pedidos do mesmo
      cliente de 21/11/2026, com SKU 100388 e valor R$ 7,00.
      Se encontrar pedido correspondente, não autorize outro envio.
    </p>
    <button className="btn btn-white" disabled={busy} style={{marginTop:10}}
      type="button" onClick={check}>
      <RefreshCw size={15}/>{busy?'Consultando...':'Verificar ausência pela API (sem envio)'}
    </button>
    {notFound&&<div style={{marginTop:12}}>
      <label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12}}>
        <input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>
        Conferi também no painel Bling e não existe pedido correspondente.
      </label>
      <button type="button" className="btn btn-white" style={{marginTop:10}}
        disabled={busy||!checked} onClick={prepare}>
        <ShieldCheck size={15}/>Preparar única nova tentativa (sem enviar)
      </button>
    </div>}
    {notice&&<p className="muted" style={{fontSize:12,marginTop:9}}>{notice}</p>}
    {error&&<p className="form-error" style={{marginTop:9}}>{error}</p>}
  </div>;
}

// Cadastros feitos pelo próprio cliente em /cadastro: ficam aqui até aprovar.
// Aprovar cria o cliente e libera o acesso com a senha que ele escolheu.
function SignupApprovalsPanel({reload,version}){
  const [signups,setSignups]=React.useState([]);
  const [busy,setBusy]=React.useState('');
  const [error,setError]=React.useState('');
  const [boleto,setBoleto]=React.useState({});
  const [rejecting,setRejecting]=React.useState('');
  const [note,setNote]=React.useState('');
  const [approved,setApproved]=React.useState({});
  async function call(action,extra={}){
    const res=await fetch('/.netlify/functions/customer-portal',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action,...extra})
    });
    const data=await res.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
    if(!res.ok||data.ok!==true)throw Error(data.message||'Não foi possível concluir.');
    return data;
  }
  async function load(){
    try{const data=await call('admin_signups');setSignups(data.signups||[]);setError('');}
    catch(e){setError(e.message);}
  }
  // Recarrega ao abrir, quando a página é atualizada e ao voltar para a aba.
  React.useEffect(()=>{void load();},[version]);
  React.useEffect(()=>{
    const onFocus=()=>{void load();};
    window.addEventListener('focus',onFocus);
    return ()=>window.removeEventListener('focus',onFocus);
  },[]);
  async function approve(item){
    setBusy(item.id);setError('');
    try{
      const data=await call('admin_signup_approve',{id:item.id,allow_boleto:boleto[item.id]===true});
      toast.success(data.message||'Cadastro aprovado.');
      setApproved(a=>({...a,[item.id]:true}));
      await load();reload?.();
    }catch(e){toast.error(e.message);}
    finally{setBusy('');}
  }
  async function reject(item){
    setBusy(item.id);setError('');
    try{
      await call('admin_signup_reject',{id:item.id,note});
      toast.success('Cadastro recusado.');setRejecting('');setNote('');await load();
    }catch(e){toast.error(e.message);}
    finally{setBusy('');}
  }
  const welcome=item=>{
    const phone=String(item.phone||'').replace(/\D/g,'');
    const msg='Olá, '+(item.trade_name||item.legal_name)+'! Seu cadastro na Ever Clean foi aprovado. '+
      'Entre em '+SITE_URL+'/login com seu e-mail e a senha que você criou.';
    return 'https://wa.me/'+(phone.length>=10?'55'+phone:'')+'?text='+encodeURIComponent(msg);
  };
  const pending=signups.filter(x=>x.status==='pending');
  const reviewed=signups.filter(x=>x.status!=='pending');
  const doc=v=>{const d=String(v||'');return d.length===11?d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):
    d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');};
  return <section className="panel" style={{marginTop:0,marginBottom:14}}>
    <div className="panel-head"><div>
      <h2>Cadastros aguardando aprovação {pending.length>0&&<span className="badge orange" style={{marginLeft:6}}>{pending.length}</span>}</h2>
      <p className="muted" style={{fontSize:12,margin:'3px 0 0'}}>Feitos pelo próprio cliente em {SITE_URL.replace('https://','')}/cadastro. Ao aprovar, o cliente é criado e já pode entrar com a senha que escolheu.</p>
    </div>
    <button type="button" className="btn btn-white btn-sm" onClick={()=>void load()}><RefreshCw size={14}/>Atualizar</button></div>
    <div style={{padding:14,display:'grid',gap:12}}>
      {error&&<div className="form-error">{error}</div>}
      {!pending.length&&<div className="muted" style={{fontSize:13}}>Nenhum cadastro aguardando.</div>}
      {pending.map(item=><div key={item.id} style={{border:'1px solid #f1dcc0',background:'#fffaf3',borderRadius:14,padding:14}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
          <div style={{minWidth:0}}>
            <strong style={{fontSize:15}}>{item.trade_name||item.legal_name}</strong>
            {item.trade_name&&item.trade_name!==item.legal_name&&<div className="muted" style={{fontSize:12}}>{item.legal_name}</div>}
            <div style={{fontSize:12,marginTop:4}}>{doc(item.document)} · {item.email} · {item.phone}</div>
            <div className="muted" style={{fontSize:12,marginTop:3,overflowWrap:'anywhere'}}>{formatAddress(item.address)||'Sem endereço'}
              {item.state_registration?' · IE '+item.state_registration:''}</div>
            {item.notes&&<div style={{fontSize:12,marginTop:4,color:'#674d26'}}>Obs.: {item.notes}</div>}
          </div>
          <div className="muted" style={{fontSize:11}}>Enviado em {fmtDate(item.created_at)}</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:12}}>
          <label className="switch"><input type="checkbox" checked={boleto[item.id]===true}
            onChange={e=>setBoleto(b=>({...b,[item.id]:e.target.checked}))}/>Liberar boleto (30 dias)</label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy===item.id}
            onClick={()=>approve(item)}>{busy===item.id?'Aprovando…':'Aprovar cadastro'}</button>
          <button type="button" className="btn btn-white btn-sm" disabled={busy===item.id}
            onClick={()=>{setRejecting(rejecting===item.id?'':item.id);setNote('');}}>Recusar</button>
        </div>
        {rejecting===item.id&&<div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
          <input className="search" style={{flex:1,minWidth:200}} maxLength={240} value={note}
            placeholder="Motivo (opcional, uso interno)" onChange={e=>setNote(e.target.value)}/>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy===item.id}
            onClick={()=>reject(item)}>Confirmar recusa</button>
        </div>}
      </div>)}
      {reviewed.length>0&&<details>
        <summary style={{cursor:'pointer',fontSize:13,fontWeight:800,color:'#315047'}}>Analisados nos últimos 30 dias ({reviewed.length})</summary>
        <div style={{display:'grid',gap:8,marginTop:10}}>
          {reviewed.map(item=><div key={item.id} style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap',
            fontSize:12,borderTop:'1px solid #edf1f2',paddingTop:8}}>
            <span><strong>{item.trade_name||item.legal_name}</strong> · {item.email}</span>
            <span style={{display:'flex',gap:8,alignItems:'center'}}>
              <span className={'badge '+(item.status==='approved'?'green':'red')}>{item.status==='approved'?'Aprovado':'Recusado'}</span>
              {item.status==='approved'&&<a className="btn btn-white btn-sm" target="_blank" rel="noopener noreferrer"
                href={welcome(item)}>{approved[item.id]?'Avisar pelo WhatsApp':'WhatsApp'}</a>}
            </span>
          </div>)}
        </div>
      </details>}
    </div>
  </section>;
}

function CustomerPortalAdminPanel(){
  const [clients,setClients]=React.useState([]);
  const [search,setSearch]=React.useState('');
  const [selected,setSelected]=React.useState('');
  const [busy,setBusy]=React.useState('');
  const [invitation,setInvitation]=React.useState('');
  const [error,setError]=React.useState('');
  const [loaded,setLoaded]=React.useState(false);
  const base=SITE_URL+'/cliente';
  async function portalAdmin(action,extra={}){
    const res=await fetch('/.netlify/functions/customer-portal',{
      method:'POST',headers:{'Content-Type':'application/json',
        Authorization:'Bearer '+getTestToken()},
      body:JSON.stringify({action,...extra})
    });
    const data=await res.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
    if(!res.ok||data.ok!==true)throw Error(data.message||'Portal indisponível.');
    return data;
  }
  async function loadClients(){
    setBusy('load');setError('');
    try{const data=await portalAdmin('admin_clients');setClients(data.clients||[]);setLoaded(true)}
    catch(e){setError(e.message)}
    finally{setBusy('')}
  }
  React.useEffect(()=>{void loadClients()},[]);
  const options=clients.filter(c=>(c.name+' '+c.email).toLocaleLowerCase('pt-BR')
    .includes(search.toLocaleLowerCase('pt-BR'))).slice(0,100);
  const customer=clients.find(c=>c.id===selected);
  async function createInvitation(){
    if(!customer?.eligible||busy)return;
    if(!window.confirm('Gerar um convite INDIVIDUAL, válido por 48 horas, para '+
      customer.name+'? O convite não será enviado automaticamente.'))return;
    setBusy('invite');setError('');setInvitation('');
    try{
      const result=await portalAdmin('admin_invite',{customer_id:customer.id,confirm:true});
      setInvitation(result.invitation_url);
      toast.success('Convite criado. Copie e envie apenas ao contato verificado.');
      await loadClients();
    }catch(e){setError(e.message)}
    finally{setBusy('')}
  }
  async function disable(){
    if(!customer||busy||customer.status!=='active')return;
    if(!window.confirm('Desativar o acesso de '+customer.name+
      '? Todas as sessões do cliente serão encerradas.'))return;
    setBusy('disable');setError('');setInvitation('');
    try{
      await portalAdmin('admin_disable',{customer_id:customer.id,confirm:true});
      toast.success('Acesso do cliente desativado.');
      await loadClients();
    }catch(e){setError(e.message)}finally{setBusy('')}
  }
  async function copy(value){
    try{await navigator.clipboard.writeText(value);toast.success('Link copiado')}
    catch{toast.error('Não foi possível copiar o link.')}
  }
  return <section className="panel" style={{marginTop:16,padding:15,minWidth:0}}>
    <h2 style={{fontSize:19,marginBottom:7}}>Portal permanente do cliente</h2>
    <p className="muted" style={{fontSize:12,lineHeight:1.6}}>
      Uma única página para catálogo e histórico, com senha individual.
      Cada cliente deverá receber um convite único de ativação.
      Esta etapa é somente de consulta: não permite novos pagamentos ou pedidos automáticos.
    </p>
    <div style={{padding:12,background:'#f1f7f3',border:'1px solid #d4e6da',
      borderRadius:10,marginTop:12}}>
      <strong style={{fontSize:12}}>Endereço fixo para todos os clientes</strong>
      <p style={{fontSize:12,overflowWrap:'anywhere',marginTop:5}}>{base}</p>
      <button type="button" className="btn btn-white btn-sm" style={{marginTop:9}}
        onClick={()=>copy(base)}><Copy size={14}/>Copiar endereço do portal</button>
    </div>
    <div style={{display:'flex',gap:8,justifyContent:'space-between',
      flexWrap:'wrap',alignItems:'center',marginTop:13}}>
      <strong style={{fontSize:13}}>Controle de convites</strong>
      <button type="button" className="btn btn-white btn-sm"
        onClick={loadClients} disabled={!!busy}>
        <RefreshCw size={14}/>{busy==='load'?'Consultando...':'Atualizar clientes'}
      </button>
    </div>
    <input type="search" aria-label="Filtrar clientes para convite"
      placeholder="Filtrar cliente por nome ou e-mail" value={search}
      onChange={e=>setSearch(e.target.value)}
      style={{width:'100%',boxSizing:'border-box',border:'1px solid #d4e0d8',
        padding:11,borderRadius:9,marginTop:10}}/>
    <select aria-label="Escolher cliente para convite" value={selected}
      onChange={e=>{setSelected(e.target.value);setInvitation('');setError('')}}
      style={{width:'100%',boxSizing:'border-box',border:'1px solid #d4e0d8',
        padding:11,borderRadius:9,marginTop:9}}>
      <option value="">Selecione um cliente cadastrado</option>
      {options.map(c=><option key={c.id} value={c.id}>
        {c.name+' · '+(c.status==='active'?'Ativo':
          c.status==='disabled'?'Desativado':c.eligible?'Aguardando convite':'E-mail inválido/duplicado')}
      </option>)}
    </select>
    {loaded&&<p className="muted" style={{fontSize:11,marginTop:8}}>
      {clients.length} clientes cadastrados. O e-mail deve ser único para ativar o portal.
      Convites não são enviados automaticamente.
    </p>}
    {customer&&<div style={{padding:12,border:'1px solid #dce6de',
      borderRadius:10,marginTop:12}}>
      <strong style={{fontSize:14}}>{customer.name}</strong>
      <p style={{fontSize:12,color:'#556e61',overflowWrap:'anywhere',marginTop:6}}>
        {customer.email||'E-mail não cadastrado'} · {customer.status==='active'?
          'Acesso ativo':customer.status==='disabled'?'Acesso desativado':
          'Sem acesso ativo'}
      </p>
      {!customer.eligible&&<p style={{fontSize:12,color:'#9d5726',marginTop:8}}>
        Regularize o e-mail, que precisa ser válido e exclusivo deste cliente.
      </p>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
        <button type="button" className="btn btn-primary"
          disabled={!customer.eligible||!!busy} onClick={createInvitation}
          style={{whiteSpace:'normal'}}>
          <ShieldCheck size={16}/>{busy==='invite'?'Gerando convite...':
            customer.status==='active'?'Criar convite para redefinir senha':
            'Gerar convite de ativação (48h)'}
        </button>
        {customer.status==='active'&&<button type="button" className="btn btn-white"
          onClick={disable} disabled={!!busy}>
          <XCircle size={16}/>Desativar acesso
        </button>}
      </div>
    </div>}
    {invitation&&<div style={{border:'1px solid #bedcc9',borderRadius:10,
      padding:12,background:'#f1faf3',marginTop:12}}>
      <strong style={{fontSize:13,color:'#17664b'}}>Convite criado</strong>
      <p style={{fontSize:12,marginTop:7}}>
        Válido por 48 horas e utilizável apenas uma vez. Envie o link
        ao e-mail ou contato verificado do cliente por canal privado.
      </p>
      <textarea readOnly value={invitation} rows={3}
        onFocus={e=>e.target.select()}
        style={{boxSizing:'border-box',width:'100%',marginTop:9,
          padding:9,border:'1px solid #d5dfd8',borderRadius:9,fontSize:12}}/>
      <button className="btn btn-primary" type="button"
        onClick={()=>copy(invitation)} style={{marginTop:8}}>
        <Copy size={15}/>Copiar convite individual
      </button>
    </div>}
    {error&&<p className="form-error" style={{marginTop:12}}>{error}</p>}
  </section>;
}

function ProductionOrders(){
  const [orders,setOrders]=React.useState([]);
  const [busy,setBusy]=React.useState(true);
  const [error,setError]=React.useState('');
  const [paymentInspection,setPaymentInspection]=React.useState(null);
  const [paymentInspecting,setPaymentInspecting]=React.useState('');
  async function inspectPayment(requestNumber,attach=false){
    if(attach&&!window.confirm('Vincular SOMENTE a cobrança já existente no Asaas ao pedido EC-'+requestNumber+'? Nenhuma nova cobrança será criada.'))return;
    setPaymentInspecting(requestNumber);
    try{
      const session=getTestToken();
      if(!session)throw Error('Sessão administrativa expirada.');
      const response=await fetch('/.netlify/functions/asaas-production-recover-payment',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+session},
        body:JSON.stringify({action:attach?'attach_existing':'inspect',
          request_number:requestNumber,
          ...(attach?{confirmation:'VINCULAR COBRANCA EXISTENTE'}:{})})
      });
      const result=await response.json().catch(()=>({ok:false,message:'Consulta financeira indisponível.'}));
      if(!result.ok)throw Error(result.message||'Não foi possível verificar o pagamento.');
      setPaymentInspection({...result,request_number:requestNumber});
      if(attach){toast.success(result.message);await load();}
    }catch(e){setPaymentInspection({request_number:requestNumber,
      outcome:'error',can_attach:false,message:e.message||'Falha na consulta financeira.'});}
    finally{setPaymentInspecting('');}
  }
  const load=React.useCallback(async()=>{
    setBusy(true);
    try{
      const session=getTestToken();
      if(!session)throw Error('Sessão administrativa expirada.');
      const response=await fetch('/.netlify/functions/asaas-production-orders',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+session},
        body:JSON.stringify({action:'list'})
      });
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.ok)throw Error(result?.message||'Falha ao carregar pedidos de produção.');
      setOrders(Array.isArray(result.orders)?result.orders:[]);
      setError('');
    }catch(err){setError(err?.message||'Falha ao consultar o Neon.');}
    finally{setBusy(false);}
  },[]);
  React.useEffect(()=>{void load();},[load]);
  const realOrders=orders.filter(o=>/^\d{1,10}$/.test(String(o.request_number||'')));
  const moneyReceived=realOrders.filter(x=>x.status==='paid').reduce((a,o)=>a+Number(o.amount||0),0);
  return <>
    <Hero eyebrow="PEDIDOS • PRODUÇÃO" title="Pedidos de Venda"
      text="Pedidos reais recebidos pelo Asaas e acompanhados no Bling. Notas fiscais emitidas no Bling são entregues ao cliente pelo catálogo."
      onRefresh={load}/>
    {error&&<div className="form-error">{error}</div>}
    <div className="grid-stats" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>
      <div className="stat"><small>Pedidos reais listados</small><strong>{realOrders.length}</strong></div>
      <div className="stat"><small>Recebido (pedidos listados)</small><strong style={{fontSize:21}}>{money(moneyReceived)}</strong></div>
    </div>
    {/* Pedidos com acompanhamento para o cliente (etapas e comentários). */}
    {/* Solicitações feitas pelo cliente no portal (antes só em uma tela sem menu). */}
    <CustomerOrderRequestsPanel/>
    <ProductionOrdersPanel/>
    <details className="panel" style={{marginTop:16}}>
      <summary style={{padding:'14px 16px',cursor:'pointer',fontWeight:700}}>
        Tabela completa e conferência de pagamentos
      </summary>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Pagamento</th><th>Bling</th><th>Atendimento</th><th>Recebimento</th><th>NF-e / Observações</th></tr></thead>
        <tbody>{realOrders.map(o=><tr key={o.request_number}>
          <td><strong>{orderCode(o.request_number)}</strong></td>
          <td>{o.customer_name||'Cliente'}</td>
          <td>{fmtDate(o.created_at)}</td>
          <td><strong>{money(o.amount)}</strong></td>
          <td><Status value={o.status}/>
            {o.status==='manual_review'&&<button className="btn btn-white btn-sm"
              type="button" disabled={!!paymentInspecting}
              onClick={()=>inspectPayment(o.request_number)}
              style={{marginTop:7,whiteSpace:'normal'}}>
              <ShieldCheck size={14}/>
              {paymentInspecting===o.request_number?'Consultando...':'Conferir cobrança no Asaas'}
            </button>}
          </td>
          <td>{o.bling_export_confirmed?<span style={{color:'#17654e'}}>Registrado · {o.bling_order_number||o.bling_order_id}</span>:
             <span style={{color:'#9a641f'}}>{o.bling_export_state||
               (o.bling_issue?.issues?.length?'Pendente: '+o.bling_issue.issues.join(' '):'Aguardando integração')}</span>}</td>
          <td>{o.requires_stock_review?'Conferir estoque':'Atendimento normal'}</td>
          <td style={{minWidth:160,fontSize:12}}>
            {Number(o.amount)<100?
              <strong style={{color:'#98611d'}}>Retirada na empresa ou entrega a combinar</strong>:
              <span>Elegível para entrega, mediante confirmação</span>}
          </td>
          <td style={{maxWidth:280,overflowWrap:'anywhere'}}>
            {o.invoice_requested?
              <div><strong>Nota fiscal solicitada (manual)</strong>
                <div className="muted" style={{fontSize:11}}>
                  {o.invoice_channel==='whatsapp'?'WhatsApp':'E-mail'}: {o.invoice_contact||'Contato não informado'}
                </div>
              </div>:
              <span className="muted">Sem solicitação de NF-e</span>}
            {o.customer_notes&&<div style={{fontSize:12,marginTop:5}}>
              <strong>Observações:</strong> {o.customer_notes}
            </div>}
          </td>
        </tr>)}</tbody>
      </table>
      {!busy&&!orders.length&&!error&&<div className="empty">Nenhum pedido de produção encontrado.</div>}
      {busy&&<div className="empty">Consultando pedidos reais...</div>}
      </div>
    </details>
    {paymentInspection&&<section className="panel" role="status"
      style={{padding:18,marginTop:16,border:'1px solid #c4dcd2'}}>
      <h2 style={{fontSize:17}}>Conferência do pedido {orderCode(paymentInspection.request_number)}</h2>
      <p style={{fontSize:13,marginTop:10,lineHeight:1.6}}>
        {paymentInspection.message}
      </p>
      {paymentInspection.outcome==='located'&&<div style={{fontSize:12,marginTop:10}}>
        Estado no Asaas: <strong>{paymentInspection.provider_status||'Em conferência'}</strong>.
        {paymentInspection.paid?' Pagamento já confirmado.':''}
      </div>}
      {paymentInspection.outcome==='not_found'&&
        <p style={{fontSize:12,marginTop:10,color:'#9a641f'}}>
          A ausência nesta consulta não autoriza gerar automaticamente outra cobrança.
          Verifique a referência no painel do Asaas antes de emitir novo link.
        </p>}
      {paymentInspection.can_attach&&
        <button type="button" className="btn btn-primary" disabled={!!paymentInspecting}
          style={{marginTop:14}} onClick={()=>inspectPayment(paymentInspection.request_number,true)}>
          <ShieldCheck size={16}/> Vincular cobrança existente (sem gerar outra)
        </button>}
      <button type="button" className="btn btn-white" style={{marginTop:12}}
        onClick={()=>setPaymentInspection(null)}>Fechar conferência</button>
    </section>}
    <p className="muted" style={{fontSize:12,marginTop:12}}>
      Histórico antigo de testes permanece preservado. Pedidos reais são conciliados por webhook; não repetir cobranças nem exportações.
    </p>
  </>;
}

function Links({data,reload}){
  const [live,setLive]=React.useState([]);
  const [loading,setLoading]=React.useState(true);
  const [liveError,setLiveError]=React.useState('');
  const loadLive=React.useCallback(async()=>{
    setLoading(true);
    try{
      const result=await productionLinksApi('list');
      if(!result.ok){setLiveError(result.message||'Não foi possível consultar links de produção.');return;}
      setLive(Array.isArray(result.links)?result.links:[]);
      setLiveError('');
    }catch(error){setLiveError(error?.message||'Não foi possível consultar links de produção.');}
    finally{setLoading(false);}
  },[]);
  React.useEffect(()=>{void loadLive();},[loadLive]);
  async function refresh(){await Promise.all([reload(),loadLive()]);}
  async function copy(url){
    try{await navigator.clipboard.writeText(url);toast.success('Link copiado');}
    catch{toast.error('Não foi possível copiar o link.');}
  }
  async function cancelProduction(link){
    if(!window.confirm('Cancelar o link de produção '+orderCode(link.request_number)+'? Pedidos já cobrados não serão alterados.'))return;
    const res=await productionLinksApi('cancel',{id:link.id});
    if(!res.ok){toast.error(res.message);return;}
    toast.success('Link de produção cancelado');
    await loadLive();
  }
  return <>
    <Hero eyebrow="PAGAMENTOS REAIS • PRODUÇÃO" title="Links de Pedido"
      text="Novos links usam Asaas Produção, com pagamento PIX confirmado pelo comprador. Histórico de testes separado."
      onRefresh={refresh}/>
    <section className="panel">
      <div className="panel-head"><h2>Links de produção</h2>
        <span className="muted" style={{fontSize:12}}>Asaas real · Bling integrado</span>
      </div>
      {liveError&&<div className="form-error" style={{margin:16}}>{liveError}</div>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Solicitação</th><th>Cliente</th><th>Criado</th><th>Vencimento</th><th>Status do link</th><th style={{textAlign:'right'}}>Ações</th></tr></thead>
          <tbody>{live.map(link=><tr key={link.id}>
            <td><strong>{orderCode(link.request_number)}</strong></td>
            <td>{link.customer_name}</td>
            <td>{fmtDate(link.created_at)}</td>
            <td>{fmtDate(link.expires_at)}</td>
            <td><Status value={link.status}/></td>
            <td><div className="actions">
              <button className="icon-btn" title="Copiar link real" onClick={()=>copy(link.url)}><Copy size={15}/></button>
              <button className="icon-btn" title="Abrir checkout real" onClick={()=>window.open(link.url,'_blank','noopener,noreferrer')}><ExternalLink size={15}/></button>
              {link.status==='prepared'&&<button className="icon-btn" title="Cancelar link ainda não utilizado"
                onClick={()=>cancelProduction(link)}><XCircle size={15}/></button>}
            </div></td>
          </tr>)}</tbody>
        </table>
        {!loading&&!live.length&&!liveError&&
          <div className="empty">Nenhum link de produção encontrado. Abra Clientes e toque em Gerar link.</div>}
        {loading&&<div className="empty">Consultando links reais...</div>}
      </div>
    </section>
    <section className="panel" style={{marginTop:18}}>
      <div className="panel-head"><h2>Arquivo de testes — Sandbox</h2>
        <span className="muted" style={{fontSize:12}}>Somente histórico · novas cobranças desativadas</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Solicitação</th><th>Cliente</th><th>Criado</th><th>Status histórico</th></tr></thead>
          <tbody>{data.links.filter(link=>link.checkout_mode!=='production').map(link=>
            <tr key={link.id}><td>{orderCode(link.request_number)}</td><td>{link.customer_name}</td>
              <td>{fmtDate(link.created_at)}</td><td><Status value={link.status}/></td>
            </tr>)}</tbody>
        </table>
      </div>
    </section>
  </>;
}
