import legacy from './test-api-v7.mjs';
import {json,requireSecureAdmin,getJson} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {asaasProduction} from '../shared/everclean-live-checkout.mjs';

// Apenas duas consultas GET autenticadas. Sem criação de PIX, cliente, notificação,
// alterações de conta, pedidos, estoque ou NF-e.
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
  if(input?.action!=='diagnose'||String(input?.request_number)!=='1000000000')
    return json({ok:false,message:'Diagnóstico permitido apenas para o piloto autorizado.'},403);
  try{
    const q=await checkoutDb().query(
      "SELECT customer_id FROM everclean_private.production_catalog_links "+
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
      return {index:i,active:n?.enabled===true,fields:bad};
    }).filter(x=>x.fields.length);
    const channelSummary=Object.fromEntries(channels.map(key=>[key,{
      enabled:list2.filter(n=>n?.enabled===true&&n?.[key]===true).length,
      unknown:list2.filter(n=>n?.enabled===true&&typeof n?.[key]!=='boolean').length
    }]));
    return json({ok:true,diagnosis:issues.length?'schema_mismatch':'schema_valid',
      total_notifications:list2.length,has_more:response?.hasMore===true,
      mismatches:issues.slice(0,12),
      paid_channels:channelSummary,
      message:'Diagnóstico somente de leitura: nenhuma notificação, cobrança ou pedido foi alterado.'});
  }catch(error){
    console.warn('Diagnóstico Asaas somente GET:',String(error?.message||'').slice(0,80));
    return json({ok:false,message:'Diagnóstico interrompido antes de qualquer alteração.'},502);
  }
}
