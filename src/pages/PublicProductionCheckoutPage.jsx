import React from 'react';
import {LockKeyhole, ShieldCheck} from 'lucide-react';

// Rota dedicada futura ao checkout real. Esta etapa não aceita cobranças.
// Nunca reutilizar testApi('create_payment') aqui: ele é exclusivo do Sandbox.
export default function PublicProductionCheckoutPage(){
  return <div className="success" style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:20}}>
    <div className="success-card" style={{width:'100%',maxWidth:500}}>
      <LockKeyhole size={44} color="#11664d" style={{marginBottom:14}}/>
      <h1>Pagamento de produção ainda não liberado</h1>
      <p>O checkout real da Ever Clean está em preparação e este endereço ainda não recebe pedidos ou pagamentos.</p>
      <p className="muted">Para solicitar produtos, utilize o link de catálogo enviado diretamente pela Ever Clean.</p>
      <div style={{display:'flex',alignItems:'center',gap:8,marginTop:16,fontSize:12,color:'#17654e'}}>
        <ShieldCheck size={16}/> Nenhuma cobrança foi realizada nesta página.
      </div>
    </div>
  </div>;
}
