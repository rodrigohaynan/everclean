import {FileText,Printer,FileArchive} from 'lucide-react';
import {formatDateTime} from '../lib/fulfillment.js';

// Documentos do pedido pago: resumo do pedido e nota fiscal, cada um com
// "Imprimir" (abre o PDF no navegador, onde dá para imprimir ou salvar) e
// "Baixar". O XML da nota fica como link secundário.
export default function OrderDocuments({token,pdfAvailable,pdfExpired,invoice}){
  const q='token='+encodeURIComponent(token);
  const orderPdf='/.netlify/functions/bling-customer-order-pdf?'+q;
  const invoicePdf='/.netlify/functions/order-invoice?format=pdf&'+q;
  const row={display:'flex',gap:8,flexWrap:'wrap',marginTop:10};
  const box={padding:14,border:'1px solid #d9e6e0',borderRadius:12,background:'#fff'};
  return <div style={{display:'grid',gap:12}}>
    <div style={box}>
      <strong style={{display:'flex',gap:7,alignItems:'center',color:'#17443e'}}>
        <FileText size={17}/>Pedido</strong>
      {pdfAvailable?<div style={row}>
        <a className="btn btn-primary btn-sm" href={orderPdf+'&view=1'} target="_blank" rel="noopener">
          <Printer size={15}/>Imprimir pedido</a>
        <a className="btn btn-white btn-sm" href={orderPdf}><FileText size={15}/>Baixar PDF</a>
      </div>:<p className="muted" style={{fontSize:12,marginTop:6}}>
        {pdfExpired?'A via digital deste pedido não está mais disponível. Solicite uma nova via à Ever Clean.':
          'A via do pedido fica disponível após a confirmação do pagamento.'}</p>}
    </div>
    <div style={{...box,...(invoice?{borderColor:'#bfe0cf',background:'#f2fbf6'}:{})}}>
      <strong style={{display:'flex',gap:7,alignItems:'center',color:invoice?'#17654e':'#17443e'}}>
        <FileText size={17}/>{invoice?'Nota fiscal nº '+(invoice.number||'—'):'Nota fiscal'}
        {invoice?.series&&<span style={{fontWeight:400,color:'#526b60'}}>· série {invoice.series}</span>}
      </strong>
      {invoice?<>
        {invoice.issued_at&&<div style={{fontSize:12,color:'#526b60',marginTop:3}}>
          Emitida em {formatDateTime(invoice.issued_at)}</div>}
        <div style={row}>
          <a className="btn btn-primary btn-sm" href={invoicePdf+'&view=1'} target="_blank" rel="noopener">
            <Printer size={15}/>Imprimir nota</a>
          <a className="btn btn-white btn-sm" href={invoicePdf}><FileText size={15}/>Baixar PDF</a>
          <a className="btn btn-white btn-sm" href={'/.netlify/functions/order-invoice?format=xml&'+q}>
            <FileArchive size={15}/>XML</a>
        </div>
        {String(invoice.access_key||'').length===44&&
          <div style={{fontSize:11,color:'#647973',marginTop:8,overflowWrap:'anywhere'}}>
            Chave de acesso: {String(invoice.access_key).replace(/(\d{4})(?=\d)/g,'$1 ')}</div>}
      </>:<p className="muted" style={{fontSize:12,marginTop:6}}>
        A nota fiscal aparece aqui assim que for emitida pela Ever Clean.</p>}
    </div>
  </div>;
}
