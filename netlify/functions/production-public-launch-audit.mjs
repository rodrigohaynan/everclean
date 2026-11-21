import legacy from './test-api-v7.mjs';
import {requireSecureAdmin,json,getJson} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {databaseConfigured,checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {automaticExportStart} from './bling-production-dispatch.mjs';

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
    const links={
      total:rawLinks.length,
      sandbox:rawLinks.filter(l=>l.checkout_mode!=='production').length,
      production:rawLinks.filter(l=>l.checkout_mode==='production').length
    };
    const db=databaseConfigured();
    let transactionReady=false,activeOrders=0,generalLinksReady=false,generalLinksCount=0;
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
          const count=await checkoutDb().query('SELECT count(*)::integer AS total FROM everclean_private.production_catalog_links');
          generalLinksCount=Number(count.rows[0]?.total||0);
        }
      }catch(err){console.warn('Checkout public readiness DB check failed',String(err?.message||'').slice(0,75))}
    }
    const checks=[
      check('prod_credentials','Credencial do Asaas Produção',String(env('ASAAS_PROD_API_KEY')||'').length>=20,
        'Chave de produção separada da conta Sandbox.'),
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
      check('general_checkout','Cobrança PIX real para produtos e valores variados',false,
        'Motor de cobrança multitema preparado com limite de valor, trava transacional e autorização individual. Liberação real ainda bloqueada; exige homologação e ativação financeira específica.'),
      check('public_activation','Liberação pública independente e protegida',false,
        'O checkout geral NÃO está liberado. Precisará de trava privada própria, revisão final e autorização específica.')
    ];
    return json({
      ok:true,review_only:true,public_checkout_enabled:false,
      automatic_bling_enabled:Boolean(automaticExportStart()),
      stock_automation_enabled:false,financial_automation_enabled:false,
      invoice_automation_enabled:false,
      catalog:products,clients:customers,links,
      prepared_general_links:generalLinksCount,orders_since_activation:activeOrders,
      ready_for_public_launch:checks.filter(c=>c.required).every(c=>c.passed),
      checks,
      next_action:'Homologar a cobrança PIX multitema com autorização específica; nenhuma cobrança geral foi liberada.',
      message:'Auditoria concluída. Nenhum PIX, link, pedido ou NF-e foi criado.'
    });
  }catch(error){
    console.warn('Ever Clean public launch audit failed',String(error?.message||'').slice(0,100));
    return json({ok:false,message:'Não foi possível auditar o checkout público; nenhuma alteração foi executada.'},502);
  }
}
