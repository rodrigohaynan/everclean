import React from 'react';

export const PAYMENT_INFO={
  pix:{label:'PIX',hint:'QR Code ou Copia e Cola. Confirmação na hora.'},
  cartao:{label:'Cartão de crédito',hint:'Pagamento na página segura do Asaas.'},
  link:{label:'Link de pagamento',hint:'Escolha como pagar na página do Asaas.'},
  boleto:{label:'Boleto a prazo',hint:days=>'Vencimento em '+(days||30)+' dias.'}
};
export const paymentName=method=>PAYMENT_INFO[method]?.label||'PIX';

// Lista única de formas de pagamento (portal e página do pedido).
export default function PaymentMethodPicker({methods=['pix'],value,onChange,
  disabled=false,boletoDays=30,name='payment-method'}){
  const order=['pix','cartao','link','boleto'].filter(m=>methods.includes(m));
  return <div role="radiogroup" aria-label="Forma de pagamento" style={{display:'grid',gap:8}}>
    {order.map(method=>{
      const info=PAYMENT_INFO[method],selected=value===method;
      const hint=typeof info.hint==='function'?info.hint(boletoDays):info.hint;
      return <label key={method} style={{display:'flex',gap:12,alignItems:'center',
        padding:'12px 14px',borderRadius:12,cursor:disabled?'not-allowed':'pointer',
        border:'1px solid '+(selected?'#0b766a':'#dfe6ea'),
        background:selected?'#ecf8f5':'#fff',opacity:disabled?0.7:1}}>
        <input type="radio" name={name} value={method} checked={selected}
          disabled={disabled} onChange={()=>onChange(method)}/>
        <span style={{minWidth:0}}>
          <strong style={{fontSize:14}}>{info.label}</strong>
          <span style={{display:'block',fontSize:12,color:'#5a706a',marginTop:2}}>{hint}</span>
        </span>
      </label>;
    })}
  </div>;
}
