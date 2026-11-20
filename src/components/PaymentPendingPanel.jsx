import React from 'react';
import {ArrowLeftRight, CheckCircle2, Copy, CreditCard, ExternalLink, FileText, RefreshCw, ShieldCheck} from 'lucide-react';
import {toast} from 'sonner';
import {testApi} from '../lib/testApi.js';

const money = value => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value || 0));
const methodName = {pix:'PIX',boleto:'Boleto bancário',cartao:'Cartão de crédito',link_pagamento:'Link de pagamento'};
const statuses = {
  aguardando_pagamento:'Aguardando pagamento',
  pago:'Pagamento confirmado',
  vencido:'Cobrança vencida',
  cancelado:'Cobrança cancelada',
  estornado:'Pagamento estornado'
};

export default function PaymentPendingPanel({payment,token,onPaid}) {
  const [current,setCurrent] = React.useState(payment);
  const [checking,setChecking] = React.useState(false);
  const [refreshingPix,setRefreshingPix] = React.useState(false);
  const [changingMethod,setChangingMethod] = React.useState(false);
  const [showChange,setShowChange] = React.useState(false);
  const [newMethod,setNewMethod] = React.useState('');
  const [changeError,setChangeError] = React.useState('');
  const [lastChecked,setLastChecked] = React.useState('');
  React.useEffect(() => {setCurrent(payment);setShowChange(false);setChangeError('');},[payment]);

  const checkStatus = React.useCallback(async(silent=false) => {
    if (!token) return;
    if (!silent) setChecking(true);
    try {
      const response = await testApi('payment_status',{token},{auth:false});
      if (response?.ok && response.payment) {
        setCurrent(response.payment);
        if (response.paid) {
          onPaid?.(response.payment);
        } else if (!silent) {
          setLastChecked(new Date().toLocaleTimeString('pt-BR'));
          toast.info('Status consultado: ' + (statuses[response.payment.status] || 'Aguardando confirmação'));
        }
      } else if (!silent) {
        toast.error(response?.message || 'Não foi possível consultar o pagamento.');
      }
    } catch {
      if (!silent) toast.error('Falha de comunicação com a Ever Clean.');
    } finally {
      if (!silent) setChecking(false);
    }
  },[token,onPaid]);

  React.useEffect(() => {
    if (!current || current.status !== 'aguardando_pagamento') return;
    const interval = window.setInterval(() => checkStatus(true),15000);
    return () => window.clearInterval(interval);
  },[current?.status,checkStatus]);

  async function retryPix() {
    if (!token || refreshingPix) return;
    setRefreshingPix(true);
    try {
      const response = await testApi('refresh_pix',{token},{auth:false});
      if (!response?.ok) throw new Error(response?.message || 'Falha na consulta do PIX.');
      if (response.payment) {
        setCurrent(response.payment);
        if (response.payment.pix_payload || response.payment.pix_image) {
          toast.success('Dados do PIX atualizados com sucesso.');
        } else {
          toast.warning(response.payment.pix_error || 'PIX não disponível. Verifique a configuração da conta Sandbox.');
        }
      }
    } catch(error) {
      toast.error(error?.message || 'Não foi possível recuperar o PIX.');
    } finally {
      setRefreshingPix(false);
    }
  }

  async function submitPaymentMethodChange() {
    if (!newMethod || newMethod === current?.method || changingMethod) return;
    setChangingMethod(true);
    setChangeError('');
    try {
      const response=await testApi('change_payment_method',{token,payment_method:newMethod},{auth:false});
      if (!response?.ok) {
        if (response?.paid && response.payment) {
          setCurrent(response.payment);
          onPaid?.(response.payment);
          return;
        }
        throw new Error(response?.message || 'Não foi possível alterar o pagamento.');
      }
      if (response.payment) {
        setCurrent(response.payment);
        setShowChange(false);
        setNewMethod('');
        toast.success('Forma de pagamento alterada. Utilize somente os novos dados de pagamento.');
      }
    } catch(error) {
      setChangeError(error?.message || 'Falha ao alterar a forma de pagamento.');
    } finally {setChangingMethod(false);}
  }

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(current.pix_payload);
      toast.success('Código PIX copiado!');
    } catch {
      toast.error('Não foi possível copiar automaticamente. Selecione o código abaixo.');
    }
  }

  if (!current) return <div className="panel" style={{padding:20}}>Carregando dados de pagamento...</div>;
  const isPix=current.method==='pix', isBoleto=current.method==='boleto';
  const isCard=current.method==='cartao'||current.method==='link_pagamento';
  const methods=(Array.isArray(current.allowed_methods)?current.allowed_methods:[])
    .filter(method=>['pix','boleto','cartao'].includes(method) && method!==current.method);
  const canChange=Boolean(current.can_change_method) && ['aguardando_pagamento','vencido'].includes(current.status) && methods.length>0;

  return <div className="payment-pending-layout">
    <section className="order-intro" style={{marginBottom:14}}>
      <span className="eyebrow"><ShieldCheck size={14}/> Ambiente de testes Asaas</span>
      <h1>Pagamento do pedido</h1>
      <p>Pedido EC-{String(current.request_number || 0).padStart(6,'0')} • {methodName[current.method] || 'Asaas'}</p>
      <p>A geração da cobrança não confirma o recebimento. Nenhum dinheiro real será movimentado no Sandbox.</p>
    </section>

    <section className="panel payment-pending-card">
      <div className="payment-pending-top">
        <div><span className="muted" style={{fontSize:12}}>Total do pedido</span><strong className="payment-pending-total">{money(current.known_total)}</strong></div>
        <span className={'payment-state ' + (current.status==='pago'?'paid':'')}>{statuses[current.status] || 'Em processamento'}</span>
      </div>

      {current.status==='pago' ? <div className="payment-payment-confirmed"><CheckCircle2 size={34}/><strong>Pagamento confirmado pelo Asaas</strong></div> : <>
        {isPix && <div className="payment-pix-area">
          {current.pix_image && <img className="payment-pix-qr" src={'data:image/png;base64,' + current.pix_image} alt="QR Code PIX gerado pelo Asaas"/>}
          {current.pix_payload ? <>
            <label className="payment-pix-label" htmlFor="everclean-pix">PIX Copia e Cola</label>
            <textarea id="everclean-pix" readOnly rows={3} value={current.pix_payload} onFocus={e=>e.target.select()}/>
            <button className="btn btn-primary" onClick={copyPix}><Copy size={17}/>Copiar código PIX</button>
          </> : null}
          {(!current.pix_payload || !current.pix_image) && <div className="payment-pix-warning">
            <strong>PIX ainda não liberado para esta cobrança</strong>
            <p>{current.pix_error || 'O Asaas não retornou o QR Code. Verifique se a conta Sandbox está aprovada e com uma chave PIX ativa.'}</p>
            <button className="btn btn-primary" onClick={retryPix} disabled={refreshingPix || current.status!=='aguardando_pagamento'}>
              <RefreshCw size={16}/>{refreshingPix?'Consultando PIX...':'Tentar obter QR Code novamente'}
            </button>
            <small>Essa tentativa consulta a cobrança existente e não cria outro pedido.</small>
          </div>}
          {current.invoice_url && <a className="btn btn-white" target="_blank" rel="noreferrer noopener" href={current.invoice_url}><ExternalLink size={16}/>Abrir cobrança no Asaas</a>}
        </div>}

        {isBoleto && <div className="payment-actions">
          <p>Seu boleto foi gerado no Asaas. O pagamento ficará aguardando confirmação.</p>
          {current.due_date && <p className="muted">Vencimento: {new Date(current.due_date+'T12:00:00').toLocaleDateString('pt-BR')}</p>}
          {current.boleto_url && <a className="btn btn-primary" href={current.boleto_url} target="_blank" rel="noreferrer noopener"><FileText size={18}/>Visualizar boleto</a>}
          {current.invoice_url && <a className="btn btn-white" href={current.invoice_url} target="_blank" rel="noreferrer noopener"><ExternalLink size={16}/>Abrir cobrança no Asaas</a>}
        </div>}

        {isCard && <div className="payment-actions">
          <p>{current.method==='cartao'
            ? 'Pague com cartão na página segura do Asaas. O próprio Asaas solicitará os dados de contato, endereço e cartão que forem necessários.'
            : 'Abra a fatura no Asaas e escolha uma forma de pagamento disponível para sua conta. Caso o PIX não esteja disponível, utilize cartão ou boleto quando oferecidos.'}</p>
          {current.checkout_url && <a className="btn btn-primary" href={current.checkout_url} target="_blank" rel="noreferrer noopener"><CreditCard size={18}/>{current.method==='cartao'?'Pagar com cartão no Asaas':'Abrir link de pagamento'}</a>}
          {!current.checkout_url && <div className="form-error">O Asaas não retornou o link de pagamento. Entre em contato com a Ever Clean antes de tentar outra cobrança.</div>}
          <span className="muted" style={{fontSize:12}}>Após pagar, volte a esta página para acompanhar a confirmação.</span>
        </div>}

        {['cancelado','estornado'].includes(current.status) && <div className="form-error">Esta cobrança não pode ser alterada. Solicite orientação à Ever Clean.</div>}
        {current.status==='vencido' && <div className="form-error">Esta cobrança venceu. Você pode escolher outra forma de pagamento, se disponível.</div>}
      </>}

      {canChange && <div className="payment-method-switch">
        {!showChange ? <button className="btn btn-white" onClick={()=>{
          setNewMethod(methods[0] || '');
          setChangeError('');
          setShowChange(true);
        }}><ArrowLeftRight size={17}/>Alterar forma de pagamento</button> : <>
          <strong>Escolha outra forma de pagamento</strong>
          <p>O pedido e o valor não mudam. A cobrança existente será atualizada no Asaas. Não utilize o código PIX ou o boleto anterior após a troca.</p>
          <div className="payment-method-switch-options">
            {methods.map(method=><label key={method} className={newMethod===method?'selected':''}>
              <input type="radio" name="new-payment-method" checked={newMethod===method} onChange={()=>setNewMethod(method)}/>
              {methodName[method]}
            </label>)}
          </div>
          {changeError && <div className="form-error" role="alert">{changeError}</div>}
          <div className="payment-method-switch-actions">
            <button className="btn btn-primary" disabled={changingMethod || !newMethod} onClick={submitPaymentMethodChange}>
              <ArrowLeftRight size={16}/>{changingMethod?'Alterando...':'Confirmar alteração'}
            </button>
            <button className="btn btn-white" disabled={changingMethod} onClick={()=>{setShowChange(false);setChangeError('');}}>Cancelar</button>
          </div>
        </>}
      </div>}
      <div className="payment-status-controls">
        <button className="btn btn-white" disabled={checking} onClick={()=>checkStatus(false)}><RefreshCw size={16}/>{checking?'Consultando...':'Consultar pagamento'}</button>
        {lastChecked && <small className="muted">Última consulta: {lastChecked}</small>}
      </div>
    </section>
  </div>;
}
