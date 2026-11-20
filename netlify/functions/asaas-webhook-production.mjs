import crypto from 'node:crypto';
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
  const fingerprint=crypto.createHash('sha256').update(payload.id).digest('hex');
  const key='integrations/asaas-prod/events/'+fingerprint;
  try{
    if(await getJson(key,null))return json({ok:true,duplicate:true});
    const entry={
      event:payload.event,
      received_at:new Date().toISOString(),
      // Não salvar CPF/CNPJ, dados de compradores, pagamentos nem segredos.
      linked_to_catalog:false,
      mode:'monitoramento'
    };
    await setJson(key,entry);
    const recent=await getJson('integrations/asaas-prod/webhook-recent',[]);
    await setJson('integrations/asaas-prod/webhook-recent',[entry,...(Array.isArray(recent)?recent:[])].slice(0,12));
    return json({ok:true,received:true,orders_updated:0});
  }catch(error){
    console.error('Ever Clean Asaas prod event persistence:',String(error?.message||'failed').slice(0,100));
    return json({ok:false,message:'Não foi possível armazenar o evento.'},500);
  }
}
