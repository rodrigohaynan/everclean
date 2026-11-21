import crypto from 'node:crypto';
import {getStore} from '@netlify/blobs';

// Registro individual das cobranças de produção. NÃO é o gerenciador financeiro
// definitivo: Netlify Blobs fornece escrita condicional, não transações entre chaves.
// Nenhuma rota pública aciona criação de cobrança nesta etapa.
const DEFAULT_STORE=()=>getStore({name:'everclean-test',consistency:'strong'});
const PREFIX='integrations/asaas-prod/catalog-payments/';
const normalize=value=>String(value||'').trim();
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

export function isProductionReference(value){
  return /^EVERCLEAN-PROD-CATALOG-[0-9a-f]{32}$/i.test(normalize(value));
}
export function productionPaymentKey(reference){
  if(!isProductionReference(reference))throw Error('Referência de produção inválida.');
  return PREFIX+hash(normalize(reference));
}
export function paymentEventState(event){
  if(['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(event))return 'pago';
  if(['PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED',
    'PAYMENT_RECEIVED_IN_CASH_UNDONE','PAYMENT_DELETED'].includes(event))return 'estornado';
  return null;
}
export function matchesProductionPayment(record,payment){
  return Boolean(record?.source==='everclean_production_catalog'&&
    isProductionReference(record?.reference)&&
    normalize(record.reference)===normalize(payment?.externalReference)&&
    /^pay_[a-z0-9_-]{6,}$/i.test(normalize(record.payment_id))&&
    normalize(record.payment_id)===normalize(payment?.id)&&
    Number.isSafeInteger(Number(record.amount_cents))&&Number(record.amount_cents)>0&&
    Number.isFinite(Number(payment?.value))&&
    Math.round(Number(payment.value)*100)===Number(record.amount_cents));
}
export async function reserveProductionPayment({reference,amount_cents,request_number},store=DEFAULT_STORE()){
  if(!isProductionReference(reference)||!Number.isSafeInteger(amount_cents)||amount_cents<100||
    !/^[0-9]{1,10}$/.test(String(request_number||'')))throw Error('Dados de reserva inválidos.');
  const marker={source:'everclean_production_catalog',reference,
    request_number:String(request_number),amount_cents,payment_id:null,
    state:'reservado',created_at:new Date().toISOString()};
  const result=await store.setJSON(productionPaymentKey(reference),marker,{onlyIfNew:true});
  return {reserved:result?.modified===true,reference};
}
export async function attachProductionPayment(reference,paymentId,store=DEFAULT_STORE()){
  if(!/^pay_[a-z0-9_-]{6,}$/i.test(String(paymentId||'')))throw Error('Identificador da cobrança inválido.');
  const key=productionPaymentKey(reference);
  for(let attempt=0;attempt<3;attempt++){
    const current=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
    if(!current)throw Error('Reserva de cobrança não encontrada.');
    const record=current.data;
    if(record?.payment_id){
      if(record.payment_id===paymentId)return {linked:true,already:true};
      throw Error('Reserva já vinculada a outra cobrança. É proibido repetir o envio.');
    }
    if(record?.source!=='everclean_production_catalog'||record?.state!=='reservado')
      throw Error('Reserva de produção inválida.');
    const result=await store.setJSON(key,{...record,payment_id:paymentId,state:'aguardando_pagamento',
      linked_at:new Date().toISOString()},{onlyIfMatch:current.etag});
    if(result?.modified)return {linked:true,already:false};
  }
  throw Error('Conflito de concorrência; pagamento requer conferência manual.');
}
export async function reconcileProductionPaymentEvent(payload,store=DEFAULT_STORE()){
  const reference=normalize(payload?.payment?.externalReference);
  if(!isProductionReference(reference))return {matched:false,reason:'outside_production_catalog'};
  const event=normalize(payload?.event);
  const desired=paymentEventState(event);
  if(!desired)return {matched:false,reason:'event_without_payment_transition'};
  const key=productionPaymentKey(reference);
  for(let attempt=0;attempt<3;attempt++){
    const current=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
    if(!current)return {matched:false,reason:'production_payment_not_registered'};
    const record=current.data;
    if(!matchesProductionPayment(record,payload.payment))
      return {matched:false,reason:'payment_identity_or_amount_mismatch'};
    if(record.state==='estornado'&&desired==='pago')
      return {matched:true,updated:false,state:'estornado'};
    if(record.state===desired)return {matched:true,updated:false,state:desired};
    const result=await store.setJSON(key,{...record,state:desired,
      last_webhook_event:event,last_webhook_event_id:normalize(payload.id).slice(0,255),
      updated_at:new Date().toISOString()},{onlyIfMatch:current.etag});
    if(result?.modified)return {matched:true,updated:true,state:desired};
  }
  throw Error('Conciliação concorrente; evento deve ser reenviado.');
}
