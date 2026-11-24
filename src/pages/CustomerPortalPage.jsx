import React from 'react';
import {Link,Navigate,useNavigate,useParams} from 'react-router-dom';
import {ShoppingCart,PackageCheck,LockKeyhole,LogOut,Copy,RefreshCw,ShieldCheck,Search,Minus,Plus,ArrowLeft,Trash2,RotateCcw} from 'lucide-react';
import SuggestedProductsCarousel from '../components/SuggestedProductsCarousel.jsx';
import {CatalogSearchFilters,CatalogProductGrid,CatalogCartItems,CatalogCartBar} from '../components/UnifiedCatalog.jsx';
import {findReusableApprovedRequest} from '../lib/approvedRequest.js';
import CheckoutSteps from '../components/CheckoutSteps.jsx';
import PaymentMethodPicker,{paymentName} from '../components/PaymentMethodPicker.jsx';
import {FULFILLMENT_LABELS,normalizeStage} from '../lib/fulfillment.js';

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
// Cobrança do pedido aprovado (mesma API da página do pedido).
async function productionCall(action,token,body={}){
  const response=await fetch('/.netlify/functions/asaas-catalog-production',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,token,...body})
  });
  const result=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
  if(!response.ok||result?.ok!==true)
    throw Error(result.message||'Não foi possível gerar o pagamento.');
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
      <p style={{fontSize:12,marginTop:18}}><Link to="/login">Já tenho acesso ao portal</Link></p>
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
  // Fluxo simplificado: conferir → forma de pagamento → pagar.
  const [cartChecked,setCartChecked]=React.useState(false);
  const [payBusy,setPayBusy]=React.useState(false);
  const [payStage,setPayStage]=React.useState('');
  const products=Array.isArray(data.products)?data.products:[];
  const orders=Array.isArray(data.orders)?data.orders:[];
  // Só o que interessa ao cliente: pedidos pagos (ou com pagamento em
  // aberto e link válido) e solicitações ainda não pagas.
  const visibleOrders=orders.filter(o=>o.status==='paid'||o.released||o.order_url);
  const requests=Array.isArray(data.requests)?data.requests:[];
  // Solicitação que já virou pedido aparece só na lista de pedidos.
  const orderNumbers=new Set(visibleOrders.map(o=>String(o.request_number)));
  const openRequests=requests.filter(r=>!r.checkout_paid&&!orderNumbers.has(String(r.checkout_number||'')));
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
  // Só reaproveita aprovação ainda aberta; pedido já pago permite novo pedido.
  const matchingApprovedRequest=findReusableApprovedRequest(requests,selected,qty);
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
  const paymentMethods=Array.isArray(data.payment_methods)&&data.payment_methods.length?
    data.payment_methods:['pix'];
  const canPayNow=Boolean(matchingApprovedRequest)||readyWithoutReview;
  const units=selected.reduce((n,p)=>n+Number(qty[p.id]||0),0);
  const total=selected.reduce((n,p)=>n+
    Number(qty[p.id]||0)*Math.round(Number(p.price||0)*100),0)/100;
  const belowMinimum=Math.round(total*100)<500;
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
    setRequestError('');setRequestReceipt(null);setCartChecked(false);
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
    setQty(draft);setRequestKey(crypto.randomUUID());setCartChecked(false);goto('draft');
    setNotice(missing?
      missing+' item(ns) do pedido anterior não constam no catálogo disponível.':
      'Carrinho preenchido com o pedido anterior. Confira preços e quantidades atuais.');
  }
  function selectPayment(request){
    setPaymentRequestId(request.id);
    setPaymentMethod('');
    setPaymentError('');
  }
  async function openApprovedPayment(request){
    if(paymentBusy||request.status!=='quoted')return;
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
      <div style={{padding:'12px 9px',border:'1px solid #92c6b5',
        borderRadius:9,marginTop:12,background:'#effaf5',
        fontSize:13,color:'#225a4b'}}>
        No próximo passo, você poderá escolher PIX ou boleto,
        quando habilitado no seu cadastro.
      </div>
      {paymentError&&<p role="alert" style={{fontSize:12,
        padding:9,background:'#fff1e9',color:'#923c2e',borderRadius:8,
        marginTop:9}}>{paymentError}</p>}
      <button type="button" className="btn btn-primary"
        style={{width:'100%',justifyContent:'center',marginTop:12,
          whiteSpace:'normal',textAlign:'center'}}
        onClick={()=>openApprovedPayment(request)}
        disabled={paymentBusy}>
        <LockKeyhole size={15}/>{paymentBusy?
          'Abrindo pagamento...':'Continuar para pagamento'}
      </button>
      <button type="button" className="btn btn-white btn-sm"
        disabled={paymentBusy} style={{width:'100%',marginTop:8}}
        onClick={()=>{setPaymentRequestId(null);setPaymentError('')}}>
        Voltar
      </button>
      <p style={{fontSize:11,color:'#60716a',marginTop:9}}>
        O pagamento é solicitado somente após sua confirmação.
        Confira os valores antes de continuar.
      </p>
    </div>;
  }
  // Um único botão: registra o pedido, prepara o link e gera a cobrança na
  // forma escolhida; depois abre a página do pedido já na etapa de pagar.
  // Se houver item sem estoque, o pedido vai para confirmação da equipe.
  async function finishOrder(){
    if(!cartChecked||payBusy||!selected.length)return;
    if(belowMinimum){
      setRequestError('Pedido mínimo R$ 5,00. Adicione mais '+money((500-Math.round(total*100))/100)+' em produtos.');
      return;
    }
    if(invoiceRequested&&(!invoiceContact.trim()||
      (invoiceChannel==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceContact.trim()))||
      (invoiceChannel==='whatsapp'&&!/^\+?[0-9()\s-]{10,25}$/.test(invoiceContact.trim())))){
      setRequestError('Confira o contato informado para a nota fiscal.');return;
    }
    const invoice={invoice_requested:invoiceRequested,
      invoice_channel:invoiceRequested?invoiceChannel:null,
      invoice_contact:invoiceRequested?invoiceContact.trim():null};
    setPayBusy(true);setRequestError('');setPayStage('Registrando seu pedido...');
    try{
      let request=matchingApprovedRequest;
      if(!request){
        const result=await portalApi('submit_request',{
          idempotency_key:requestKey,
          items:selected.map(product=>({product_id:String(product.id),
            quantity:Number(qty[product.id]||0)})),
          notes:notes.trim(),...invoice
        });
        request=result.request;
        if(!request?.request_number)throw Error('Pedido sem protocolo. Consulte "Meus pedidos".');
        setRequestKey(crypto.randomUUID());
        if(!(request.status==='quoted'&&result.ready_for_payment===true)){
          setRequestReceipt(request);
          setQty({});setNotes('');setInvoiceRequested(false);setInvoiceContact('');setCartChecked(false);
          goto('history');
          setNotice('Pedido '+request.request_number+' enviado para confirmação de estoque. '+
            'Você poderá pagar assim que a equipe liberar.');
          await onRefresh();
          return;
        }
      }
      setPayStage('Preparando o pagamento...');
      const prepared=await portalApi('prepare_approved_payment',{request_id:request.id});
      const target=new URL(prepared.url,window.location.origin);
      if(target.origin!==window.location.origin||
        !/^\/pedido-producao\/[a-f0-9]{64}$/.test(target.pathname))
        throw Error('O endereço de pagamento retornado é inválido.');
      const token=target.pathname.split('/').pop();
      setPayStage('Gerando a cobrança...');
      const created=await productionCall('create_payment',token,{
        items:(request.items||[]).map(i=>({product_id:String(i.product_id),quantity:Number(i.quantity)})),
        payment_method:paymentMethod,notes:notes.trim(),
        expected_amount_cents:Math.round(Number(request.amount)*100),...invoice
      });
      // Pedido que já tinha cobrança: só ajusta a forma escolhida.
      if(created.already)await productionCall('change_payment',token,
        {payment_method:paymentMethod}).catch(()=>{});
      setPayStage('Abrindo o pagamento...');
      window.location.assign(target.pathname);
    }catch(error){
      setRequestError((error.message||'Não foi possível concluir.')+
        ' Confira "Meus pedidos" antes de tentar novamente.');
      setPayStage('');setPayBusy(false);
      onRefresh().catch(()=>{});
    }
  }
  async function sendRequest(){
    if(!selected.length||requestBusy||!data.request_enabled||matchingApprovedRequest)return;
    if(Math.round(total*100)<500){
      setRequestError('Pedido mínimo R$ 5,00. Adicione mais '+money((500-Math.round(total*100))/100)+' em produtos.');
      return;
    }
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
  const tabs=[{id:'products',title:'Catálogo'},{id:'history',title:'Meus pedidos ('+(visibleOrders.length+openRequests.length)+')'},
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
              'Recebemos sua solicitação. A equipe Ever Clean conferirá os produtos e informará os próximos passos.'}
          </p>
        </div>}
        {openRequests.length>0&&<div style={{display:'grid',gap:11,marginBottom:19}}>
          <h3 style={{fontSize:16,margin:'3px 0'}}>Solicitações em andamento</h3>
          {openRequests.map(request=><article key={request.id} style={{border:'1px solid #dce8df',
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
                    request.checkout_payment_state==='payment_pending'?'Aguardando pagamento':
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
              request.checkout_payment_state!=='payment_pending'&&
              <p style={{fontSize:12,
              color:'#426456',marginTop:7,lineHeight:1.45}}>
              {request.approval_source==='automatic_stock'?
                'Estoque confirmado. Toque em "Pagar este pedido" para concluir.':
                'Pedido liberado pela equipe. Toque em "Pagar este pedido" para concluir.'}
            </p>}
            {(request.items||[]).map((item,index)=><div key={index} style={{fontSize:12,
              padding:'4px 0'}}>{item.quantity} × {item.name}</div>)}
            {request.checkout_paid?
              <div role="status" style={{marginTop:12,padding:12,
                border:'1px solid #b9ddc9',borderRadius:10,
                background:'#eaf7ee',fontSize:13,color:'#15583f'}}>
                <strong>Pagamento recebido · Pedido EC-{request.checkout_number}</strong>
                <p style={{marginTop:6,fontSize:12}}>
                  Pagamento confirmado! Seu pedido foi recebido e pode ser acompanhado abaixo.
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
                    whiteSpace:'normal'}} disabled={paymentBusy}
                  onClick={()=>request.checkout_payment_state==='payment_pending'?
                    openApprovedPayment(request):repeat({items:request.items})}>
                  <ShoppingCart size={16}/>{request.checkout_payment_state==='payment_pending'?
                    (paymentBusy?'Abrindo...':'Continuar pagamento'):'Pagar este pedido'}
                </button>
                {paymentError&&<p role="alert" style={{fontSize:12,color:'#923c2e',marginTop:8}}>
                  {paymentError}</p>}
              </>:<button type="button" className="btn btn-white btn-sm"
                style={{marginTop:10}} onClick={()=>repeat({items:request.items})}>
                <RotateCcw size={15}/>Fazer novo pedido com estes itens
              </button>}
          </article>)}
        </div>}
        {!visibleOrders.length&&!openRequests.length&&<div className="muted" style={{fontSize:13,padding:'8px 0'}}>
          Nenhum pedido registrado neste cadastro.
        </div>}
        <div style={{display:'grid',gap:12}}>
          {visibleOrders.length>0&&<h3 style={{fontSize:16,margin:'3px 0'}}>Pedidos</h3>}
          {visibleOrders.map((order,i)=>{
            // Boleto a prazo liberado: acompanha como pago, mostrando o vencimento.
            const released=order.released===true;
            const paid=order.status==='paid'||released;
            const due=String(order.payment_due_date||'').slice(0,10).split('-').reverse().join('/');
            const items=order.items||[];
            const summary=items.slice(0,2).map(item=>item.quantity+' × '+item.name).join(' · ')+
              (items.length>2?' · +'+(items.length-2)+' item(ns)':'');
            return <article key={order.request_number+'-'+i}
              style={{border:'1px solid #e0e8e5',borderRadius:12,padding:13,background:'#fff'}}>
              <div style={{display:'flex',gap:9,justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{minWidth:0}}>
                  {order.order_url?<Link to={order.order_url} style={{color:'#0b4f48',
                    textDecoration:'underline',textUnderlineOffset:3}}>
                    <strong>EC-{order.request_number}</strong></Link>:
                    <strong>EC-{order.request_number}</strong>}
                  <div className="muted" style={{fontSize:12,marginTop:3}}>{dateText(order.created_at)}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <strong style={{fontSize:16,color:'#0b4f48'}}>{money(order.amount)}</strong>
                  <div style={{fontSize:12,marginTop:3,color:paid?'#17654e':'#976522'}}>
                    {paid?(FULFILLMENT_LABELS[normalizeStage(order.fulfillment_stage)]||'Pedido recebido'):
                      'Aguardando pagamento'}</div>
                  {released&&<div style={{fontSize:11,marginTop:2,color:'#976522'}}>
                    Boleto a prazo{due.length===10?' · vence '+due:''}</div>}
                </div>
              </div>
              {summary&&<div style={{fontSize:12,color:'#48685d',marginTop:8,overflowWrap:'anywhere'}}>{summary}</div>}
              {paid&&order.invoice&&<div style={{fontSize:12,color:'#17654e',marginTop:6,fontWeight:700}}>
                Nota fiscal nº {order.invoice.number} disponível</div>}
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:11}}>
                {order.order_url&&<Link to={order.order_url} className="btn btn-primary btn-sm">
                  <PackageCheck size={15}/>{paid?'Acompanhar pedido':'Continuar pagamento'}
                </Link>}
                <button type="button" className="btn btn-white btn-sm" onClick={()=>repeat(order)}>
                  <RotateCcw size={15}/>Repetir pedido
                </button>
              </div>
            </article>;
          })}
        </div>
      </section>}
      {tab==='draft'&&<>
        <CheckoutSteps current={!selected.length?0:cartChecked?2:1}/>
        <button className="btn btn-white" type="button" onClick={()=>goto('products')}
          style={{marginBottom:14}} disabled={payBusy}><ArrowLeft size={16}/>Voltar aos produtos</button>
        <section className="order-intro">
          <span className="eyebrow"><ShoppingCart size={14}/> CARRINHO</span>
          <h1>Confira e pague</h1>
          <p>Confira os produtos e o valor, escolha a forma de pagamento e conclua.</p>
        </section>
        <CatalogCartItems selected={selected} quantities={qty}
          onQuantityChange={changeQty} total={total}/>
        {!selected.length&&<div className="empty">Seu carrinho está vazio.
          <button type="button" className="btn btn-primary btn-sm" style={{marginTop:10}}
            onClick={()=>goto('products')}>Escolher produtos</button></div>}
        {total>0&&belowMinimum&&<p role="alert"
          style={{background:'#fff8e8',border:'1px solid #ead9ac',
            padding:13,borderRadius:11,fontSize:13,color:'#865c1c',
            lineHeight:1.5,marginTop:12}}>
          <strong>Pedido mínimo: R$ 5,00.</strong>
          {' '}Adicione mais {money((500-Math.round(total*100))/100)} em produtos.
        </p>}
        {selected.length>0&&<section className="panel" style={{padding:16,marginTop:14}}>
          <h2 style={{fontSize:17,marginBottom:10}}>1. Conferência</h2>
          <label style={{display:'flex',gap:10,alignItems:'flex-start',fontSize:14,
            lineHeight:1.45,cursor:'pointer'}}>
            <input type="checkbox" checked={cartChecked} disabled={payBusy}
              onChange={e=>setCartChecked(e.target.checked)}
              style={{width:20,height:20,marginTop:1,flex:'none'}}/>
            <span>Conferi os produtos, as quantidades e o valor total de
              {' '}<strong>{money(total)}</strong>.</span>
          </label>
          <p style={{fontSize:12,color:'#5a706a',marginTop:9}}>
            {total<100?'Abaixo de R$ 100,00: retirada na empresa ou entrega a combinar.':
              'A partir de R$ 100,00: entrega mediante confirmação de prazo.'}
          </p>
        </section>}
        {selected.length>0&&<section className="panel" style={{padding:16,marginTop:14}}>
          <h2 style={{fontSize:17,marginBottom:10}}>2. Forma de pagamento</h2>
          {canPayNow?<PaymentMethodPicker methods={paymentMethods} value={paymentMethod}
              onChange={setPaymentMethod} disabled={payBusy} boletoDays={data.boleto_due_days}
              name="portal-payment-method"/>:
            stockBusy?<p role="status" style={{fontSize:13,color:'#5a706a'}}>
              Conferindo disponibilidade no estoque...</p>:
            <div role="status" style={{fontSize:13,lineHeight:1.5,color:'#7a5a1e',
              background:'#fff8e8',border:'1px solid #ead9ac',borderRadius:11,padding:12}}>
              {stockError?'Não foi possível confirmar o estoque agora. '+stockError:
                'Alguns itens precisam de confirmação de estoque. Envie o pedido para a equipe: '+
                'assim que for liberado, você paga em "Meus pedidos".'}
            </div>}
          <details style={{marginTop:14}} open={Boolean(notes||invoiceRequested)}>
            <summary style={{fontSize:13,fontWeight:700,cursor:'pointer',color:'#205640'}}>
              Observações e nota fiscal (opcional)
            </summary>
            <label style={{fontSize:13,display:'block',marginTop:10}}>
              Observações sobre entrega ou local
              <textarea value={notes} onChange={e=>setNotes(e.target.value)}
                maxLength={1500} rows={3} disabled={payBusy}
                placeholder="Horário de recebimento, endereço de entrega, referência..."
                style={{width:'100%',boxSizing:'border-box',padding:12,
                  border:'1px solid #d3e0d9',borderRadius:10,marginTop:7}}/>
            </label>
            <label style={{display:'flex',alignItems:'center',gap:9,
              fontSize:13,marginTop:12}}>
              <input type="checkbox" checked={invoiceRequested} disabled={payBusy}
                onChange={e=>setInvoiceRequested(e.target.checked)}/>
              Quero nota fiscal
            </label>
            {invoiceRequested&&<div style={{marginTop:10,display:'grid',gap:9}}>
              <select value={invoiceChannel} disabled={payBusy}
                onChange={e=>{setInvoiceChannel(e.target.value);setInvoiceContact('')}}
                style={{width:'100%',padding:10,border:'1px solid #d3e0d9',borderRadius:9}}>
                <option value="email">Receber por e-mail</option>
                <option value="whatsapp">Receber por WhatsApp</option>
              </select>
              <input value={invoiceContact} maxLength={200} disabled={payBusy}
                type={invoiceChannel==='email'?'email':'tel'}
                onChange={e=>setInvoiceContact(e.target.value)}
                placeholder={invoiceChannel==='email'?'seu@email.com':'(67) 99999-9999'}
                style={{width:'100%',padding:10,boxSizing:'border-box',
                  border:'1px solid #d3e0d9',borderRadius:9}}/>
            </div>}
          </details>
        </section>}
        {selected.length>0&&<section className="panel" style={{padding:16,marginTop:14}}>
          {requestError&&<p role="alert" style={{fontSize:13,color:'#a83d2b',
            padding:10,background:'#fff4f0',borderRadius:9,marginBottom:10}}>{requestError}</p>}
          {payStage&&<p role="status" style={{fontSize:13,color:'#175f50',marginBottom:10}}>{payStage}</p>}
          <button type="button" className="btn btn-primary" onClick={finishOrder}
            disabled={!cartChecked||payBusy||stockBusy||belowMinimum||
              !data.request_enabled||(canPayNow&&!paymentMethods.includes(paymentMethod))}
            style={{width:'100%',justifyContent:'center',whiteSpace:'normal',
              padding:'15px 12px',fontSize:16,
              opacity:!cartChecked||payBusy||stockBusy||belowMinimum?0.55:1}}>
            <LockKeyhole size={17}/>
            {payBusy?'Processando...':canPayNow?
              'Pagar '+money(total)+' com '+paymentName(paymentMethod):
              'Enviar pedido para confirmação de estoque'}
          </button>
          {!cartChecked&&<p style={{fontSize:12,color:'#5a706a',marginTop:8,textAlign:'center'}}>
            Marque a conferência para continuar.</p>}
          <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
            <button type="button" className="btn btn-white btn-sm" onClick={copyDraft}
              disabled={payBusy} style={{flex:1,justifyContent:'center'}}>
              <Copy size={15}/>Copiar resumo
            </button>
            <button type="button" className="btn btn-white btn-sm" disabled={payBusy}
              onClick={()=>{setQty({});setRequestKey(crypto.randomUUID());
                setRequestError('');setNotice('Carrinho limpo.')}}
              style={{flex:1,justifyContent:'center'}}>
              <Trash2 size={15}/>Limpar carrinho
            </button>
          </div>
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
        busy={busy}/>:<Navigate to="/login" replace/>}
    {error&&!kind&&<div role="alert" style={{...outer,color:'#963e2a',fontSize:13}}>
      {error}
    </div>}
  </div>;
}
