import React from 'react';

// Etapas do pedido, iguais no portal e na página do pedido:
// Produtos → Conferir → Pagamento → Pagar → Acompanhar.
export const CHECKOUT_STEPS=['Produtos','Conferir','Pagamento','Pagar','Acompanhar'];

export default function CheckoutSteps({current=0}){
  return <ol aria-label="Etapas do pedido" style={{display:'flex',gap:4,listStyle:'none',
    padding:0,margin:'0 0 14px',overflowX:'auto'}}>
    {CHECKOUT_STEPS.map((label,index)=>{
      const done=index<current,active=index===current;
      return <li key={label} aria-current={active?'step':undefined}
        style={{flex:'1 1 0',minWidth:58,textAlign:'center',fontSize:11,
          color:active?'#0b5d4f':done?'#3d7a68':'#8a9a95',fontWeight:active?700:500}}>
        <span style={{display:'flex',alignItems:'center',justifyContent:'center',
          width:24,height:24,margin:'0 auto 4px',borderRadius:12,fontSize:12,
          background:active?'#0b766a':done?'#cfe9df':'#eef2f1',
          color:active?'#fff':done?'#0b5d4f':'#8a9a95'}}>
          {done?'✓':index+1}
        </span>
        {label}
      </li>;
    })}
  </ol>;
}
