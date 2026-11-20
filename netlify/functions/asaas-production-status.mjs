import crypto from 'node:crypto';
import legacy from './test-api-v7.mjs';
import {json,getJson,setJson,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';

const API='https://api.asaas.com/v3';
const CALLBACK='https://evercleancatalogo.netlify.app/.netlify/functions/asaas-webhook-production';
const BACKUP_CALLBACK='https://cleancatalogo.netlify.app/.netlify/functions/asaas-webhook-production';
const asString=(value)=>String(value||'').slice(0,70);
function config(){
  const sandboxBase=String(env('ASAAS_BASE_URL')).replace(/\/+$/,'');
  const liveKey=String(env('ASAAS_PROD_API_KEY'));
  const hookToken=String(env('ASAAS_PROD_WEBHOOK_TOKEN'));
  return {
    sandbox_isolated:sandboxBase==='https://api-sandbox.asaas.com/v3',
    production_key_configured:liveKey.length>=20,
    production_webhook_token_configured:hookToken.length>=32&&hookToken.length<=255,
    production_url:CALLBACK,
    // O checkout atual usa somente ASAAS_API_KEY no Sandbox.
    production_payments_enabled:false,
    bling_order_export_enabled:false,
    automatic_invoices_enabled:false
  };
}
async function fetchProduction(path,token){
  const response=await fetch(API+path,{
    method:'GET',
    headers:{Accept:'application/json',access_token:token,'User-Agent':'EverCleanCatalogo/1.0'},
    signal:AbortSignal.timeout(12000)
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error(response.status===401?'Chave de produção inválida ou pertencente a outro ambiente.':
      response.status===403?'Sua chave de produção não tem autorização para esta consulta.':
      'O Asaas retornou HTTP '+response.status+' na consulta de produção.');
    error.status=response.status;
    throw error;
  }
  return data;
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const gate=await requireSecureAdmin(request,legacy,context);
  if(!gate.ok)return gate.response;
  const input=await request.json().catch(()=>({}));
  const action=String(input.action||'status');
  const conf=config();
  if(action==='status'){
    const [recent,lastTest]=await Promise.all([
      getJson('integrations/asaas-prod/webhook-recent',[]),
      getJson('integrations/asaas-prod/webhook-last-selftest',null)
    ]);
    return json({ok:true,...conf,
      last_technical_test:lastTest,
      recent_events:Array.isArray(recent)?recent.slice(0,5):[]});
  }
  if(action==='self_test'){
    if(!conf.production_webhook_token_configured){
      return json({ok:false,...conf,message:'Cadastre ASAAS_PROD_WEBHOOK_TOKEN no Netlify e publique novamente antes do teste.'},409);
    }
    // Teste técnico autenticado; não chama a API de cobranças e não simula pagamento.
    const testPayload={
      id:'evt_everclean_selftest_'+crypto.randomBytes(12).toString('hex'),
      event:'EVERCLEAN_WEBHOOK_SELF_TEST'
    };
    const testBody=JSON.stringify(testPayload);
    const baseHeaders={'Content-Type':'application/json'};
    const token=String(env('ASAAS_PROD_WEBHOOK_TOKEN'));
    try{
      async function send(providedToken){
        const response=await fetch(CALLBACK,{
          method:'POST',
          headers:{...baseHeaders,'asaas-access-token':providedToken},
          body:testBody,
          signal:AbortSignal.timeout(12000)
        });
        const data=await response.json().catch(()=>null);
        return {code:response.status,data};
      }
      const first=await send(token);
      if(first.code!==200||first.data?.received!==true||first.data?.technical_test!==true){
        throw new Error('O webhook não confirmou o recebimento seguro do teste (HTTP '+first.code+').');
      }
      const duplicate=await send(token);
      if(duplicate.code!==200||duplicate.data?.duplicate!==true){
        throw new Error('A proteção contra eventos duplicados não foi confirmada.');
      }
      const invalid=await send('invalid-token-for-connectivity-test');
      if(invalid.code!==401)throw new Error('A rejeição de token inválido não foi confirmada.');
      const now=new Date().toISOString();
      const result={verified_at:now,transport_ok:true,duplicate_protection:true,
        invalid_token_rejected:true,origin:'teste_interno'};
      await setJson('integrations/asaas-prod/last-transport-test',result);
      const recent=await getJson('integrations/asaas-prod/webhook-recent',[]);
      return json({ok:true,...conf,technical_test:result,
        recent_events:Array.isArray(recent)?recent.slice(0,5):[],
        message:'Webhook respondeu ao teste técnico, rejeitou token incorreto e bloqueou duplicidade. Nenhuma cobrança foi criada.'});
    }catch(error){
      console.error('Ever Clean Asaas production connectivity test:',String(error?.message||'Erro').slice(0,120));
      return json({ok:false,message:String(error?.message||'Teste técnico não concluído.').slice(0,170)},502);
    }
  }
  if(action!=='verify')return json({ok:false,message:'Ação inválida.'},400);
  if(!conf.production_key_configured){
    return json({ok:false,...conf,message:'Cadastre ASAAS_PROD_API_KEY no Netlify antes de verificar a conta.'},409);
  }
  try{
    const key=String(env('ASAAS_PROD_API_KEY'));
    const status=await fetchProduction('/myAccount/status/',key);
    const approval={
      general:asString(status?.general)||'DESCONHECIDO',
      commercialInfo:asString(status?.commercialInfo)||'DESCONHECIDO',
      documentation:asString(status?.documentation)||'DESCONHECIDO',
      bankAccountInfo:asString(status?.bankAccountInfo)||'DESCONHECIDO'
    };
    // A consulta de webhooks é opcional: escopos restritos podem impedir sua listagem.
    let webhooks={checked:false,found:0,ready:false,message:'Consulta de Webhooks ainda não realizada.'};
    try{
      const hooks=await fetchProduction('/webhooks?limit=100',key);
      const rows=Array.isArray(hooks?.data)?hooks.data:[];
      const matching=rows.filter(h=>h.url===CALLBACK||h.url===BACKUP_CALLBACK);
      const needed=new Set(['PAYMENT_CONFIRMED','PAYMENT_RECEIVED','CHECKOUT_PAID']);
      const ready=matching.some(h=>h.enabled===true&&h.interrupted!==true&&
        needed.has('PAYMENT_CONFIRMED')&&Array.isArray(h.events)&&h.events.some(x=>needed.has(x)));
      webhooks={checked:true,found:matching.length,ready,
        message:matching.length?'Webhook de produção encontrado.':'Cadastre o webhook de produção com a URL indicada no painel.',
        configurations:matching.map(h=>({
          enabled:h.enabled===true,interrupted:h.interrupted===true,
          events:Array.isArray(h.events)?h.events.filter(e=>needed.has(e)):[],
          destination:h.url===CALLBACK?'evercleancatalogo.netlify.app':'cleancatalogo.netlify.app'
        }))
      };
    }catch{
      webhooks={checked:false,found:0,ready:false,message:'A chave não permitiu consultar Webhooks. Verifique pelo painel do Asaas.'};
    }
    const verified={
      at:new Date().toISOString(),approval,webhooks
    };
    await setJson('integrations/asaas-prod/last-verification',verified);
    const recent=await getJson('integrations/asaas-prod/webhook-recent',[]);
    return json({ok:true,...conf,production_api_connected:true,checked_at:verified.at,
      approval,webhooks,recent_events:Array.isArray(recent)?recent.slice(0,5):[],
      message:'Conta de produção consultada com sucesso. Nenhuma cobrança foi criada.'});
  }catch(error){
    console.warn('Ever Clean Asaas production health:',error.status||'unknown');
    return json({ok:false,...conf,message:String(error.message||'A consulta de produção falhou.').slice(0,150)},error.status===401||error.status===403?403:502);
  }
}
