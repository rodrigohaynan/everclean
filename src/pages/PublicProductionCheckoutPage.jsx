import React from 'react';
import {Link,useParams} from 'react-router-dom';
import {ShieldCheck,LockKeyhole,ShoppingCart,RefreshCw,ArrowLeft,RotateCcw,Clock3,CreditCard,FileText,Mail,MessageCircle,Copy} from 'lucide-react';
import {CatalogSearchFilters,CatalogProductGrid,CatalogCartItems,CatalogCartBar} from '../components/UnifiedCatalog.jsx';
import SuggestedProductsCarousel from '../components/SuggestedProductsCarousel.jsx';

const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const PAYMENT_OPTIONS={
  pix:{label:'PIX',hint:'QR Code ou Copia e Cola, confirmação na hora.'},
  boleto:{label:'Boleto',hint:'Vencimento conforme o prazo do seu cadastro.'},
  cartao:{label:'Cartão de crédito',hint:'Pagamento na página segura do Asaas.'},
  link:{label:'Link de pagamento',hint:'Página do Asaas para você escolher como pagar.'}
};
const formatDate=value=>{
  const parts=String(value||'').slice(0,10).split('-');
  return parts.length===3?parts.reverse().join('/'):'';
};
async function productionApi(action,token,extra={}){
  const response=await fetch('/.netlify/functions/asaas-catalog-production',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,token,...extra})
  });
  const body=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
  if(!response.ok||!body?.ok)throw Error(body.message||'Não foi possível consultar este pedido.');
  return body;
}
export default function PublicProductionCheckoutPage(){
  const {token}=useParams();
  const portalHref='/cliente/acesso/production/'+encodeURIComponent(token||'');
  const [catalog,setCatalog]=React.useState(null);
  const [quantities,setQuantities]=React.useState({});
  const [search,setSearch]=React.useState('');
  const [category,setCategory]=React.useState('Todos');
  const [step,setStep]=React.useState('catalog');
  const [cartNotice,setCartNotice]=React.useState('');
  // Escolha explícita antes de qualquer cobrança real: nenhum método pré-marcado.
  const [paymentMethod,setPaymentMethod]=React.useState('');
  const [invoiceRequested,setInvoiceRequested]=React.useState(false);
  const [invoiceChannel,setInvoiceChannel]=React.useState('email');
  const [invoiceContact,setInvoiceContact]=React.useState('');
  const [notes,setNotes]=React.useState('');
  const [quote,setQuote]=React.useState(null);
  const [validation,setValidation]=React.useState(null);
  const [payment,setPayment]=React.useState(null);
  const [pix,setPix]=React.useState(null);
  const [boleto,setBoleto]=React.useState(null);
  const [boletoLoading,setBoletoLoading]=React.useState(false);
  const [boletoError,setBoletoError]=React.useState('');
  const [pixLoading,setPixLoading]=React.useState(false);
  const [pixError,setPixError]=React.useState('');
  const [pixCopied,setPixCopied]=React.useState(false);
  const [status,setStatus]=React.useState(null);
  const [statusReady,setStatusReady]=React.useState(false);
  const [loading,setLoading]=React.useState('');
  const [error,setError]=React.useState('');
  const [confirmed,setConfirmed]=React.useState(false);
  const [submitLocked,setSubmitLocked]=React.useState(false);
  const [autoStatusError,setAutoStatusError]=React.useState('');
  // Cartão ou link: página segura do Asaas da mesma cobrança.
  const [invoice,setInvoice]=React.useState(null);
  const [invoiceLoading,setInvoiceLoading]=React.useState(false);
  const [invoiceError,setInvoiceError]=React.useState('');
  // Troca da forma de pagamento depois da cobrança criada.
  const [changeOpen,setChangeOpen]=React.useState(false);
  const [changing,setChanging]=React.useState('');
  const [changeMessage,setChangeMessage]=React.useState('');
  const [changeError,setChangeError]=React.useState('');
  // Voltou da página do Asaas (cartão ou link).
  const returnedFromPayment=typeof window!=='undefined'&&
    new URLSearchParams(window.location.search).get('pagamento')==='retorno';

  React.useEffect(()=>{
    let live=true;
    // Verificar sempre o registro transacional antes de oferecer nova cobrança.
    Promise.all([productionApi('catalog',token),productionApi('status',token)])
      .then(([data,lookup])=>{
        if(!live)return;
        setCatalog(data);
        setPaymentMethod(data?.default_payment_method||'');
        if(data?.mode==='general'&&data?.enabled&&Array.isArray(data.approved_items)){
          const bySku=new Map((data.products||[]).map(p=>[String(p.sku),String(p.id)]));
          const initial={};
          for(const approved of data.approved_items){
            const id=bySku.get(String(approved.sku));
            if(id)initial[id]=Number(approved.quantity)||0;
          }
          setQuantities(initial);
        }
        setStatus(lookup.order||null);
        setStatusReady(true);
        if(lookup.order)setSubmitLocked(true);
        // Retoma a MESMA cobrança após atualização de página, sem POST financeiro.
        if(data?.mode==='general'&&lookup.order?.status==='payment_pending'){
          const method=lookup.order.payment_method||'pix';
          const kind=method==='boleto'?'boleto':['cartao','link'].includes(method)?'invoice':'pix';
          const setters={
            pix:[setPixLoading,setPix,setPixError,'pix_details'],
            boleto:[setBoletoLoading,setBoleto,setBoletoError,'boleto_details'],
            invoice:[setInvoiceLoading,setInvoice,setInvoiceError,'invoice_details']
          }[kind];
          setters[0](true);
          productionApi(setters[3],token).then(details=>{if(live)setters[1](details);})
            .catch(e=>{if(live)setters[2](e.message);})
            .finally(()=>{if(live)setters[0](false);});
        }
      }).catch(e=>{
        if(live)setError(e.message+' Não é possível iniciar outra cobrança sem consultar o pedido.');
      });
    return()=>{live=false};
  },[token]);
  // Apenas consulta do estado já gravado no Neon. Não dispara cobrança,
  // reenvio ao Bling, baixa de estoque nem emissão de documento fiscal.
  // Enquanto a página estiver visível, acompanha o PIX e depois o PDF.
  React.useEffect(()=>{
    if(!statusReady||catalog?.mode!=='general')return;
    const pendingPayment=status?.status==='payment_pending';
    const waitingForBling=status?.status==='paid'&&!status?.bling_exported&&
      !status?.bling_review_required;
    if(!pendingPayment&&!waitingForBling)return;

    let active=true,requestInFlight=false;
    let failures=0;
    const delay=pendingPayment?15000:20000;
    async function checkStatus(){
      if(!active||requestInFlight||document.visibilityState==='hidden')return;
      requestInFlight=true;
      try{
        const result=await productionApi('status',token);
        if(!active)return;
        const order=result?.order;
        if(!order||!['payment_pending','paid','manual_review','canceled',
          'expired','refunded','chargeback'].includes(String(order.status))){
          throw Error('Estado do pedido não disponível.');
        }
        failures=0;
        setAutoStatusError('');
        setStatus(order);
        setSubmitLocked(true);
        if(order.status==='paid'){
          setPix(null);setPixError('');setPayment(null);
        }
      }catch(e){
        if(active&&++failures>=2)setAutoStatusError(
          'Atualização automática indisponível. Use o botão de consulta abaixo.'
        );
      }finally{requestInFlight=false;}
    }
    const timer=setInterval(checkStatus,delay);
    function onVisible(){
      if(document.visibilityState==='visible')void checkStatus();
    }
    document.addEventListener('visibilitychange',onVisible);
    return()=>{
      active=false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisible);
    };
  },[token,catalog?.mode,statusReady,status?.status,status?.bling_exported]);

  const items=Object.entries(quantities).filter(([,qty])=>Number(qty)>0)
    .map(([product_id,quantity])=>({product_id,quantity:Number(quantity)}));
  // Cálculo automático, apenas leitura: não cria cobrança nem altera o pedido.
  // A seleção já mostra a prévia instantânea; o servidor confirma os valores
  // e a elegibilidade para habilitar o botão de finalização, sem cliques extras.
  const itemsKey=JSON.stringify(items);
  React.useEffect(()=>{
    if(step!=='cart'||!catalog||status||submitLocked||!items.length)return;
    let active=true;
    setQuote(null);
    setLoading(current=>current==='payment'?current:'quote');
    const timer=setTimeout(async()=>{
      try{
        const result=await productionApi('quote',token,{items:JSON.parse(itemsKey)});
        if(active){setQuote(result);setError('');}
      }catch(error){
        if(active){
          setQuote(null);
          setError(error?.message||'Não foi possível atualizar os valores do pedido.');
        }
      }finally{
        if(active)setLoading(current=>current==='quote'?'':current);
      }
    },250);
    return()=>{active=false;clearTimeout(timer);};
  },[token,itemsKey,step,catalog?.request_number,status?.status,submitLocked]);
  const publicGeneral=catalog?.mode==='general'&&catalog?.enabled&&
    catalog.payment_scope==='new_link_public';
  const portalApproved=catalog?.payment_scope==='approved_customer_request';
  const approvedCart=(catalog?.mode==='general'&&catalog?.enabled&&
    Array.isArray(catalog?.approved_items))?catalog.approved_items:[];
  const approvedAmountCents=Math.round(Number(catalog?.approved_amount||0)*100);
  const approvedQuantityBySku=new Map(approvedCart.map(x=>[
    String(x.sku),Number(x.quantity)
  ]));
  const exactApprovedCart=approvedCart.length>0&&
    items.length===approvedCart.length&&
    approvedCart.every(approved=>{
      const product=(catalog?.products||[]).find(p=>String(p.sku)===String(approved.sku));
      return !!product&&Number(quantities[product.id]||0)===Number(approved.quantity)&&
        Math.round(Number(product.price)*100)===Number(approved.unit_price_cents);
    })&&items.every(item=>{
      const product=(catalog?.products||[]).find(p=>String(p.id)===String(item.product_id));
      return !!product&&approvedQuantityBySku.has(String(product.sku));
    });
  const approvedQuoteReady=exactApprovedCart&&
    Math.round(Number(quote?.amount||0)*100)===approvedAmountCents&&
    Number(quote?.item_count)===approvedCart.length;
  const publicQuoteReady=publicGeneral&&
    Number(quote?.item_count)>0&&Number(quote?.item_count)<=50&&
    Math.round(Number(quote?.amount||0)*100)>0&&
    Math.round(Number(quote?.amount||0)*100)<=
      Math.round(Number(catalog?.max_payment_amount||0)*100);
  function restoreApprovedCart(){
    if(!catalog?.enabled||catalog?.mode!=='general')return;
    const initial={};
    for(const approved of approvedCart){
      const product=(catalog.products||[]).find(p=>String(p.sku)===String(approved.sku));
      if(product)initial[product.id]=Number(approved.quantity);
    }
    setQuantities(initial);setQuote(null);setValidation(null);setConfirmed(false);
    setSearch('');setCategory('Todos');
  }
  // Mesmo catálogo visual de testes, mas com valores reais revalidados pela API.
  const products=catalog?.products||[];
  const categories=['Todos',...new Set(products.map(p=>p.category).filter(Boolean))];
  const shown=products.filter(p=>
    (!search||[p.name,p.sku,p.brand].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR')
      .includes(search.toLocaleLowerCase('pt-BR')))&&
    (category==='Todos'||p.category===category)).sort((a,b)=>{
      const popularity=Number(b.sales_orders_count||0)-Number(a.sales_orders_count||0);
      return popularity||String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
    });
  const selected=products.filter(p=>Number(quantities[p.id]||0)>0);
  const totalUnits=selected.reduce((a,p)=>a+Number(quantities[p.id]||0),0);
  const cartTotal=selected.reduce((a,p)=>a+Number(quantities[p.id]||0)*Number(p.price||0),0);
  const orderMinimum=Number(catalog?.order_minimum_amount??5);
  const deliveryMinimum=Number(catalog?.delivery_minimum_amount||100);
  const orderTotal=Number(quote?.amount??cartTotal);
  const orderBelowMinimum=selected.length>0&&
    Math.round(orderTotal*100)<Math.round(orderMinimum*100);
  const missingToMinimum=Math.max(0,Math.round(orderMinimum*100)-Math.round(orderTotal*100))/100;
  const deliveryEligible=orderTotal>=deliveryMinimum;
  const deliveryNotice=deliveryEligible?
    'Pedido a partir de '+money(deliveryMinimum)+': entrega disponível mediante confirmação de prazo e disponibilidade.':
    'Pedido abaixo de '+money(deliveryMinimum)+': retirada na empresa ou entrega a combinar com a Ever Clean.';
  const suggestions=products.filter(p=>p.can_order!==false&&!selected.some(s=>s.id===p.id))
    .sort((a,b)=>{
      const sameA=selected.some(s=>s.category&&s.category===a.category)?1:0;
      const sameB=selected.some(s=>s.category&&s.category===b.category)?1:0;
      return sameB-sameA||Number(b.sales_orders_count||0)-Number(a.sales_orders_count||0);
    }).slice(0,8).map(p=>({...p,base_price:p.price,suggestion_type:'fallback'}));
  const setProductQty=(p,next)=>{
    if(p.can_order===false||submitLocked||!!status)return;
    const n=Math.max(0,Math.min(Number(p.max_quantity)||10000,
      Math.trunc(Number(next)||0)));
    if(n>0&&!Number(quantities[p.id]||0)&&selected.length>=50){
      setCartNotice('Limite de 50 produtos diferentes por pedido.');
      return;
    }
    setQuantities(previous=>({...previous,[p.id]:n}));
    setQuote(null);setValidation(null);setConfirmed(false);setCartNotice('');
  };
  const openCart=()=>{
    if(!selected.length||submitLocked)return;
    setError('');setStep('cart');window.scrollTo({top:0,behavior:'smooth'});
  };
  const backToCatalog=()=>{
    setError('');setStep('catalog');window.scrollTo({top:0,behavior:'smooth'});
  };
  const repeatLastOrder=()=>{
    const history=catalog?.last_order?.items||[];
    const next={};let missing=0;
    for(const item of history){
      const p=products.find(p=>String(p.id)===String(item.product_id));
      if(p&&p.can_order!==false)next[p.id]=Math.max(1,Math.min(
        Number(p.max_quantity)||10000,Number(item.quantity)||1));
      else missing++;
    }
    if(!Object.keys(next).length)return;
    setQuantities(next);setQuote(null);setValidation(null);setConfirmed(false);
    setCartNotice(missing?missing+' item(ns) indisponíveis foram ignorados. Confira o carrinho.':'');
    setStep('cart');window.scrollTo({top:0,behavior:'smooth'});
  };
  async function validateWithoutPix(){
    if(!quote||catalog?.mode!=='general'||!items.length)return;
    setLoading('validation');setError('');setValidation(null);
    try{setValidation(await productionApi('validate_checkout',token,{items}))}
    catch(e){setError(e.message)}
    finally{setLoading('')}
  }
  async function loadPix(){
    if(catalog?.mode!=='general')return;
    setPixLoading(true);setPixError('');setPixCopied(false);
    try{setPix(await productionApi('pix_details',token));}
    catch(e){setPix(null);setPixError(e.message||'QR Code indisponível no momento.');}
    finally{setPixLoading(false);}
  }
  async function loadBoleto(){
    if(catalog?.mode!=='general')return;
    setBoletoLoading(true);setBoletoError('');
    try{setBoleto(await productionApi('boleto_details',token));}
    catch(e){setBoleto(null);setBoletoError(e.message||'Boleto temporariamente indisponível.');}
    finally{setBoletoLoading(false);}
  }
  async function loadInvoice(){
    if(catalog?.mode!=='general')return;
    setInvoiceLoading(true);setInvoiceError('');
    try{setInvoice(await productionApi('invoice_details',token));}
    catch(e){setInvoice(null);setInvoiceError(e.message||'Página de pagamento indisponível no momento.');}
    finally{setInvoiceLoading(false);}
  }
  async function loadDetailsFor(method){
    if(method==='boleto')return loadBoleto();
    if(['cartao','link'].includes(method))return loadInvoice();
    return loadPix();
  }
  // Troca a forma de pagamento da MESMA cobrança. Não cria outro pedido.
  async function changePayment(method){
    if(!method||changing||method===currentMethod)return;
    const label=PAYMENT_OPTIONS[method]?.label||method;
    if(!window.confirm('Trocar a forma de pagamento para '+label+'? '+
      (currentMethod==='pix'?'O PIX gerado deixará de valer. ':'')+
      'O valor e o pedido continuam os mesmos.'))return;
    setChanging(method);setChangeError('');setChangeMessage('');
    try{
      const result=await productionApi('change_payment',token,{payment_method:method});
      const order=(await productionApi('status',token)).order;
      if(order)setStatus(order);
      setPayment(prev=>prev?{...prev,payment_method:result.payment_method,
        due_date:result.due_date,invoice_url:result.invoice_url,boleto_url:result.boleto_url}:prev);
      setPix(null);setPixError('');setPixCopied(false);
      setBoleto(null);setBoletoError('');
      setInvoice(null);setInvoiceError('');
      setChangeOpen(false);
      setChangeMessage('Forma de pagamento alterada para '+label+'.');
      if(order?.status==='payment_pending')await loadDetailsFor(order.payment_method||method);
    }catch(e){
      setChangeError(e.message||'Não foi possível trocar a forma de pagamento.');
      try{
        const order=(await productionApi('status',token)).order;
        if(order)setStatus(order);
      }catch{}
    }finally{setChanging('');}
  }
  async function copyPix(){
    if(!pix?.available||!pix?.copy_paste)return;
    try{
      await navigator.clipboard.writeText(pix.copy_paste);
      setPixCopied(true);setPixError('');
    }catch{
      setPixCopied(false);
      setPixError('Selecione e copie o código PIX abaixo manualmente.');
    }
  }
  async function createPayment(){
    if(orderBelowMinimum||!['pix','boleto','cartao','link'].includes(paymentMethod)||!catalog?.enabled||!quote||!confirmed||submitLocked||!statusReady||status||
      (catalog.mode==='general'&&!approvedQuoteReady&&!publicQuoteReady))return;
    if(invoiceRequested){
      const contact=String(invoiceContact||'').trim();
      if(invoiceChannel==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)){
        setError('Informe um e-mail válido para receber a nota fiscal.');
        return;
      }
      if(invoiceChannel==='whatsapp'&&!/^\d{10,13}$/.test(contact.replace(/\D/g,''))){
        setError('Informe um WhatsApp com DDD válido para receber a nota fiscal.');
        return;
      }
    }
    if(!window.confirm('Confirmar pedido de '+money(quote.amount)+
      (paymentMethod==='boleto'?' com boleto para '+(catalog?.boleto_due_days||30)+' dias?':
        paymentMethod==='cartao'?' e pagar com cartão de crédito?':
        paymentMethod==='link'?' e pagar pelo link de pagamento?':
        ' e prosseguir com pagamento por PIX?')))return;
    setSubmitLocked(true);setLoading('payment');setError('');
    try{
      const result=await productionApi('create_payment',token,{
        items,payment_method:paymentMethod,notes,
        expected_amount_cents:Math.round(Number(quote.amount)*100),
        invoice_requested:invoiceRequested,
        invoice_channel:invoiceRequested?invoiceChannel:null,
        invoice_contact:invoiceRequested?String(invoiceContact||'').trim():null
      });
      setPayment(result);
      // O vínculo financeiro é criado antes do retorno, bloqueando nova emissão.
      const order=(await productionApi('status',token)).order||{
        status:'payment_pending',amount:result.amount
      };
      setStatus(order);
      if(order.status==='payment_pending'&&catalog.mode==='general'){
        await loadDetailsFor(order.payment_method||paymentMethod);
      }
    }
    catch(e){
      setError('Não conseguimos concluir o pagamento. Consulte a situação do pedido abaixo.');
      try{
        const current=(await productionApi('status',token)).order;
        if(current){setStatus(current);setStatusReady(true);setSubmitLocked(true);}
      }catch{
        setError('Não foi possível consultar a situação. Atualize a página ou procure a Ever Clean.');
      }
    }
    finally{setLoading('')}
  }
  async function refresh(){
    setLoading('status');setError('');
    try{
      const order=(await productionApi('status',token)).order;
      setStatus(order||null);setStatusReady(true);
      if(order)setSubmitLocked(true);
      if(order?.status==='paid'){
        setPix(null);setPixError('');setPayment(null);
      }else if(order?.status==='payment_pending'&&catalog?.mode==='general'){
        await loadDetailsFor(order.payment_method||'pix');
      }
    }
    catch(e){setError(e.message)}
    finally{setLoading('')}
  }
  const currentMethod=status?.payment_method||payment?.payment_method||'pix';
  const paymentIsBoleto=currentMethod==='boleto';
  const paymentIsInvoice=['cartao','link'].includes(currentMethod);
  const paymentIsPix=!paymentIsBoleto&&!paymentIsInvoice;
  const changeOptions=(catalog?.change_payment_methods||[]).filter(m=>m!==currentMethod&&PAYMENT_OPTIONS[m]);
  const canChangePayment=catalog?.mode==='general'&&status?.status==='payment_pending'&&changeOptions.length>0;
  const requestCode='EC-'+String(catalog?.request_number||'').padStart(6,'0');
  const needsPaymentAssistance=status&&!['paid','payment_pending'].includes(String(status.status||''));
  const isReviewRequired=['manual_review','creating_payment','reserved'].includes(String(status?.status||''));
  const paymentClosed=['canceled','expired','refunded','chargeback'].includes(String(status?.status||''));
  async function copyOrderCode(){
    try{await navigator.clipboard.writeText(requestCode);setCartNotice('Número copiado para o atendimento.');}
    catch{setCartNotice('Informe o número '+requestCode+' à nossa equipe.');}
  }
  const dateText=value=>value?new Intl.DateTimeFormat('pt-BR',
    {dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'';
  return <div className="public-page"
    style={{minHeight:'100vh',paddingBottom:catalog&&!status&&step==='catalog'?110:35}}>
    <header className="public-header">
      <div className="public-header-inner">
        <div className="brand">
          <div className="brand-mark">EC</div>
          <div className="brand-copy">Ever Clean<small>HIGIENE PROFISSIONAL</small></div>
        </div>
        <div style={{textAlign:'right',fontSize:11,color:'#6b7780'}}>
          <strong style={{color:'#17443e'}}>{catalog?requestCode:'Ever Clean'}</strong>
          <div>{status?.status==='paid'?'Pagamento recebido':
            status?'Pagamento':step==='cart'?'Carrinho':'Pedido exclusivo'}</div>
          {catalog&&<Link to={portalHref} className="btn btn-white btn-sm"
            style={{fontSize:11,padding:'7px 9px',lineHeight:1.2,
              marginTop:7,whiteSpace:'normal',textAlign:'center'}}>
            Meu portal · sem senha
          </Link>}
        </div>
      </div>
    </header>
    <main className="public-main" style={{maxWidth:1180,margin:'0 auto'}}>
      {(!catalog||status)&&<section className="panel" style={{padding:18}}>
        <h1 style={{fontSize:22,marginBottom:8}}>
          {status?.status==='paid'?'Pedido confirmado':'Acompanhe seu pedido'}
        </h1>
        <p style={{fontSize:13,color:'#586a69'}}>
          {catalog?('Solicitação '+requestCode+' · '+catalog.customer_name):
            'Verificando link de pedido...'}
        </p>
        {status?.status==='paid'&&
          <div style={{marginTop:14,borderRadius:12,padding:16,
            background:'#eaf8ef',border:'1px solid #b9dec6',color:'#17654e'}}>
            <strong>Pagamento aprovado!</strong>
            <p style={{fontSize:13,marginTop:6}}>Recebemos seu pagamento de {money(status.amount)}.
              Seu pedido foi recebido pela Ever Clean.</p>
          </div>}
        {error&&<p role="alert" style={{color:'#a33a27',marginTop:14,fontSize:13}}>{error}</p>}
        {!catalog&&error&&<button type="button" className="btn btn-primary"
          onClick={()=>window.location.reload()} style={{marginTop:12}}>
          <RefreshCw size={16}/> Tentar novamente
        </button>}
      </section>}
      {needsPaymentAssistance&&
        <section className="panel" role="status" style={{padding:20,marginTop:16,
          border:'1px solid #eadfc5'}}>
          <h2 style={{fontSize:20,marginBottom:12}}>
            {isReviewRequired?'Pagamento aguardando conferência':
              paymentClosed?'Pagamento não concluído':'Seu pedido precisa de atendimento'}
          </h2>
          <p style={{fontSize:14,lineHeight:1.6,color:'#50645e',marginBottom:14}}>
            {isReviewRequired?
              'Não foi possível confirmar a emissão do pagamento. Nossa equipe precisa verificar a tentativa anterior antes de liberar uma nova cobrança para este pedido.':
              paymentClosed?
                'O pagamento não está disponível neste link. Nossa equipe poderá orientar os próximos passos.':
                'É necessário conferir a situação deste pedido antes de continuar.'}
          </p>
          <div style={{padding:14,borderRadius:12,background:'#f5f7f5',
            display:'grid',gap:5,marginBottom:14}}>
            <strong>Pedido {requestCode}</strong>
            {status?.amount!=null&&<span style={{fontSize:13}}>Valor: {money(status.amount)}</span>}
            <span style={{fontSize:12,color:'#6d7974'}}>
              Se já realizou um pagamento, não pague novamente antes da conferência.
            </span>
          </div>
          <div style={{display:'grid',gap:10}}>
            <button type="button" className="btn btn-primary"
              disabled={!!loading} onClick={refresh}
              style={{width:'100%',justifyContent:'center'}}>
              <RefreshCw size={16}/>{loading==='status'?'Consultando...':'Atualizar situação do pedido'}
            </button>
            <Link to={portalHref} className="btn btn-white"
              style={{width:'100%',boxSizing:'border-box',justifyContent:'center'}}>
              Acessar meus pedidos
            </Link>
            <button type="button" className="btn btn-white" onClick={copyOrderCode}
              style={{width:'100%',justifyContent:'center'}}>
              <Copy size={16}/> Copiar número para atendimento
            </button>
          </div>
          {cartNotice&&<p style={{fontSize:12,color:'#286154',marginTop:12}}>{cartNotice}</p>}
          <p style={{fontSize:12,color:'#657770',lineHeight:1.5,marginTop:16}}>
            Se a situação permanecer, informe o número do pedido à equipe Ever Clean.
            Não é necessário refazer a compra.
          </p>
        </section>}
      {catalog&&!status&&step==='catalog'&&<>
        <section className="order-intro">
          <span className="eyebrow"><ShoppingCart size={14}/>
            CATÁLOGO PARA REPOSIÇÃO</span>
          <h1>{catalog.customer_name||'Cliente Ever Clean'}</h1>
          <p>Escolha os produtos e quantidades. Revise tudo no carrinho antes
            de concluir a compra.</p>
          {catalog.expires_at&&<p style={{marginTop:9}}>
            <Clock3 size={14} style={{verticalAlign:-2,marginRight:5}}/>
            Válido até {dateText(catalog.expires_at)}
          </p>}
          {publicGeneral&&<p style={{marginTop:10,fontWeight:700}}>
            Compras de até {money(catalog.max_payment_amount)} por pedido.
          </p>}
          <p style={{fontSize:13,marginTop:10,lineHeight:1.55}}>
            Entregas para pedidos a partir de {money(deliveryMinimum)}, mediante confirmação.
            Abaixo desse valor, retirada na empresa ou a combinar.
          </p>
          {!catalog.enabled&&<p style={{marginTop:10,color:'#ffe3a2'}}>
            Prévia do catálogo. A finalização de pedidos não está disponível neste link.
          </p>}
        </section>
        {catalog.last_order?.items?.length>0&&
          <section className="panel" style={{marginBottom:16,padding:16,
            display:'flex',justifyContent:'space-between',gap:12,
            alignItems:'center',flexWrap:'wrap'}}>
            <div>
              <strong style={{display:'flex',gap:7,alignItems:'center'}}>
                <RotateCcw size={17}/>Repetir último pedido
              </strong>
              <div className="muted" style={{fontSize:11,marginTop:5}}>
                EC-{catalog.last_order.request_number} ·
                {' '}{dateText(catalog.last_order.created_at)} ·
                {' '}{money(catalog.last_order.total_amount)}
              </div>
            </div>
            <button type="button" className="btn btn-primary btn-sm"
              disabled={submitLocked} onClick={repeatLastOrder}>
              <RotateCcw size={15}/>Repetir pedido
            </button>
          </section>}
        <CatalogSearchFilters search={search} onSearchChange={setSearch}
          category={category} onCategoryChange={setCategory}
          categories={categories}/>
        <CatalogProductGrid products={shown} quantities={quantities}
          onQuantityChange={setProductQty}/>
        {!shown.length&&<div className="empty">Nenhum produto encontrado.</div>}
        {cartNotice&&<p role="status" style={{fontSize:12,color:'#975321'}}>
          {cartNotice}</p>}
        {error&&<div className="form-error">{error}</div>}
      </>}
      {catalog&&!status&&step==='cart'&&<>
        <button type="button" className="btn btn-white" onClick={backToCatalog}
          style={{marginBottom:14}} disabled={!!loading||submitLocked}>
          <ArrowLeft size={16}/>Voltar ao catálogo
        </button>
        <section className="order-intro">
          <span className="eyebrow"><ShoppingCart size={14}/> Carrinho e finalização</span>
          <h1>Confira seu pedido</h1>
          <p>Confira os produtos e quantidades antes de finalizar sua compra.</p>
        </section>
        <CatalogCartItems selected={selected} quantities={quantities}
          onQuantityChange={setProductQty} total={cartTotal}/>
        {orderBelowMinimum&&<div role="alert" style={{padding:14,
          border:'1px solid #eed6a1',borderRadius:12,background:'#fff8e8',
          margin:'12px 0',color:'#80591b',lineHeight:1.55}}>
          <strong>Pedido mínimo: {money(orderMinimum)}</strong>
          <p style={{fontSize:13,marginTop:5}}>
            Adicione mais {money(missingToMinimum)} em produtos para finalizar sua compra.
            Você pode continuar escolhendo os itens normalmente.
          </p>
        </div>}
        {selected.length>0&&<div role="status"
          style={{padding:14,borderRadius:12,background:'#f2f7f5',
            border:'1px solid #d5e5dd',marginTop:14,marginBottom:12}}>
          <strong style={{fontSize:14,color:'#205b4c'}}>
            {deliveryEligible?'Entrega disponível para consulta':'Retirada ou entrega a combinar'}
          </strong>
          <p style={{fontSize:13,color:'#45645a',lineHeight:1.55,marginTop:6}}>
            {deliveryNotice}
          </p>
          {!deliveryEligible&&<p style={{fontSize:12,color:'#62766f',marginTop:5}}>
            Faltam {money(Math.max(0,deliveryMinimum-orderTotal))} para atingir o
            valor mínimo para entrega.
          </p>}
        </div>}
        {cartNotice&&<p role="status" style={{fontSize:12,color:'#975321',marginBottom:12}}>
          {cartNotice}</p>}
        {suggestions.length>0&&
          <SuggestedProductsCarousel items={suggestions}
            disableLegacyFallback={true}
            onAdd={p=>setProductQty(p,Number(quantities[p.id]||0)+1)}/>}
        <section className="panel" style={{marginTop:16,marginBottom:16}}>
          <div className="panel-head">
            <h2><CreditCard size={18} style={{verticalAlign:-3,marginRight:7}}/>
              Forma de pagamento</h2>
          </div>
          <div style={{padding:16,display:'grid',gap:10}}>
            {[
              {id:'pix',label:'PIX',available:true,
                description:'Pagamento à vista.'},
              {id:'cartao',label:'Cartão de crédito',
                available:catalog?.available_payment_methods?.includes('cartao')===true,
                description:'Pagamento na página segura do Asaas.'},
              {id:'link',label:'Link de pagamento',
                available:catalog?.available_payment_methods?.includes('link')===true,
                description:'Página do Asaas para escolher como pagar.'},
              {id:'boleto',
                label:'Boleto / compra a prazo',
                available:catalog?.available_payment_methods?.includes('boleto')===true,
                description:catalog?.available_payment_methods?.includes('boleto')?
                  'Vencimento em '+(catalog.boleto_due_days||30)+' dias.':
                  'Disponível para clientes autorizados.'}
            ].map(method=><label key={method.id} style={{
              display:'flex',gap:12,alignItems:'center',padding:14,
              border:'1px solid '+(paymentMethod===method.id?'#0b766a':'#dfe6ea'),
              borderRadius:13,
              background:paymentMethod===method.id?'#ecf8f5':'#fff',
              opacity:method.available?1:0.65,
              cursor:method.available?'pointer':'not-allowed'
            }}>
              <input type="radio" name="production-payment-method"
                value={method.id} disabled={!method.available||submitLocked}
                checked={paymentMethod===method.id}
                onChange={()=>{
                  setPaymentMethod(method.id);
                  setValidation(null);setConfirmed(false);setError('');
                }}/>
              <span style={{minWidth:0}}>
                <strong style={{fontSize:14}}>{method.label}</strong>
                <span className="muted" style={{fontSize:11,display:'block',marginTop:4}}>
                  {method.description}
                </span>
              </span>
            </label>)}
            {!paymentMethod&&<div role="status" style={{fontSize:12,color:'#805b21'}}>
              Selecione a forma de pagamento para continuar.
            </div>}
          </div>
        </section>
        <section className="panel" style={{marginBottom:16}}>
          <div className="panel-head">
            <h2><FileText size={18} style={{verticalAlign:-3,marginRight:7}}/>
              Nota fiscal</h2>
          </div>
          <div style={{padding:16}}>
            <label style={{display:'flex',gap:10,alignItems:'center',fontWeight:700}}>
              <input type="checkbox" disabled={submitLocked}
                checked={invoiceRequested} onChange={e=>{
                  setInvoiceRequested(e.target.checked);
                  setConfirmed(false);
                }}/>
              Solicitar emissão de nota fiscal
            </label>
            {invoiceRequested&&<div style={{marginTop:14}}>
              <p className="muted" style={{fontSize:12,marginBottom:10}}>
                Solicitação encaminhada à equipe para emissão manual após o pagamento.
              </p>
              <div style={{display:'flex',gap:8}}>
                <button type="button" className={'btn '+(invoiceChannel==='email'?'btn-primary':'btn-white')}
                  onClick={()=>{setInvoiceChannel('email');setInvoiceContact('');setConfirmed(false);}}>
                  <Mail size={16}/>E-mail
                </button>
                <button type="button" className={'btn '+(invoiceChannel==='whatsapp'?'btn-primary':'btn-white')}
                  onClick={()=>{setInvoiceChannel('whatsapp');setInvoiceContact('');setConfirmed(false);}}>
                  <MessageCircle size={16}/>WhatsApp
                </button>
              </div>
              <div className="field">
                <label>{invoiceChannel==='email'?'E-mail para envio':'Número de WhatsApp com DDD'}</label>
                <input type={invoiceChannel==='email'?'email':'tel'}
                  inputMode={invoiceChannel==='email'?'email':'tel'}
                  value={invoiceContact} maxLength={254}
                  placeholder={invoiceChannel==='email'?'seu@email.com':'(67) 99999-9999'}
                  onChange={e=>{setInvoiceContact(e.target.value);setConfirmed(false);}}/>
              </div>
            </div>}
          </div>
        </section>
        <section className="panel" style={{marginBottom:16}}>
          <div className="panel-head"><h2>Observações</h2></div>
          <div style={{padding:16}}>
            <textarea className="search" style={{width:'100%',minHeight:92,
              padding:12,height:'auto',resize:'vertical'}} maxLength={2000}
              disabled={submitLocked} value={notes}
              onChange={e=>{setNotes(e.target.value);setConfirmed(false);}}
              placeholder="Horário de entrega, referência do local, faturamento..."/>
          </div>
        </section>
        <section className="panel" style={{padding:18,marginTop:16}}>
          <h2 style={{fontSize:18,marginBottom:10}}>Resumo do pedido</h2>
          <p className="muted" style={{fontSize:12,marginBottom:12}}>
            Antes de continuar para o pagamento, confira os produtos, as quantidades e o valor total.
          </p>
          {catalog.mode==='general'&&catalog.enabled&&!publicGeneral&&
            <div style={{padding:12,border:'1px solid #c4e0d2',
              borderRadius:10,marginBottom:14,background:'#f0faf5'}}>
              <strong style={{fontSize:13}}>Carrinho aprovado: {money(catalog.approved_amount)}</strong>
              <p style={{fontSize:12,marginTop:6}}>
                {approvedCart.map(x=>x.quantity+' × SKU '+x.sku).join(' · ')}
              </p>
              {!exactApprovedCart&&<p style={{fontSize:12,color:'#975321'}}>
                Os itens ou as quantidades não correspondem à aprovação.
              </p>}
              <button type="button" className="btn btn-white" style={{marginTop:10}}
                onClick={restoreApprovedCart} disabled={!!loading||submitLocked}>
                Restaurar carrinho autorizado
              </button>
            </div>}

        {items.length>0&&<div style={{marginTop:14,padding:13,border:'1px solid #cbe5d9',borderRadius:12}}>
          <strong style={{fontSize:19}}>Total: {money(quote?.amount??cartTotal)}</strong>
          {orderBelowMinimum&&<p role="alert" style={{fontSize:13,
            color:'#8a5517',marginTop:9,lineHeight:1.5}}>
            Para continuar, o pedido precisa atingir {money(orderMinimum)}.
            Faltam {money(missingToMinimum)} em produtos.
          </p>}
          <p style={{fontSize:12,color:'#366a59',marginTop:10,lineHeight:1.55}}>
            <strong>Recebimento:</strong> {quote?.delivery?.message||deliveryNotice}
          </p>
          {loading==='quote'&&<p role="status" style={{fontSize:12,marginTop:8,color:'#64756e'}}>
            Atualizando valores do pedido...
          </p>}
          {error&&<p role="alert" style={{fontSize:12,marginTop:8,color:'#a34a2e'}}>{error}</p>}
          {paymentMethod==='boleto'&&<p style={{fontSize:13,marginTop:10,color:'#175f50'}}>
            Boleto para {catalog?.boleto_due_days||30} dias, contados a partir da emissão.
            O pedido será confirmado após o pagamento do boleto.
          </p>}
          {catalog.mode==='general'&&<div style={{marginTop:12,display:'grid',gap:8}}>
            <strong style={{fontSize:13}}>Confira os produtos selecionados</strong>
            {(quote?.items||selected.map(p=>({
              product_sku:p.sku,product_name:p.name,
              quantity:Number(quantities[p.id]||0),
              unit_price_cents:Math.round(Number(p.price||0)*100),
              subtotal_cents:Math.round(Number(p.price||0)*100)*Number(quantities[p.id]||0),
              fulfillment_status:p.availability==='sob_encomenda'?'sob_encomenda':'pronta_entrega'
            }))).map((item,i)=><div key={item.product_sku||i}
              style={{fontSize:12,padding:'8px 0',borderBottom:'1px solid #e7ecea'}}>
              <strong>{item.product_name}</strong>
              <div style={{color:'#546861',marginTop:3}}>
                SKU {item.product_sku} · {item.quantity} × {money(item.unit_price_cents/100)}
                {' = '}<strong>{money(item.subtotal_cents/100)}</strong>
              </div>
              {item.fulfillment_status==='sob_encomenda'&&
                <div style={{color:'#98611d',marginTop:3}}>Sob encomenda</div>}
            </div>)}
            <p style={{fontSize:12,color:'#536b65'}}>
              {quote?.item_count??selected.length} produto(s) diferente(s), {quote?.units??totalUnits} unidade(s)
            </p>
          </div>}
          {quote?.requires_stock_review&&<p style={{fontSize:12,marginTop:8}}>
            Existem itens sob encomenda. A disponibilidade será revisada antes da entrega.
          </p>}
          {catalog.enabled&&catalog.mode==='general'&&!publicGeneral&&quote&&!approvedQuoteReady&&
            <p style={{marginTop:12,fontSize:13,color:'#a14b26',fontWeight:600}}>
              Pagamento indisponível neste carrinho. Restaure os itens autorizados
              e confira novamente o total de {money(catalog.approved_amount)}.
            </p>}
          {publicGeneral&&quote&&!publicQuoteReady&&
            <p style={{marginTop:10,fontSize:13,color:'#9a4b26'}}>
              Revise seu carrinho. O limite inicial por pedido é
              {' '}{money(catalog.max_payment_amount)}.
            </p>}
          {!catalog.enabled?<>
            <p style={{marginTop:10,fontSize:13}}>Prévia concluída sem cobrança.</p>
            {catalog.mode==='general'&&<>
              <button className="btn btn-white" type="button" style={{marginTop:12,
                width:'100%',whiteSpace:'normal',justifyContent:'center',lineHeight:1.35}}
                onClick={validateWithoutPix} disabled={!!loading||!items.length}>
                <ShieldCheck size={16}/>
                {loading==='validation'?'Validando...':'Validar finalização (sem PIX)'}
              </button>
              {validation&&<div style={{border:'1px solid #cee3da',padding:12,
                borderRadius:10,marginTop:11}}>
                <strong style={{fontSize:14,color:validation.eligible_for_future_payment?
                  '#17654e':'#9a5624'}}>
                  {validation.eligible_for_future_payment?
                    'Finalização validada, sem cobrança':'Pedido já registrado para esta referência'}
                </strong>
                <p style={{fontSize:12,marginTop:8}}>
                  {validation.item_count} produtos · {validation.quantity_total} unidades ·
                  Total {money(validation.amount)}.
                </p>
                <p style={{fontSize:12,marginTop:6}}>
                  {validation.requires_stock_review?
                    'Existem itens sob encomenda: revisar antes da entrega.':
                    'Disponibilidade sujeita à confirmação.'}
                </p>
                <p style={{fontSize:12,marginTop:8}}>
                  {validation.message}
                </p>
              </div>}
            </>}
          </>:<>
            <label style={{display:'flex',alignItems:'flex-start',gap:8,marginTop:12,fontSize:13}}>
              <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
              Confirmo os produtos, o valor e a forma de pagamento selecionada.
            </label>
            <button className="btn btn-primary" style={{marginTop:12}}
              disabled={orderBelowMinimum||!confirmed||!quote||!['pix','boleto','cartao','link'].includes(paymentMethod)||
                submitLocked||!!loading||
                (catalog.mode==='general'&&!approvedQuoteReady&&!publicQuoteReady)}
              onClick={createPayment}>
              Continuar para pagamento
            </button>
          </>}
        </div>}
        </section>
      </>}
      {catalog?.mode==='general'&&status?.status==='paid'&&
        <section className="panel" style={{padding:18,marginTop:16}}>
          <h2 style={{fontSize:19,marginBottom:8}}>Acompanhe seu pedido</h2>
          <p className="muted" style={{fontSize:13,marginBottom:16}}>
            Você pode acompanhar a preparação e a entrega do pedido por aqui.
          </p>
          <div style={{padding:13,border:'1px solid #d9e6e0',borderRadius:11,
            background:'#f6faf8',marginBottom:14}}>
            <strong style={{fontSize:13,color:'#205b4c'}}>Forma de recebimento</strong>
            <p style={{fontSize:12,color:'#526b60',marginTop:6,lineHeight:1.55}}>
              {status.delivery?.message||
                (Number(status.amount)<deliveryMinimum?
                  'Retirada na empresa ou entrega a combinar com a Ever Clean.':
                  'Entrega disponível mediante confirmação de prazo e disponibilidade.')}
            </p>
          </div>
          <div role="list" aria-label="Andamento do pedido"
            style={{display:'grid',gap:10}}>
            <div role="listitem" style={{padding:14,borderRadius:12,
              background:'#ebf7ef',display:'flex',gap:11}}>
              <ShieldCheck size={20} color="#17654e" style={{flexShrink:0}}/>
              <div><strong style={{fontSize:14,color:'#17654e'}}>Pagamento confirmado</strong>
                <p style={{fontSize:12,color:'#486459',marginTop:4}}>
                  Recebemos seu pagamento de {money(status.amount)}.
                </p>
              </div>
            </div>
            <div role="listitem" style={{padding:14,borderRadius:12,
              background:'#f5f7f6',display:'flex',gap:11}}>
              <ShoppingCart size={20} color="#62736d" style={{flexShrink:0}}/>
              <div>
                <strong style={{fontSize:14,color:'#354b44'}}>
                  {({
                    awaiting_review:'Pedido recebido',
                    preparing:'Pedido em separação',
                    ready_for_delivery:'Preparação concluída',
                    out_for_delivery:'Pedido a caminho',
                    delivered:'Pedido entregue',
                    on_hold:'Aguardando disponibilidade'
                  })[status.fulfillment_stage]||'Pedido recebido'}
                </strong>
                <p style={{fontSize:12,color:'#526a64',marginTop:4}}>
                  {status.fulfillment_note||
                    (status.fulfillment_stage==='delivered'?
                      'A entrega foi concluída. Obrigado pela preferência!':
                      'Nossa equipe está cuidando do seu pedido.')}
                </p>
              </div>
            </div>
          </div>
          {status.pdf_available&&
            <a className="btn btn-primary" style={{marginTop:16,
              display:'inline-flex',width:'100%',maxWidth:'100%',
              boxSizing:'border-box',justifyContent:'center',
              whiteSpace:'normal',textAlign:'center',lineHeight:1.4}}
              href={'/.netlify/functions/bling-customer-order-pdf?token='+encodeURIComponent(token)}>
              <FileText size={18}/> Baixar pedido em PDF
            </a>}
          {status.pdf_expired&&<p style={{fontSize:12,color:'#805b21',marginTop:12}}>
            A via digital não está mais disponível neste link. Solicite uma nova via à Ever Clean.
          </p>}
          <p style={{fontSize:11,color:'#647973',marginTop:12,lineHeight:1.5}}>
            O PDF apresenta os itens e valores do pedido. Não substitui a nota fiscal.
          </p>
          <button className="btn btn-white" type="button"
            style={{marginTop:13}} onClick={refresh} disabled={!!loading}>
            <RefreshCw size={16}/> Atualizar andamento
          </button>
        </section>}
      {(payment||status?.status==='payment_pending')&&status?.status!=='paid'&&
        <section className="panel" style={{padding:18,marginTop:16}}>
          <h2 style={{fontSize:18,marginBottom:8}}>
            {paymentIsBoleto?'Boleto bancário':paymentIsInvoice?
              (currentMethod==='cartao'?'Pagar com cartão de crédito':'Link de pagamento'):
              'Pagar com PIX'} · {money(payment?.amount??status?.amount)}
          </h2>
          <p style={{fontSize:13,color:'#526a64',lineHeight:1.5}}>
            {paymentIsBoleto?
              'Seu boleto está pronto para pagamento. Consulte o vencimento e abra o documento.':
              currentMethod==='cartao'?
              'Abra a página segura do Asaas para informar os dados do cartão. A Ever Clean não recebe os dados do seu cartão.':
              currentMethod==='link'?
              'Abra a página segura do Asaas e escolha como prefere pagar.':
              'Utilize o QR Code ou PIX Copia e Cola para pagar. Não é necessário gerar outra cobrança.'}
          </p>
          {paymentIsBoleto&&<>
            <div style={{background:'#edf8f3',borderRadius:12,padding:14,
              marginTop:14,color:'#1b5949'}}>
              <strong>Vencimento: {(() => {
                const raw=String(boleto?.due_date||payment?.due_date||
                  status?.payment_due_date||'').slice(0,10);
                const parts=raw.split('-');
                return parts.length===3?parts.reverse().join('/'):'Consulte o documento';
              })()}</strong>
              <p style={{fontSize:12,marginTop:6}}>
                Seu pedido será confirmado assim que o pagamento for identificado.
              </p>
            </div>
            {(boleto?.boleto_url||boleto?.invoice_url||
              payment?.boleto_url||payment?.invoice_url)&&
              <a className="btn btn-primary" style={{marginTop:14,
                display:'inline-flex',width:'100%',justifyContent:'center',
                whiteSpace:'normal',boxSizing:'border-box'}}
                target="_blank" rel="noopener noreferrer"
                href={boleto?.boleto_url||boleto?.invoice_url||
                  payment?.boleto_url||payment?.invoice_url}>
                <FileText size={17}/> Visualizar e baixar boleto
              </a>}
            {boletoLoading&&<p style={{fontSize:12,marginTop:12}}>
              Consultando seu boleto...
            </p>}
            {boletoError&&<p role="status" style={{color:'#9c592c',
              fontSize:12,marginTop:12}}>{boletoError}</p>}
            {catalog?.mode==='general'&&
              <button className="btn btn-white" type="button" disabled={boletoLoading}
                onClick={loadBoleto} style={{marginTop:12,width:'100%',
                  justifyContent:'center'}}>
                <RefreshCw size={16}/> Atualizar boleto
              </button>}
          </>}
          {paymentIsPix&&pix?.available&&<>
            <div style={{display:'flex',justifyContent:'center',marginTop:16}}>
              <img src={'data:image/png;base64,'+pix.image_base64}
                width="230" height="230" alt="QR Code para pagar este pedido"
                style={{maxWidth:'100%',height:'auto',aspectRatio:'1',objectFit:'contain',
                  borderRadius:12,border:'1px solid #d6e3db',padding:10,
                  boxSizing:'border-box',background:'#fff'}}/>
            </div>
            <label htmlFor="everclean-pix-payload" style={{display:'block',marginTop:16,
              fontSize:13,fontWeight:700}}>PIX Copia e Cola</label>
            <textarea id="everclean-pix-payload" value={pix.copy_paste} readOnly rows={3}
              onFocus={e=>e.target.select()}
              style={{width:'100%',marginTop:8,padding:11,borderRadius:10,
                boxSizing:'border-box',border:'1px solid #cddbd5',fontSize:12,
                resize:'none',overflowWrap:'anywhere'}}/>
            <button className="btn btn-primary" type="button" onClick={copyPix}
              style={{marginTop:10,width:'100%',justifyContent:'center',
                whiteSpace:'normal',textAlign:'center'}}>
              {pixCopied?'Código PIX copiado!':'Copiar código PIX'}
            </button>
            {pix.expiration_date&&<p style={{fontSize:12,color:'#5a706a',marginTop:10}}>
              Validade do QR Code: {pix.expiration_date}
            </p>}
            <p style={{fontSize:12,color:'#526a64',marginTop:10}}>
              Após pagar pelo aplicativo do seu banco, consulte a situação abaixo.
              Você receberá a confirmação assim que o pagamento for identificado.
            </p>
          </>}
          {paymentIsPix&&pixLoading&&<p style={{fontSize:13,marginTop:12}}>
            Consultando QR Code da cobrança existente...
          </p>}
          {paymentIsPix&&pix&&!pix.available&&<p style={{fontSize:13,marginTop:12,color:'#85551e'}}>
            {pix.message||'QR Code ainda não disponível. Verifique o status.'}
          </p>}
          {paymentIsPix&&pixError&&<p role="alert" style={{fontSize:12,marginTop:12,color:'#9a4b30'}}>
            {pixError} Nenhuma nova cobrança foi criada.
          </p>}
          {paymentIsPix&&catalog?.mode==='general'&&<button className="btn btn-white" type="button"
            disabled={pixLoading||!!loading} onClick={loadPix}
            style={{marginTop:12,width:'100%',justifyContent:'center',
              whiteSpace:'normal'}}>
            <RefreshCw size={16}/>{pixLoading?'Consultando...':'Atualizar QR Code e Copia e Cola'}
          </button>}
          {paymentIsPix&&(pix?.invoice_url||payment?.invoice_url)&&
            <a className="btn btn-white" style={{marginTop:10,display:'inline-flex',
              width:'100%',justifyContent:'center',boxSizing:'border-box',
              whiteSpace:'normal',textAlign:'center'}}
              target="_blank" rel="noopener noreferrer"
              href={pix?.invoice_url||payment?.invoice_url}>
              Abrir outra opção de pagamento
            </a>}
          {paymentIsInvoice&&<>
            {(invoice?.invoice_url||payment?.invoice_url)&&
              <a className="btn btn-primary" style={{marginTop:14,display:'inline-flex',
                width:'100%',justifyContent:'center',boxSizing:'border-box',
                whiteSpace:'normal',textAlign:'center'}}
                rel="noopener noreferrer"
                href={invoice?.invoice_url||payment?.invoice_url}>
                <CreditCard size={17}/> {currentMethod==='cartao'?'Pagar com cartão':'Abrir link de pagamento'}
              </a>}
            {(invoice?.due_date||status?.payment_due_date)&&
              <p style={{fontSize:12,color:'#5a706a',marginTop:10}}>
                Vencimento: {formatDate(invoice?.due_date||status?.payment_due_date)}
              </p>}
            {invoiceLoading&&<p style={{fontSize:12,marginTop:12}}>Consultando a página de pagamento...</p>}
            {invoiceError&&<p role="status" style={{color:'#9c592c',fontSize:12,marginTop:12}}>
              {invoiceError} Nenhuma nova cobrança foi criada.
            </p>}
            <p style={{fontSize:12,color:'#5a706a',marginTop:10}}>
              A página do Asaas abre aqui mesmo. Depois de pagar, você volta para este pedido.
            </p>
            {catalog?.mode==='general'&&
              <button className="btn btn-white" type="button" disabled={invoiceLoading}
                onClick={loadInvoice} style={{marginTop:12,width:'100%',justifyContent:'center'}}>
                <RefreshCw size={16}/> Atualizar link de pagamento
              </button>}
          </>}
          {returnedFromPayment&&paymentIsInvoice&&<p role="status"
            style={{fontSize:13,marginTop:14,color:'#175f50'}}>
            Recebemos você de volta. Assim que o Asaas confirmar o pagamento, esta página será atualizada.
          </p>}
          {changeMessage&&<p role="status" style={{fontSize:13,marginTop:14,color:'#175f50'}}>
            {changeMessage}
          </p>}
          {canChangePayment&&<div style={{marginTop:16,borderTop:'1px solid #e3ebe7',paddingTop:14}}>
            {!changeOpen?
              <button className="btn btn-white" type="button" disabled={!!changing||!!loading}
                onClick={()=>{setChangeOpen(true);setChangeError('');setChangeMessage('');}}
                style={{width:'100%',justifyContent:'center'}}>
                Trocar forma de pagamento
              </button>:
              <div role="group" aria-label="Escolha a nova forma de pagamento">
                <p style={{fontSize:13,fontWeight:700,marginBottom:8}}>Escolha a nova forma de pagamento</p>
                {changeOptions.map(method=>
                  <button key={method} className="btn btn-white" type="button"
                    disabled={!!changing||!!loading} onClick={()=>changePayment(method)}
                    style={{width:'100%',justifyContent:'flex-start',textAlign:'left',
                      marginTop:8,display:'block',whiteSpace:'normal'}}>
                    <strong>{changing===method?'Alterando...':PAYMENT_OPTIONS[method].label}</strong>
                    <span style={{display:'block',fontSize:12,color:'#5a706a',fontWeight:400}}>
                      {PAYMENT_OPTIONS[method].hint}
                    </span>
                  </button>)}
                <button className="btn btn-white" type="button" disabled={!!changing}
                  onClick={()=>setChangeOpen(false)}
                  style={{width:'100%',justifyContent:'center',marginTop:10}}>
                  Manter {PAYMENT_OPTIONS[currentMethod]?.label||'forma atual'}
                </button>
                <p style={{fontSize:12,color:'#5a706a',marginTop:8}}>
                  O pedido e o valor continuam os mesmos. Só muda a forma de pagar.
                </p>
              </div>}
            {changeError&&<p role="alert" style={{fontSize:12,marginTop:10,color:'#9a4b30'}}>
              {changeError}
            </p>}
          </div>}
        </section>}
      {(payment||status?.status==='payment_pending')&&
        status?.status!=='paid'&&
        <section className="panel" style={{padding:18,marginTop:16}}>
          <button className="btn btn-white" onClick={refresh} disabled={!!loading}>
            <RefreshCw size={16}/> Atualizar pagamento
          </button>
          <p style={{fontSize:12,color:'#526f65',marginTop:10}}>
            Assim que o pagamento for identificado, o pedido será atualizado nesta página.
          </p>
          {autoStatusError&&<p role="status" style={{fontSize:12,color:'#955b25',marginTop:10}}>
            Não foi possível atualizar automaticamente. Use o botão acima.
          </p>}
        </section>}
    </main>
    {catalog&&!status&&step==='catalog'&&
      <CatalogCartBar productCount={selected.length} units={totalUnits}
        total={cartTotal} onReview={openCart}
        disabled={!selected.length||submitLocked}
        buttonText="Revisar carrinho"/>}
  </div>;
}
