import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {automaticExportStart,dispatchPaidAutomatically} from './bling-production-dispatch.mjs';

// Agendamento preparado de 5 em 5 minutos, DESLIGADO POR PADRÃO.
// Não conecta ao webhook e não cria PIX. Só processa pedidos NOVOS com pagamento
// recebido após EVERCLEAN_BLING_AUTO_START_AT quando a autorização privada existir.
// A fila só processa UM pedido por execução para respeitar limites da API do Bling.
// Falha no envio => tentativa bloqueada transacionalmente e sem reenvio automático.
export const config={schedule:'*/5 * * * *'};
export default async function handler(){
  const activation=automaticExportStart();
  if(!activation)return Response.json({ok:true,enabled:false,processed:0,
    message:'Agendamento instalado e bloqueado. Nenhum pedido enviado.'});
  try{
    const {rows}=await checkoutDb().query(
      "SELECT o.request_number FROM everclean_private.checkout_orders o "+
      "WHERE o.state='paid' AND o.paid_at>=$1::timestamptz "+
      "AND o.created_at>=$1::timestamptz "+
      "AND o.request_number ~ '^[1-9][0-9]{0,9}$' "+
      "AND o.payment_state IN ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED') "+
      "AND NOT EXISTS (SELECT 1 FROM everclean_private.bling_export_intents i "+
      "WHERE i.checkout_order_id=o.id) "+
      "ORDER BY o.paid_at ASC LIMIT 1",
      [activation]
    );
    if(!rows.length)return Response.json({ok:true,enabled:true,processed:0,
      message:'Sem novos pedidos pagos elegíveis.'});
    const result=await dispatchPaidAutomatically(rows[0].request_number);
    const parsed=await result.clone().json().catch(()=>({ok:false}));
    return Response.json({
      ok:result.ok&&parsed?.ok===true,
      enabled:true,
      processed:parsed?.ok&&parsed?.already_exists!==true?1:0,
      already_exists:parsed?.already_exists===true,
      manual_review:parsed?.manual_review===true,
      // Nunca retornar dados pessoais, CPF/CNPJ, ID de pagamento ou segredos.
      message:parsed?.manual_review?
        'Envio inconclusivo: verificar Bling manualmente, sem reenvio.':
        result.ok?'Execução controlada concluída.':
          'Pedido requer conferência. Não repetir envio automaticamente.'
    },{status:result.ok?200:202});
  }catch(error){
    console.error('Ever Clean auto export runner:',String(error?.message||'failure').slice(0,90));
    return Response.json({ok:false,enabled:true,processed:0,
      message:'Execução automática falhou; nenhuma repetição iniciada.'},{status:500});
  }
}
