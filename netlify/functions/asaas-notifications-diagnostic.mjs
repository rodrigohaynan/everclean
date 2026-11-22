import legacy from '../shared/admin-api/index.mjs';
import {json,requireSecureAdmin,getJson} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {asaasProduction} from '../shared/everclean-live-checkout.mjs';
import {enforceEmailOnlyNotifications,notificationStatus} from '../shared/everclean-asaas-notifications.mjs';

// Ação diagnose: apenas consultas GET autenticadas.
// Ação repair: alteração explícita SOMENTE de canais pagos, depois GET de conferência.
// Ação disable_uncertain: opcional e confirmada separadamente; desliga uma
// notificação ativa que o Asaas não permite comprovar como segura. O e-mail
// desse evento também para, mas todas as outras notificações são preservadas.
// Nenhuma das ações cria PIX, pedidos, clientes, estoque ou NF-e.
// Nunca retornar CPF/CNPJ, customer ID, notification ID ou payload bruto do Asaas.
const keys=[
  'id','enabled','emailEnabledForCustomer','emailEnabledForProvider',
  'smsEnabledForCustomer','smsEnabledForProvider',
  'whatsappEnabledForCustomer','phoneCallEnabledForCustomer'
];
const channels=['smsEnabledForCustomer','smsEnabledForProvider',
  'whatsappEnabledForCustomer','phoneCallEnabledForCustomer'];
const digits=value=>String(value||'').replace(/\D/g,'');
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const input=await request.json().catch(()=>null);
  if(!['diagnose','repair','disable_uncertain'].includes(input?.action)||
    String(input?.request_number)!=='1000000000')
    return json({ok:false,message:'Operação permitida apenas para o piloto autorizado.'},403);
  if(input.action==='repair'&&input.confirm!==true)
    return json({ok:false,message:'Confirmação explícita necessária para corrigir notificações.'},403);
  if(input.action==='disable_uncertain'&&
    (input.confirm!==true||
      input.acknowledge!=='DESATIVAR_NOTIFICACAO_E_EMAIL_DO_EVENTO'))
    return json({ok:false,message:'É necessário concordar que a notificação e o e-mail deste evento serão desativados.'},403);
  try{
    const q=await checkoutDb().query(
      "SELECT customer_id,payment_authorized,payment_max_cents FROM everclean_private.production_catalog_links "+
      "WHERE request_number='1000000000' AND status='prepared' LIMIT 1"
    );
    if(!q.rowCount)return json({ok:false,message:'Link não encontrado.'},404);
    const list=await getJson('data/clients',[]);
    const customer=Array.isArray(list)?
      list.find(x=>String(x.id)===String(q.rows[0].customer_id)):null;
    if(!customer)return json({ok:false,message:'Cliente do piloto não encontrado.'},404);
    const doc=digits(customer.document||customer.cpf_cnpj);
    if(![11,14].includes(doc.length))return json({ok:false,message:'Documento inválido no cadastro.'},409);
    const found=await asaasProduction('/customers?cpfCnpj='+encodeURIComponent(doc));
    const matches=Array.isArray(found?.data)?found.data.filter(x=>digits(x.cpfCnpj)===doc):[];
    if(matches.length!==1||!/^cus_[a-z0-9_-]{5,100}$/i.test(String(matches[0].id||'')))
      return json({ok:false,message:'Cliente Asaas não identificado de forma única.'},409);
    let repairResult=null;
    if(input.action!=='diagnose'){
      if(q.rows[0].payment_authorized!==true||
        Number(q.rows[0].payment_max_cents)!==2669)
        return json({ok:false,message:'Autorização do piloto não está vigente.'},403);
      try{
        if(input.action==='repair'){
          const applied=await enforceEmailOnlyNotifications(matches[0].id,asaasProduction);
          repairResult={verified:true,count:applied.notifications_checked,
            mode:'paid_channels_only'};
        }else{
          const endpoint='/customers/'+encodeURIComponent(matches[0].id)+'/notifications';
          const before=await asaasProduction(endpoint);
          if(before?.hasMore===true||!Array.isArray(before?.data)||
             before.data.length===0||before.data.length>100)
            throw Error('Lista de notificações incompleta.');
          notificationStatus(before.data);
          const uncertain=before.data.filter(n=>n.enabled===true&&
            n.whatsappEnabledForCustomer===undefined);
          if(uncertain.length!==1)
            throw Error('Não há exatamente uma notificação ativa com WhatsApp indefinido.');
          const item=uncertain[0];
          if(!/^not_[a-zA-Z0-9_-]{5,100}$/.test(String(item.id||'')))
            throw Error('Identificador da notificação inválido.');
          // Esta operação é pontual; o usuário aceitou que o e-mail
          // deste evento também não será enviado.
          await asaasProduction('/notifications/'+encodeURIComponent(item.id),
            {enabled:false},'PUT');
          const after=await asaasProduction(endpoint);
          if(after?.hasMore===true||!Array.isArray(after?.data)||
            after.data.length!==before.data.length)
            throw Error('Confirmação incompleta após desativação.');
          const prev=new Map(before.data.map(n=>[n.id,n]));
          const now=new Map(after.data.map(n=>[n.id,n]));
          if(now.size!==prev.size||!now.has(item.id)||
             now.get(item.id).enabled!==false)
            throw Error('Asaas não confirmou a desativação da notificação.');
          for(const [id,old] of prev){
            const current=now.get(id);
            if(!current||
               current.emailEnabledForCustomer!==old.emailEnabledForCustomer||
               current.emailEnabledForProvider!==old.emailEnabledForProvider)
              throw Error('Asaas alterou preferências de e-mail inesperadamente.');
            if(id!==item.id&&current.enabled!==old.enabled)
              throw Error('Outra notificação teve seu estado alterado.');
          }
          const status=notificationStatus(after.data);
          if(status.needsChange)throw Error('Ainda existem canais pagos não confirmados.');
          repairResult={verified:true,count:status.count,mode:'disable_one',
            event:String(item.event||'evento não identificado').slice(0,70),
            affected_notice_number:before.data.indexOf(item)+1,
            email_of_this_event_disabled:true};
        }
      }catch(error){
        console.warn('Asaas não confirmou ajuste:',String(error?.message||'').slice(0,135));
        repairResult={verified:false,mode:input.action,
          message:'Asaas não confirmou a alteração. Não gerar PIX. Consulte novamente antes de qualquer nova tentativa.'};
      }
    }
    const response=await asaasProduction('/customers/'+encodeURIComponent(matches[0].id)+'/notifications');
    const list2=response?.data;
    if(!Array.isArray(list2)){
      return json({ok:true,diagnosis:'unexpected_list',
        response_is_object:!!response&&typeof response==='object',
        list_type:Array.isArray(list2)?'array':typeof list2,
        message:'Asaas não retornou uma lista de notificações. Nenhuma alteração executada.'});
    }
    const issues=list2.slice(0,100).map((n,i)=>{
      const bad=[];
      if(!n||typeof n!=='object')bad.push('notification_not_object');
      else for(const key of keys){
        const v=n[key];
        if(key==='id'){
          if(!/^not_[a-z0-9_-]{5,100}$/i.test(String(v||'')))
            bad.push('id:unexpected_shape');
        }else if(typeof v!=='boolean')
          bad.push(key+':'+(v===null?'null':typeof v));
      }
      const status=n?.enabled===true?'ATIVA':n?.enabled===false?
        'DESATIVADA':'STATUS DESCONHECIDO';
      // Incluir o estado no próprio texto do campo: navegadores com a versão
      // antiga da interface ainda exibem a informação antes de atualizar o JS.
      return {index:i,active:n?.enabled===true,status,
        event:String(n?.event||'desconhecido').slice(0,70),
        schedule_offset:Number.isFinite(Number(n?.scheduleOffset))?
          Number(n.scheduleOffset):null,
        fields:bad.map(x=>x+' [NOTIFICAÇÃO '+status+']')};
    }).filter(x=>x.fields.length);
    const channelSummary=Object.fromEntries(channels.map(key=>[key,{
      enabled:list2.filter(n=>n?.enabled===true&&n?.[key]===true).length,
      unknown:list2.filter(n=>n?.enabled===true&&typeof n?.[key]!=='boolean').length
    }]));
    let paidChannelsVerified=false;
    try{
      const verified=notificationStatus(list2);
      paidChannelsVerified=!verified.needsChange&&response?.hasMore!==true;
    }catch(error){paidChannelsVerified=false;}
    return json({ok:true,diagnosis:paidChannelsVerified?'channels_safe':
      issues.length?'schema_mismatch':'schema_valid',
      paid_channels_verified:paidChannelsVerified,
      total_notifications:list2.length,has_more:response?.hasMore===true,
      mismatches:issues.slice(0,12),
      paid_channels:channelSummary,repair_result:repairResult,
      message:input.action!=='diagnose'?
        (repairResult?.verified?'Alteração confirmada pelo Asaas. Nenhum PIX foi criado.':
          'Alteração não confirmada; PIX continua bloqueado.'):
        'Diagnóstico somente de leitura: nenhuma notificação, cobrança ou pedido foi alterado.'});
  }catch(error){
    console.warn('Diagnóstico Asaas somente GET:',String(error?.message||'').slice(0,80));
    return json({ok:false,message:'Diagnóstico interrompido antes de qualquer alteração.'},502);
  }
}
