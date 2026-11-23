import crypto from 'node:crypto';
import {auditProductionDatabase,listProductionOrders} from '../shared/everclean-transactional-checkout.mjs';
import {createProductionPix,productionCheckoutEnabled} from '../shared/everclean-live-checkout.mjs';
import {getStore} from '@netlify/blobs';
import {reserveProductionPayment,attachProductionPayment,
  reconcileProductionPaymentEvent} from '../shared/everclean-production-payments.mjs';
import legacy from '../shared/admin-api/index.mjs';
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
const PREFLIGHT='integrations/asaas-prod/checkout-safety-test';
const DB_PREFLIGHT='integrations/asaas-prod/checkout-db-test';
const OP_PREFLIGHT='integrations/asaas-prod/checkout-operational-test';
const FLOW_VERSION='2026-11-21-public-pix-neon-v1';
const dbFingerprint=()=>crypto.createHash('sha256').update(String(env('EVERCLEAN_DATABASE_URL')||'')).digest('hex');
const sku=value=>String(value||'').trim().toUpperCase();

async function audit(){
  const [products,pilot,exported,proof,test,verification,events,safety,dbTest,dbStatus,operational]=await Promise.all([
    getJson('data/products',[]),getJson(PILOT,null),getJson(EXPORT,null),
    getJson(STOCK_PROOF,null),getJson(TEST,null),getJson(VERIFY,null),
    getJson(EVENTS,[]),getJson(PREFLIGHT,null),getJson(DB_PREFLIGHT,null),auditProductionDatabase(false),getJson(OP_PREFLIGHT,null)
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
    {key:'checkout_idempotency',label:'Proteção técnica contra repetição de cobranças',ok:safety?.unique_reservation===true,
      details:safety?.unique_reservation?
        'Teste confirmou que duas tentativas da mesma referência geram uma única reserva; nova cobrança não é criada pela auditoria.':
        'Execute o teste técnico da trava de duplicidade, sem criar cobranças.'},
    {key:'checkout_webhook',label:'Conciliação segura do webhook de produção',ok:safety?.webhook_reconciliation===true,
      details:safety?.webhook_reconciliation?
        'Testes em armazenamento isolado validaram ID, valor e referência, impediram processamento repetido e preservaram estornos.':
        'Execute a simulação técnica de conciliação. Nenhuma movimentação real será executada.'},
    {key:'checkout_transactional',label:'Persistência transacional para venda real',
      ok:dbStatus.configured&&dbStatus.migrated&&dbTest?.passed===true&&dbTest?.fingerprint===dbFingerprint(),
      details:dbStatus.message+(dbTest?.passed?' Teste com ROLLBACK registrado.':' A migração fica em db/migrations/20261121064000_checkout_producao_privado.sql.')},
    {key:'checkout_order_flow',label:'Finalização de pedido real e conciliação operacional',ok:false,
      details:operational?.passed===true&&operational?.version===FLOW_VERSION?
        'Preparação e simulação operacional aprovadas. FALTA homologação do pagamento gerado pelo checkout real, em ativação controlada. Nenhuma cobrança autorizada por esta auditoria.':
        'Preparar fluxo PIX, consulta de pedidos em Neon e simular finalização antes de homologar pagamentos reais.'}
  ];
  return json({
    ok:true,checked_at:new Date().toISOString(),
    stage:'checkout_production_preflight',mode:'somente_auditoria',
    sandbox_public_route:'/pedido/:token',
    production_reserved_route:'/pedido-producao/:token',
    sandbox_unchanged:true,
    production_checkout_enabled:productionCheckoutEnabled(),
    operational_preflight:operational?.version===FLOW_VERSION?operational:null,
    database_status:{configured:dbStatus.configured,migrated:dbStatus.migrated,
      test_confirmed:dbTest?.passed===true&&dbTest?.fingerprint===dbFingerprint(),
      message:dbStatus.message},
    safety_selftest:safety?.verified_at||null,
    can_create_real_payment:false,
    automatic_bling_export_enabled:false,
    automatic_invoice_enabled:false,
    automatic_stock_deduction_enabled:false,
    checks,ready:checks.every(c=>c.ok),
    message:'Auditoria concluída. Nenhuma cobrança, pedido, lançamento de estoque ou nota fiscal foi criada.'
  });
}

// Teste técnico restrito ao administrador. Usa uma STORE ISOLADA, IDs falsos
// e nenhuma chamada externa a Asaas/Bling; não modifica o catálogo, pedidos
// ou histórico do PIX piloto.
async function selfTest(){
  const store=getStore({name:'everclean-checkout-preflight-tests',consistency:'strong'});
  const reference='EVERCLEAN-PROD-CATALOG-'+crypto.randomBytes(16).toString('hex');
  const record={reference,amount_cents:700,request_number:'1237'};
  const [a,b]=await Promise.all([
    reserveProductionPayment(record,store),reserveProductionPayment(record,store)
  ]);
  if(Number(a.reserved)+Number(b.reserved)!==1)
    throw Error('Duas reservas simultâneas não foram bloqueadas.');
  const paymentId='pay_everclean_preflight_'+crypto.randomBytes(8).toString('hex');
  const firstLink=await attachProductionPayment(reference,paymentId,store);
  const repeatedLink=await attachProductionPayment(reference,paymentId,store);
  if(!firstLink.linked||repeatedLink.already!==true)
    throw Error('Vínculo de pagamento não é idempotente.');
  const paid={id:'evt_preflight_'+crypto.randomBytes(8).toString('hex'),
    event:'PAYMENT_RECEIVED',payment:{id:paymentId,externalReference:reference,value:7}};
  const wrongAmount=await reconcileProductionPaymentEvent({
    ...paid,payment:{...paid.payment,value:8}},store);
  if(wrongAmount.matched!==false)
    throw Error('Valor divergente não foi rejeitado.');
  const first=await reconcileProductionPaymentEvent(paid,store);
  const second=await reconcileProductionPaymentEvent(paid,store);
  const reverse=await reconcileProductionPaymentEvent({...paid,event:'PAYMENT_REFUNDED'},store);
  const stale=await reconcileProductionPaymentEvent(paid,store);
  if(!first.matched||!first.updated||second.updated||!reverse.updated||
    stale.updated||stale.state!=='estornado')
    throw Error('Conciliação ou proteção contra duplicidade falhou.');
  const result={unique_reservation:true,webhook_reconciliation:true,
    verified_at:new Date().toISOString(),test_type:'simulacao_isolada_sem_cobrancas'};
  await getStore({name:'everclean-test',consistency:'strong'}).setJSON(PREFLIGHT,result);
  return json({ok:true,technical_test:result,
    message:'Trava e conciliação simuladas com segurança. Nenhuma cobrança nem pedido real criado.'});
}

async function operationalTest(){
  if(productionCheckoutEnabled())return json({
    ok:false,message:'O teste seguro só pode ser executado com o checkout público desativado.'
  },409);
  const products=await getJson('data/products',[]);
  const valid=(Array.isArray(products)?products:[]).filter(p=>
    p?.active!==false&&p?.catalog_visible!==false&&
    String(p.sku||'').trim()&&Number.isFinite(Number(p.base_price))&&
    Math.round(Number(p.base_price)*100)>=100);
  if(!valid.length)return json({ok:false,message:'Catálogo sem produto válido para simulação.'},409);
  const sample=valid.find(p=>p.catalog_allow_backorder!==false&&Number(p.stock_quantity||0)<=0)||valid[0];
  const dbStatus=await auditProductionDatabase(true);
  if(!dbStatus.transaction_test)return json({ok:false,message:dbStatus.message},409);
  // Criação real deve ser recusada ANTES de consultar pedido, cliente ou Asaas.
  let paymentBlocked=false;
  try{await createProductionPix('operational-test-without-order',[]);}
  catch(error){paymentBlocked=Number(error?.status)===403;}
  if(!paymentBlocked)return json({ok:false,message:'O checkout público não bloqueou criação de cobrança.'},409);
  const snapshot=await listProductionOrders(75);
  const result={
    passed:true,version:FLOW_VERSION,verified_at:new Date().toISOString(),
    product_sku_valid:true,
    sample_sku:String(sample.sku),
    sample_amount:Math.round(Number(sample.base_price)*100)/100,
    backorder_allowed:sample.catalog_allow_backorder!==false,
    transaction_rollback:true,
    public_billing_blocked:true,
    administrative_order_visibility:true,
    existing_production_orders:snapshot.length,
    real_charges_created:0,
    message:'Fluxo operacional simulado em transação revertida; cobrança real bloqueada.'
  };
  await getStore({name:'everclean-test',consistency:'strong'}).setJSON(OP_PREFLIGHT,result);
  return json({ok:true,operational_preflight:result,message:result.message});
}

export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const input=await request.json().catch(()=>null);
  if(!['audit','self_test','database_self_test','operational_self_test'].includes(input?.action))return json({ok:false,message:'Checkout de produção ainda não autorizado.'},403);
  try{
    if(input.action==='self_test')return await selfTest();
    if(input.action==='operational_self_test')return await operationalTest();
    if(input.action==='database_self_test'){
      const db=await auditProductionDatabase(true);
      if(db.transaction_test){
        await getStore({name:'everclean-test',consistency:'strong'}).setJSON(DB_PREFLIGHT,
          {passed:true,verified_at:new Date().toISOString(),fingerprint:dbFingerprint()});
      }
      return json({ok:db.transaction_test,database_status:db,
        message:db.message},db.transaction_test?200:409);
    }
    return await audit();
  }
  catch(error){
    console.error('Ever Clean checkout preflight:',String(error?.message||'Falha').slice(0,120));
    return json({ok:false,message:'Falha na auditoria do checkout. Nenhuma cobrança foi criada.'},502);
  }
}
