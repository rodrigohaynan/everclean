import legacy from './test-api-v7.mjs';
import {json,getJson,requireSecureAdmin} from '../shared/everclean-bling.mjs';
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
    const recent=await getJson('integrations/asaas-prod/webhook-recent',[]);
    return json({ok:true,...conf,recent_events:Array.isArray(recent)?recent.slice(0,5):[]});
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
    await (async()=>{const {setJson}=await import('../shared/everclean-bling.mjs');await setJson('integrations/asaas-prod/last-verification',verified);})();
    const recent=await getJson('integrations/asaas-prod/webhook-recent',[]);
    return json({ok:true,...conf,production_api_connected:true,checked_at:verified.at,
      approval,webhooks,recent_events:Array.isArray(recent)?recent.slice(0,5):[],
      message:'Conta de produção consultada com sucesso. Nenhuma cobrança foi criada.'});
  }catch(error){
    console.warn('Ever Clean Asaas production health:',error.status||'unknown');
    return json({ok:false,...conf,message:String(error.message||'A consulta de produção falhou.').slice(0,150)},error.status===401||error.status===403?403:502);
  }
}
