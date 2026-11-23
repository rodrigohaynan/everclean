import React from 'react';
import {FULFILLMENT_LABELS,MAIN_STEPS,normalizeStage,stepIndex,formatDateTime} from '../lib/fulfillment.js';

// Acompanhamento do pedido para o cliente: etapa atual numa linha do tempo
// (Recebido → Separado → Em rota → Entregue) e o histórico de movimentações
// com os comentários da equipe, do mais recente para o mais antigo.
export default function OrderTracking({stage,events=[],paidAt,compact=false}){
  const current=normalizeStage(stage);
  const index=stepIndex(current);
  const history=[...(Array.isArray(events)?events:[])].reverse();
  return <div>
    <ol aria-label="Andamento do pedido" style={{display:'flex',listStyle:'none',padding:0,
      margin:compact?'8px 0':'4px 0 14px',gap:4}}>
      {MAIN_STEPS.map((step,i)=>{
        const done=i<index||(i===index&&current==='delivered');
        const active=i===index&&current!=='delivered';
        return <li key={step.stage} aria-current={active?'step':undefined}
          style={{flex:1,textAlign:'center',fontSize:11,fontWeight:active?700:500,
            color:active?'#0b5d4f':done?'#3d7a68':'#8a9a95'}}>
          <span style={{display:'block',height:6,borderRadius:3,marginBottom:6,
            background:done?'#7cc3a7':active?'#0b766a':'#e3ebe7'}}/>
          {step.label}
        </li>;
      })}
    </ol>
    <p style={{fontSize:compact?13:15,fontWeight:700,color:current==='on_hold'?'#8a5a12':'#173f34'}}>
      {FULFILLMENT_LABELS[current]}
    </p>
    {current==='on_hold'&&<p style={{fontSize:12,color:'#8a5a12',marginTop:4}}>
      Algum item está aguardando disponibilidade. A equipe vai informar a previsão.
    </p>}
    {history.length>0&&<ul aria-label="Histórico do pedido" style={{listStyle:'none',padding:0,
      margin:'12px 0 0',display:'grid',gap:8}}>
      {history.map((event,i)=><li key={i} style={{padding:'10px 12px',borderRadius:10,
        background:i===0?'#eef8f4':'#f6f8f7',borderLeft:'3px solid '+(i===0?'#0b766a':'#cfdcd6')}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12}}>
          <strong style={{color:'#234b40'}}>
            {FULFILLMENT_LABELS[normalizeStage(event.stage)]}{event.stage_changed===false?' · atualização':''}
          </strong>
          <span style={{color:'#6a7d77',whiteSpace:'nowrap'}}>{formatDateTime(event.at)}</span>
        </div>
        {event.note&&<p style={{fontSize:13,color:'#3b544d',marginTop:4,lineHeight:1.45,
          overflowWrap:'anywhere'}}>{event.note}</p>}
      </li>)}
    </ul>}
    {paidAt&&<p style={{fontSize:11,color:'#6a7d77',marginTop:10}}>
      Pagamento confirmado em {formatDateTime(paidAt)}.
    </p>}
  </div>;
}
