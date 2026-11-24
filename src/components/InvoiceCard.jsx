import {FileText,FileArchive} from 'lucide-react';
import {formatDateTime} from '../lib/fulfillment.js';

// Nota fiscal autorizada: número, data e downloads (PDF/DANFE e XML).
export default function InvoiceCard({invoice,pdfHref,xmlHref,compact=false}){
  if(!invoice)return null;
  const key=String(invoice.access_key||'');
  return <div style={{padding:compact?11:14,border:'1px solid #bfe0cf',borderRadius:12,
    background:'#f2fbf6',marginTop:compact?10:14}}>
    <strong style={{fontSize:compact?13:14,color:'#17654e',display:'flex',gap:7,alignItems:'center'}}>
      <FileText size={16}/>Nota fiscal nº {invoice.number||'—'}
      {invoice.series&&<span style={{fontWeight:400,color:'#526b60'}}>· série {invoice.series}</span>}
    </strong>
    {invoice.issued_at&&<div style={{fontSize:12,color:'#526b60',marginTop:3}}>
      Emitida em {formatDateTime(invoice.issued_at)}</div>}
    {key.length===44&&!compact&&<div style={{fontSize:11,color:'#647973',marginTop:4,overflowWrap:'anywhere'}}>
      Chave de acesso: {key.replace(/(\d{4})(?=\d)/g,'$1 ')}</div>}
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
      <a className="btn btn-primary btn-sm" href={pdfHref} style={{display:'inline-flex',gap:6}}>
        <FileText size={15}/>Baixar nota (PDF)</a>
      <a className="btn btn-white btn-sm" href={xmlHref} style={{display:'inline-flex',gap:6}}>
        <FileArchive size={15}/>Baixar XML</a>
    </div>
  </div>;
}
