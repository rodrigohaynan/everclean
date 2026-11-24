import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {getJson,setJson,blingIssueKey as issueKey} from '../shared/everclean-bling.mjs';
import {automaticExportStart,dispatchPaidAutomatically} from './bling-production-dispatch.mjs';

// Agendamento de 5 em 5 minutos, ligado por duas configurações privadas.
// Só processa pedidos pagos após EVERCLEAN_BLING_AUTO_START_AT.
//
// No máximo UM pedido é criado no Bling por execução (limite da API).
// Um pedido recusado na conferência (antes de qualquer envio) não trava mais
// a fila: o motivo fica registrado para o admin e a rotina passa ao próximo.
// Os recusados voltam a ser conferidos em rodízio, depois dos que nunca
// foram tentados, e seguem sozinhos quando o problema for resolvido.
// Falha DURANTE o envio => tentativa bloqueada, sem reenvio automático.
export const config={schedule:'*/5 * * * *'};

const MAX_CANDIDATES=25;
const TIME_BUDGET_MS=15000;

async function lastIssue(number){
  return getJson(issueKey(number),null).catch(()=>null);
}
async function recordIssue(number,issue){
  await setJson(issueKey(number),{...issue,at:new Date().toISOString()}).catch(error=>
    console.warn('Ever Clean auto export: falha ao registrar pendência',String(error?.message||'').slice(0,60)));
}

// 409 e 403 são devolvidos antes da reserva da tentativa: nenhum POST no Bling.
// Exceções que escapam de dispatch também ocorrem antes da reserva.
const rejectedBeforeSend=status=>status===409||status===403;

export default async function handler(){
  const activation=automaticExportStart();
  if(!activation)return Response.json({ok:true,enabled:false,processed:0,
    message:'Agendamento instalado e bloqueado. Nenhum pedido enviado.'});
  const started=Date.now();
  let candidates;
  try{
    ({rows:candidates}=await checkoutDb().query(
      "SELECT o.request_number FROM everclean_private.checkout_orders o "+
      // Pagos, ou boleto a prazo liberado (cliente autorizado) ainda em aberto.
      "WHERE ((o.state='paid' AND o.paid_at>=$1::timestamptz "+
      "AND o.payment_state IN ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED')) "+
      "OR (o.state='payment_pending' AND o.released_at>=$1::timestamptz)) "+
      "AND o.created_at>=$1::timestamptz "+
      "AND o.request_number ~ '^[1-9][0-9]{0,9}$' "+
      "AND NOT EXISTS (SELECT 1 FROM everclean_private.bling_export_intents i "+
      "WHERE i.checkout_order_id=o.id) "+
      "ORDER BY coalesce(o.released_at,o.paid_at) ASC LIMIT "+MAX_CANDIDATES,
      [activation]
    ));
  }catch(error){
    console.error('Ever Clean auto export runner:',String(error?.message||'failure').slice(0,90));
    return Response.json({ok:false,enabled:true,processed:0,
      message:'Execução automática falhou; nenhuma repetição iniciada.'},{status:500});
  }
  if(!candidates.length)return Response.json({ok:true,enabled:true,processed:0,
    message:'Sem novos pedidos pagos elegíveis.'});

  // Nunca tentados primeiro (pela data do pagamento); depois, os recusados
  // que estão há mais tempo sem nova conferência.
  const issues=await Promise.all(candidates.map(c=>lastIssue(c.request_number)));
  const queue=candidates.map((c,i)=>({number:c.request_number,order:i,
    checked:issues[i]?.at?Date.parse(issues[i].at)||0:-1}))
    .sort((a,b)=>a.checked-b.checked||a.order-b.order);

  const skipped=[];
  for(const {number} of queue){
    if(Date.now()-started>TIME_BUDGET_MS)break;
    let result,parsed;
    try{
      result=await dispatchPaidAutomatically(number);
      parsed=await result.clone().json().catch(()=>({ok:false}));
    }catch(error){
      const reason=String(error?.message||'Falha na conferência.').slice(0,160);
      console.warn('Ever Clean auto export: pedido',number,'não conferido:',reason);
      await recordIssue(number,{issues:[reason],message:'Conferência não concluída; nova tentativa automática.'});
      skipped.push(number);
      continue;
    }
    if(rejectedBeforeSend(result.status)&&parsed?.already_exists!==true){
      const reasons=(Array.isArray(parsed?.issues)&&parsed.issues.length?parsed.issues:[parsed?.message])
        .filter(Boolean).map(x=>String(x).slice(0,200));
      console.warn('Ever Clean auto export: pedido',number,'pendente:',reasons.join(' | '));
      await recordIssue(number,{issues:reasons,message:String(parsed?.message||'').slice(0,200)});
      skipped.push(number);
      continue;
    }
    return Response.json({
      ok:result.ok&&parsed?.ok===true,
      enabled:true,
      processed:parsed?.ok&&parsed?.already_exists!==true?1:0,
      request_number:number,
      skipped,
      already_exists:parsed?.already_exists===true,
      manual_review:parsed?.manual_review===true,
      // Nunca retornar dados pessoais, CPF/CNPJ, ID de pagamento ou segredos.
      message:parsed?.manual_review?
        'Envio inconclusivo: verificar Bling manualmente, sem reenvio.':
        result.ok?'Execução controlada concluída.':
          'Pedido requer conferência. Não repetir envio automaticamente.'
    },{status:result.ok?200:202});
  }
  return Response.json({ok:true,enabled:true,processed:0,skipped,
    message:'Nenhum pedido pronto para envio; pendências registradas para o admin.'},{status:202});
}
