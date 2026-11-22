import legacy from '../shared/admin-api/index.mjs';
import {requireSecureAdmin,json,getJson} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {databaseConfigured,checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {automaticExportStart} from './bling-production-dispatch.mjs';
import {MAX_PRODUCTION_ORDER_ITEMS,generalPublicRelease} from '../shared/everclean-general-production-checkout.mjs';

// Auditoria somente de leitura. Não cria link, pedido, PIX, cadastro,
// exportação Bling, lançamento contábil, movimentação de estoque ou NF-e.
// A rota pública genérica NÃO existe: /pedido-producao/:token é EXCLUSIVA do
// piloto homologado. Não sugerir que a rotina Bling habilita o checkout público.
const digit=value=>String(value||'').replace(/\D/g,'');
const linkBling=value=>/^\d{1,20}$/.test(String(value||''));
const blingProduct=p=>String(p?.bling_product_id||'')||
  String(p?.id||'').match(/^bling-product-(\d+)$/)?.[1]||'';
const blingCustomer=c=>String(c?.bling_contact_id||'')||
  String(c?.id||'').match(/^client-(\d+)$/)?.[1]||'';
const check=(key,label,passed,description,required=true)=>({
  key,label,passed:passed===true,description,required
});
function stockAudit(products){
  const visible=products.filter(p=>p&&p.active!==false&&p.catalog_visible!==false);
  const skus=new Map();
  for(const p of visible){
    const sku=String(p.sku||'').trim().toUpperCase();
    if(sku)skus.set(sku,(skus.get(sku)||0)+1);
  }
  return {
    visible:visible.length,
    missing_sku:visible.filter(p=>!String(p.sku||'').trim()).length,
    duplicate_sku:[...skus.values()].filter(n=>n>1).length,
    no_bling:visible.filter(p=>!linkBling(blingProduct(p))).length,
    invalid_price:visible.filter(p=>!Number.isFinite(Number(p.base_price))||Number(p.base_price)<=0).length,
    backorder:visible.filter(p=>Number(p.stock_quantity||0)<=0).length,
    backorder_not_allowed:visible.filter(p=>Number(p.stock_quantity||0)<=0&&p.catalog_allow_backorder===false).length
  };
}
function customerAudit(clients){
  return {
    total:clients.length,
    no_document:clients.filter(c=>![11,14].includes(digit(c.document||c.cpf_cnpj).length)).length,
    no_bling:clients.filter(c=>!linkBling(blingCustomer(c))).length,
    no_email:clients.filter(c=>!String(c.email||'').includes('@')).length
  };
}

// Verificação real do Asaas de PRODUÇÃO: somente GET, sem criar cliente,
// cobrar, editar webhook, gerar chave PIX ou alterar configurações.
const PROD_WEBHOOK_URL='https://evercleancatalogo.netlify.app/.netlify/functions/asaas-webhook-production';
async function checkLiveAsaas(){
  const key=String(env('ASAAS_PROD_API_KEY')||'');
  const empty={account_ok:false,account_approved:false,
    pix_api_ok:false,pix_active:false,webhook_api_ok:false,
    webhook_registered:false,checks_performed:false};
  if(key.length<20)return empty;
  async function get(path){
    try{
      const response=await fetch('https://api.asaas.com/v3'+path,{
        method:'GET',
        headers:{Accept:'application/json',access_token:key,
          'User-Agent':'EverCleanCatalogo/1.0'},
        cache:'no-store',signal:AbortSignal.timeout(7000)
      });
      if(!response.ok)return {ok:false,status:response.status};
      const body=await response.json().catch(()=>null);
      return {ok:!!body,body};
    }catch{return {ok:false};}
  }
  const [account,pix,webhooks]=await Promise.all([
    get('/myAccount/status/'),
    get('/pix/addressKeys?status=ACTIVE&limit=100'),
    get('/webhooks?limit=100')
  ]);
  // Não devolve IDs de conta, dados bancários, chaves, payloads ou tokens.
  const accountGeneral=String(account.body?.general||'').toUpperCase();
  const pixRows=Array.isArray(pix.body?.data)?pix.body.data:[];
  const webhookRows=Array.isArray(webhooks.body?.data)?webhooks.body.data:[];
  return {
    account_ok:account.ok===true,
    account_approved:account.ok===true&&accountGeneral==='APPROVED',
    pix_api_ok:pix.ok===true,
    pix_active:pix.ok===true&&pixRows.some(row=>String(row.status)==='ACTIVE'),
    webhook_api_ok:webhooks.ok===true,
    webhook_registered:webhooks.ok===true&&webhookRows.some(row=>
      String(row.url||'').replace(/\/+$/,'')===PROD_WEBHOOK_URL&&
      row.enabled===true),
    checks_performed:true
  };
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const body=await request.json().catch(()=>null);
  if(body?.action!=='audit')return json({ok:false,message:'Somente auditoria sem alterações.'},403);
  try{
    const [rawClients,rawProducts,rawLinks]=await Promise.all([
      getJson('data/clients',[]),getJson('data/products',[]),getJson('data/links',[])
    ]);
    if(!Array.isArray(rawClients)||!Array.isArray(rawProducts)||!Array.isArray(rawLinks))
      throw Error('Cadastros do catálogo inconsistentes.');
    const products=stockAudit(rawProducts);
    const customers=customerAudit(rawClients);
    const liveAsaas=await checkLiveAsaas();
    const release=generalPublicRelease();
    const links={
      total:rawLinks.length,
      sandbox:rawLinks.filter(l=>l.checkout_mode!=='production').length,
      production:rawLinks.filter(l=>l.checkout_mode==='production').length
    };
    const db=databaseConfigured();
    let transactionReady=false,activeOrders=0,generalLinksReady=false,generalLinksCount=0;
    let validGeneralLinks=0,expiredGeneralLinks=0;
    if(db){
      try{
        const result=await checkoutDb().query(
          "SELECT to_regclass('everclean_private.checkout_orders') IS NOT NULL AS orders,"+
          "to_regclass('everclean_private.bling_export_intents') IS NOT NULL AS export_intents,"+
          "to_regclass('everclean_private.production_catalog_links') IS NOT NULL AS general_links,"+
          "(SELECT count(*)::integer FROM everclean_private.checkout_orders WHERE created_at >= $1::timestamptz) AS since_activation",
          [automaticExportStart()||'2099-01-01T00:00:00Z']
        );
        transactionReady=result.rows[0]?.orders===true&&result.rows[0]?.export_intents===true;
        generalLinksReady=result.rows[0]?.general_links===true;
        activeOrders=Number(result.rows[0]?.since_activation||0);
        if(generalLinksReady){
          const count=await checkoutDb().query(
            "SELECT count(*)::integer AS total,"+
            "count(*) FILTER (WHERE status='prepared' AND expires_at>now())::integer AS valid,"+
            "count(*) FILTER (WHERE status='prepared' AND expires_at<=now())::integer AS expired "+
            "FROM everclean_private.production_catalog_links"
          );
          generalLinksCount=Number(count.rows[0]?.total||0);
          validGeneralLinks=Number(count.rows[0]?.valid||0);
          expiredGeneralLinks=Number(count.rows[0]?.expired||0);
        }
      }catch(err){console.warn('Checkout public readiness DB check failed',String(err?.message||'').slice(0,75))}
    }
    const checks=[
      check('prod_credentials','Credencial do Asaas Produção',String(env('ASAAS_PROD_API_KEY')||'').length>=20,
        'Chave de produção separada da conta Sandbox.'),
      check('live_account','Conta real aprovada pelo Asaas',liveAsaas.account_approved,
        liveAsaas.account_ok?'Consulta realizada na API real: aprovação geral '+(liveAsaas.account_approved?'confirmada.':'pendente.'):
        'Não foi possível autenticar ou consultar a conta real.'),
      check('live_pix','Chave PIX ativa na conta real',liveAsaas.pix_active,
        liveAsaas.pix_api_ok?'Consulta real de chaves PIX: '+(liveAsaas.pix_active?'ativa.':'nenhuma chave ativa confirmada.'):
        'Consulta de chaves PIX da conta real não confirmada.'),
      check('live_webhook','Webhook de produção ativo no Asaas',liveAsaas.webhook_registered,
        liveAsaas.webhook_api_ok?'Consulta da configuração remota: '+
        (liveAsaas.webhook_registered?'URL de produção ativa.':'URL ativa não encontrada.'):
        'Consulta dos webhooks cadastrados na conta real indisponível.'),
      check('webhook','Webhook de produção configurado',String(env('ASAAS_PROD_WEBHOOK_TOKEN')||'').length>=32,
        'O recebimento de PIX é conciliado por evento autenticado.'),
      check('database','Banco transacional e controle de duplicidade',transactionReady,
        'PostgreSQL deve conter os pedidos e as travas de exportação ao Bling.'),
      check('bling_dispatch','Envio automático de novos pedidos ao Bling',Boolean(automaticExportStart()),
        'A rotina de 5 minutos depende do marco de ativação e de um pagamento elegível.'),
      check('catalog','Catálogo com SKUs únicos e preços válidos',
        products.visible>0&&products.missing_sku===0&&products.duplicate_sku===0&&products.invalid_price===0,
        'Produtos visíveis precisam ter SKU único e preço positivo.'),
      check('bling_products','Produtos visíveis vinculados ao Bling',
        products.visible>0&&products.no_bling===0,
        'Cada SKU vendido deve corresponder a um único produto do Bling.'),
      check('general_production_links','Links gerais de produção independentes do piloto',generalLinksReady,
        'Estrutura de links exclusivos pronta; '+generalLinksCount+
        ' link(s) preparado(s). Os links antigos permanecem no Sandbox.'),
      check('general_catalog_preview','Prévia de catálogo com produtos e valores variados',
        generalLinksReady&&products.visible>0,
        'Rota de produção separada, com carrinho de vários SKUs, valor calculado no servidor e nenhuma cobrança.'),
      check('general_link_available','Link de produção válido para homologação',validGeneralLinks>0,
        validGeneralLinks+' link(s) válido(s) sem cobrança; '+expiredGeneralLinks+
        ' link(s) preparado(s) expirado(s).'),
      check('line_item_limit','Limite do pedido compatível com Bling e PDF',
        MAX_PRODUCTION_ORDER_ITEMS===50,
        'Máximo de 50 produtos diferentes por pedido, validado no servidor antes de gerar cobrança.'),
      check('general_checkout','Cobrança PIX real para produtos e valores variados',
        release.enabled,
        release.enabled?'Liberada apenas para links criados depois do marco de ativação, até R$ '+
          (release.max_cents/100).toFixed(2)+'. Confirmada pelo comprador; limite e unicidade validados no servidor.':
          'Checkout real geral bloqueado por configuração. Pilotos antigos permanecem isolados.'),
      check('public_activation','Liberação pública independente e protegida',
        release.enabled&&liveAsaas.account_approved&&liveAsaas.pix_active&&
          liveAsaas.webhook_registered&&generalLinksReady&&transactionReady&&
          products.visible>0&&products.missing_sku===0&&
          products.duplicate_sku===0&&products.invalid_price===0&&
          products.no_bling===0&&Boolean(automaticExportStart()),
        release.enabled?'Novos links de produção com cobrança PIX protegida; links antigos preservados no Sandbox.':
          'Checkout geral ainda não habilitado. Não são criados pagamentos pela auditoria.')
    ];
    const prerequisiteChecks=checks.filter(c=>
      c.key!=='general_checkout'&&c.key!=='public_activation');
    const technicalPrerequisitesReady=prerequisiteChecks.every(c=>c.passed);
    return json({
      ok:true,review_only:true,public_checkout_enabled:release.enabled,
      automatic_bling_enabled:Boolean(automaticExportStart()),
      stock_automation_enabled:false,financial_automation_enabled:false,
      invoice_automation_enabled:false,
      live_asaas_status:liveAsaas,
      catalog:products,clients:customers,links,
      prepared_general_links:generalLinksCount,
      valid_general_links:validGeneralLinks,expired_general_links:expiredGeneralLinks,
      max_items_per_order:MAX_PRODUCTION_ORDER_ITEMS,
      orders_since_activation:activeOrders,
      technical_prerequisites_ready:technicalPrerequisitesReady,
      financial_authorization_pending:!release.enabled,
      ready_for_public_launch:checks.filter(c=>c.required).every(c=>c.passed),
      checks,
      next_action:release.enabled?
        (technicalPrerequisitesReady?
          'Checkout PIX real ativado para links NOVOS criados após a data de corte. Gerar um link novo e homologar o carrinho sem criar cobrança durante a auditoria.':
          'Liberação configurada, mas há verificações pendentes. Revise os itens destacados antes de enviar novos links.'):
        (technicalPrerequisitesReady?
          'Pré-requisitos técnicos conferidos. Ativação financeira geral permanece desligada.':
          'Resolver pré-requisitos técnicos antes de ativar o checkout real.'),
      message:'Auditoria concluída sem criar PIX, link, pedido ou NF-e.'
    });
  }catch(error){
    console.warn('Ever Clean public launch audit failed',String(error?.message||'').slice(0,100));
    return json({ok:false,message:'Não foi possível auditar o checkout público; nenhuma alteração foi executada.'},502);
  }
}
