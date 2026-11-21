// Política Ever Clean: comunicações de cobrança somente pelos canais de e-mail
// já habilitados para cada cliente. Não criar novas notificações nem cobranças.
// API oficial: GET /customers/{id}/notifications, PUT /notifications/batch.
const SAFE_ID=/^cus_[a-zA-Z0-9_-]{5,100}$/;
const NOTICE_ID=/^not_[a-zA-Z0-9_-]{5,100}$/;
const CHANNELS=[
  'smsEnabledForCustomer','whatsappEnabledForCustomer',
  'phoneCallEnabledForCustomer','smsEnabledForProvider'
];

export function notificationStatus(list){
  if(!Array.isArray(list)||!list.length)throw Error('Asaas: notificações do cliente indisponíveis.');
  if(list.length>100)throw Error('Asaas: excesso de configurações de notificação.');
  for(const n of list){
    if(!n||!NOTICE_ID.test(String(n.id||''))||
      typeof n.emailEnabledForCustomer!=='boolean'||
      typeof n.emailEnabledForProvider!=='boolean'||
      CHANNELS.some(key=>typeof n[key]!=='boolean'))
      throw Error('Asaas: formato inesperado das notificações do cliente.');
  }
  const needsChange=list.some(n=>CHANNELS.some(key=>n[key]!==false));
  return {needsChange,count:list.length,channelsSafe:!needsChange};
}

export async function enforceEmailOnlyNotifications(customerId,asaasRequest){
  if(!SAFE_ID.test(String(customerId||''))||typeof asaasRequest!=='function')
    throw Error('Asaas: cliente inválido para configurar notificações.');
  const endpoint='/customers/'+encodeURIComponent(customerId)+'/notifications';
  const current=await asaasRequest(endpoint);
  if(current?.hasMore===true)throw Error('Asaas: notificações paginadas; política incompleta.');
  const list=current?.data;
  const status=notificationStatus(list);

  if(status.needsChange){
    const edits=list.map(n=>({
      id:n.id,
      // Preservar as preferências anteriores de e-mail e eventos desligados.
      emailEnabledForCustomer:n.emailEnabledForCustomer,
      emailEnabledForProvider:n.emailEnabledForProvider,
      smsEnabledForCustomer:false,
      whatsappEnabledForCustomer:false,
      phoneCallEnabledForCustomer:false,
      smsEnabledForProvider:false
    }));
    await asaasRequest('/notifications/batch',{
      customer:customerId,notifications:edits
    },'PUT');
  }

  // A verificação é obrigatória, mesmo quando o lote não precisou de mudança:
  // nenhum PIX novo pode ser emitido se o Asaas não confirmar todos os canais.
  const after=await asaasRequest(endpoint);
  if(after?.hasMore===true)throw Error('Asaas: confirmação de notificações incompleta.');
  const applied=notificationStatus(after?.data);
  if(applied.needsChange||applied.count!==status.count)
    throw Error('Asaas: canais pagos ainda habilitados; cobrança bloqueada.');
  const priorIds=new Set(list.map(n=>n.id));
  if(after.data.some(n=>!priorIds.has(n.id)))
    throw Error('Asaas: conjunto de notificações mudou durante a configuração.');
  return {safe:true,email_preserved:true,notifications_checked:applied.count,
    channels_disabled:['sms','whatsapp','voice','provider_sms']};
}
