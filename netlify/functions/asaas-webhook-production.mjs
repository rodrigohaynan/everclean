import crypto from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {reconcileProductionPaymentEvent,isProductionReference} from '../shared/everclean-production-payments.mjs';
import {reconcileProductionDbEvent} from '../shared/everclean-transactional-checkout.mjs';
import {json,getJson,setJson,env} from '../shared/everclean-asaas.mjs';

// Receptor separado de Produção em modo monitoramento.
// Nunca marca como pagos pedidos Sandbox; não cria pedidos Bling ou notas fiscais.
export default async function handler(request){
  if(request.method==='GET')return json({ok:true,service:'Ever Clean Asaas produção',mode:'monitoramento_sem_cobrancas'});
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const expected=String(env('ASAAS_PROD_WEBHOOK_TOKEN'));
  if(expected.length<32||expected.length>255)return json({ok:false,message:'Webhook de produção não configurado.'},503);
  const provided=String(request.headers.get('asaas-access-token')||'');
  const e=Buffer.from(expected),p=Buffer.from(provided);
  if(e.length!==p.length||!crypto.timingSafeEqual(e,p))return json({ok:false,message:'Não autorizado.'},401);
  if(Number(request.headers.get('content-length')||0)>1024*1024)return json({ok:false,message:'Evento muito grande.'},413);
  let payload;
  try{payload=await request.json()}catch{return json({ok:false,message:'JSON inválido.'},400)}
  if(!payload||typeof payload.id!=='string'||typeof payload.event!=='string'||payload.id.length>255||payload.event.length>90){
    return json({ok:false,message:'Evento inválido.'},400);
  }
  const isSelfTest=payload.event==='EVERCLEAN_WEBHOOK_SELF_TEST'&&
    /^evt_everclean_selftest_[0-9a-f]{24}$/.test(payload.id);
  if(payload.event==='EVERCLEAN_WEBHOOK_SELF_TEST'&&!isSelfTest){
    return json({ok:false,message:'Teste técnico inválido.'},400);
  }
  const fingerprint=crypto.createHash('sha256').update(payload.id).digest('hex');
  const key=isSelfTest
    ?'integrations/asaas-prod/selftest-events/'+fingerprint
    :'integrations/asaas-prod/events/'+fingerprint;
  try{
    // Registrar recebimento antes de processar. Se houver falha, um reenvio poderá
    // retomar o evento enquanto ainda não estiver marcado como processado.
    const store=getStore({name:'everclean-test',consistency:'strong'});
    const existing=await getJson(key,null);
    if(existing&&(existing.state==='processed'||!existing.state))
      return json({ok:true,duplicate:true});
    if(!existing)await store.setJSON(key,{
      state:'received',event:payload.event,received_at:new Date().toISOString()
    },{onlyIfNew:true});
    const entry={
      event:payload.event,
      received_at:new Date().toISOString(),
      // Não salvar CPF/CNPJ, dados de compradores, pagamentos nem segredos.
      linked_to_catalog:false,
      mode:isSelfTest?'teste_tecnico':'monitoramento'
    };
    if(!isSelfTest){
      // Concilia somente o registro financeiro de produção com referência e
      // pagamento coincidentes. Nunca atualiza pedidos Sandbox/Bl ing/NF-e.
      const catalogReference=String(payload.payment?.externalReference||'');
      const transactional=isProductionReference(catalogReference);
      const reconciliation=transactional
        ?await reconcileProductionDbEvent(payload)
        :await reconcileProductionPaymentEvent(payload);
      // No checkout transacional, um pagamento ainda sem vínculo ou com valor
      // divergente deve ser reenviado. Nunca confirmar sem identificar ID e valor.
      if(transactional&&!reconciliation.matched&&
          !['untracked_event'].includes(String(reconciliation.reason||''))){
        throw new Error('Conciliação transacional pendente; solicitar reentrega do evento.');
      }
      entry.linked_to_catalog=reconciliation.matched===true;
      entry.mode=reconciliation.matched?'conciliacao_producao':'monitoramento';
      // Evento REAL, autenticado pelo token do webhook, ligado SOMENTE ao PIX piloto.
      // Não altera pedidos normais, estoque, Bling ou NF-e.
      const pilotKey='integrations/asaas-prod/pilot/first-payment';
      const pilot=await getJson(pilotKey,null);
      const eventPaymentId=String(payload.payment?.id||'');
      const eventReference=String(payload.payment?.externalReference||'');
      const matches=Boolean(pilot&&(
        (eventPaymentId&&pilot.payment_id===eventPaymentId)||
        (eventReference&&pilot.external_reference===eventReference)
      ));
      if(matches){
        const paid=['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(payload.event);
        const reversed=['PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_RECEIVED_IN_CASH_UNDONE'].includes(payload.event);
        // Nunca reverter automaticamente uma reversão financeira para pago
        // quando o Asaas entregar eventos fora de ordem.
        if((paid||reversed)&&!(paid&&pilot.state==='reversao')){
          await setJson(pilotKey,{...pilot,
            state:reversed?'reversao': 'pago',
            payment_status:reversed?'REFUNDED':'RECEIVED',
            payment_id:pilot.payment_id||eventPaymentId||null,
            last_webhook_event:payload.event,
            last_webhook_at:entry.received_at,
            updated_at:entry.received_at
          });
        }
      }
    }
    if(isSelfTest){
      await setJson('integrations/asaas-prod/webhook-last-selftest',{
        received_at:entry.received_at,accepted:true,kind:'teste_tecnico'
      });
      await setJson(key,{...entry,state:'processed'});
      return json({ok:true,received:true,technical_test:true,orders_updated:0});
    }
    const recent=await getJson('integrations/asaas-prod/webhook-recent',[]);
    await setJson('integrations/asaas-prod/webhook-recent',[entry,...(Array.isArray(recent)?recent:[])].slice(0,12));
    await setJson(key,{...entry,state:'processed'});
    return json({ok:true,received:true,orders_updated:0,
      production_payment_reconciled:entry.linked_to_catalog});
  }catch(error){
    console.error('Ever Clean Asaas prod event persistence:',String(error?.message||'failed').slice(0,100));
    return json({ok:false,message:'Não foi possível armazenar o evento.'},500);
  }
}
