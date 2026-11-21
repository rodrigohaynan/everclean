import legacy from './test-api-v7.mjs';
import {json,getJson,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';

// AUDITORIA somente leitura da separação entre os checkouts.
// A rota de produção não cria cobranças, clientes, pedidos, estoque nem NF-e.
// O checkout público atual (/pedido/:token) permanece no Sandbox.
const PILOT='integrations/asaas-prod/pilot/first-payment';
const EXPORT='integrations/bling/exports/first-production-pilot';
const STOCK_PROOF='integrations/bling/audits/first-production-pilot-stock';
const TEST='integrations/asaas-prod/last-transport-test';
const VERIFY='integrations/asaas-prod/last-verification';
const EVENTS='integrations/asaas-prod/webhook-recent';
const sku=value=>String(value||'').trim().toUpperCase();

async function audit(){
  const [products,pilot,exported,proof,test,verification,events]=await Promise.all([
    getJson('data/products',[]),getJson(PILOT,null),getJson(EXPORT,null),
    getJson(STOCK_PROOF,null),getJson(TEST,null),getJson(VERIFY,null),
    getJson(EVENTS,[])
  ]);
  const catalog=Array.isArray(products)?products.filter(p=>p?.active!==false&&p?.catalog_visible!==false):[];
  const unique=new Set();
  let missing=0,duplicates=0,unlinked=0,backorder=0;
  for(const product of catalog){
    const code=sku(product.sku);
    if(!code)missing++;
    else if(unique.has(code))duplicates++;
    else unique.add(code);
    if(!/^\d{1,20}$/.test(String(product.bling_product_id||''))&&
        !/^bling-product-\d+$/.test(String(product.id||'')))unlinked++;
    if(product.catalog_allow_backorder!==false)backorder++;
  }
  const sandbox=String(env('ASAAS_BASE_URL')).replace(/\/+$/,'')==='https://api-sandbox.asaas.com/v3';
  const productionKey=String(env('ASAAS_PROD_API_KEY')||'').length>=20;
  const prodToken=String(env('ASAAS_PROD_WEBHOOK_TOKEN')||'').length>=32;
  const verified=verification?.approval?.general==='APPROVED';
  const verifiedWebhook=verification?.webhooks?.ready===true;
  const webhookTest=Boolean(test?.transport_ok&&test?.duplicate_protection&&test?.invalid_token_rejected);
  const realEvent=Array.isArray(events)&&events.some(e=>
    e?.event==='PAYMENT_RECEIVED'&&e?.mode!=='teste_tecnico');
  const pilotPaid=pilot?.payment_status==='RECEIVED';
  const exportedOrder=Boolean(exported?.state==='enviado'&&exported?.order_number==='1237');
  const proofRecorded=Boolean(proof?.source==='admin_bling_history'&&
    proof?.order_id===String(exported?.bling_order_id||'')&&
    proof?.order_number==='1237'&&proof?.sku==='100388'&&
    Number(proof?.quantity)===1);
  const checks=[
    {key:'sandbox',label:'Checkout atual preservado no Sandbox',ok:sandbox,
      details:'A URL pública /pedido continua utilizando a configuração Sandbox.'},
    {key:'secrets',label:'Credenciais de produção separadas',ok:productionKey&&prodToken,
      details:'Verificação de presença das duas credenciais sem expor seus valores.'},
    {key:'account',label:'Conta Asaas Produção aprovada',ok:verified,
      details:verified?'Última verificação registrada em '+String(verification?.at||'data não informada')+'.':
        'Execute Verificar conta de produção e confirme aprovação cadastral.'},
    {key:'webhook',label:'Webhook de produção habilitado',ok:verifiedWebhook&&webhookTest&&realEvent,
      details:'Webhook configurado, teste de segurança concluído e evento real PAYMENT_RECEIVED recebido.'},
    {key:'pilot',label:'PIX piloto e pedido Bling conciliados',ok:pilotPaid&&exportedOrder&&proofRecorded,
      details:'Pagamento recebido, pedido 1237 vinculado e baixa de 1 unidade registrada por conferência manual.'},
    {key:'catalog',label:'Produtos vinculados com SKU único',ok:missing===0&&duplicates===0&&unlinked===0,
      details:'Produtos: '+catalog.length+'; sem SKU: '+missing+'; duplicados: '+duplicates+'; sem vínculo: '+unlinked+'; aceitam encomenda: '+backorder+'.'},
    {key:'checkout_idempotency',label:'Bloqueio transacional de cobranças duplicadas',ok:false,
      details:'Ainda não implementado para o checkout público real. É obrigatório antes da ativação.'},
    {key:'checkout_webhook',label:'Conciliação automática de novos pedidos de produção',ok:false,
      details:'O webhook de produção permanece restrito ao monitoramento/piloto; pedidos públicos reais ainda não são processados.'}
  ];
  return json({
    ok:true,checked_at:new Date().toISOString(),
    stage:'checkout_production_preflight',mode:'somente_auditoria',
    sandbox_public_route:'/pedido/:token',
    production_reserved_route:'/pedido-producao/:token',
    sandbox_unchanged:true,
    production_checkout_enabled:false,
    can_create_real_payment:false,
    automatic_bling_export_enabled:false,
    automatic_invoice_enabled:false,
    automatic_stock_deduction_enabled:false,
    checks,ready:checks.every(c=>c.ok),
    message:'Auditoria concluída. Nenhuma cobrança, pedido, lançamento de estoque ou nota fiscal foi criada.'
  });
}

export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const input=await request.json().catch(()=>null);
  if(input?.action!=='audit')return json({ok:false,message:'Checkout de produção ainda não autorizado. Apenas a auditoria está disponível.'},403);
  try{return await audit();}
  catch(error){
    console.error('Ever Clean checkout preflight:',String(error?.message||'Falha').slice(0,120));
    return json({ok:false,message:'Falha na auditoria do checkout. Nenhuma cobrança foi criada.'},502);
  }
}
