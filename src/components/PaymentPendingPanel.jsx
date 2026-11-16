import React from 'react';
import {CheckCircle2, Copy, CreditCard, ExternalLink, FileText, RefreshCw, ShieldCheck} from 'lucide-react';
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
  const [lastChecked,setLastChecked] = React.useState('');
  React.useEffect(() => setCurrent(payment),[payment]);

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
          </> : <p className="muted">O QR Code não foi retornado. Abra a cobrança para consultar os dados de pagamento.</p>}
          {current.invoice_url && <a className="btn btn-white" target="_blank" rel="noreferrer noopener" href={current.invoice_url}><ExternalLink size={16}/>Abrir cobrança Asaas</a>}
        </div>}

        {isBoleto && <div className="payment-actions">
          <p>Seu boleto foi gerado no Asaas. O pagamento ficará aguardando confirmação.</p>
          {current.due_date && <p className="muted">Vencimento: {new Date(current.due_date+'T12:00:00').toLocaleDateString('pt-BR')}</p>}
          {current.boleto_url && <a className="btn btn-primary" href={current.boleto_url} target="_blank" rel="noreferrer noopener"><FileText size={18}/>Visualizar boleto</a>}
          {current.invoice_url && <a className="btn btn-white" href={current.invoice_url} target="_blank" rel="noreferrer noopener"><ExternalLink size={16}/>Abrir cobrança no Asaas</a>}
        </div>}

        {isCard && <div className="payment-actions">
          <p>Finalize o pagamento no ambiente seguro do Asaas. Os dados do cartão não são armazenados pela Ever Clean.</p>
          {current.checkout_url && <a className="btn btn-primary" href={current.checkout_url} target="_blank" rel="noreferrer noopener"><CreditCard size={18}/>Abrir checkout Asaas</a>}
          <span className="muted" style={{fontSize:12}}>Após pagar, volte a esta página para acompanhar a confirmação.</span>
        </div>}

        {['cancelado','vencido','estornado'].includes(current.status) && <div className="form-error">Esta cobrança não está ativa. Solicite um novo link de pedido à Ever Clean.</div>}
      </>}

      <div className="payment-status-controls">
        <button className="btn btn-white" disabled={checking} onClick={()=>checkStatus(false)}><RefreshCw size={16}/>{checking?'Consultando...':'Consultar pagamento'}</button>
        {lastChecked && <small className="muted">Última consulta: {lastChecked}</small>}
      </div>
    </section>
  </div>;
}
