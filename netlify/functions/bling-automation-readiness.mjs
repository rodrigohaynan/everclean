import legacy from './test-api-v7.mjs';
import {json,getJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {getStockSyncStatus} from '../shared/bling-stock-sync.mjs';

// Diagnóstico exclusivamente de leitura. Nenhuma cobrança, NF-e, ordem ou estoque é alterado.
// O checkout público continua usando exclusivamente o Asaas Sandbox nesta etapa.
const numericId=value=>/^\d{1,20}$/.test(String(value||''))?String(value):null;
const SKU=value=>String(value||'').trim().toUpperCase();
const PILOT='integrations/asaas-prod/pilot/first-payment';
const EXPORT='integrations/bling/exports/first-production-pilot';
async function blingGet(path,token){
  const response=await fetch('https://api.bling.com.br/Api/v3'+path,{
    headers:{'Accept':'application/json','Authorization':'Bearer '+token,'enable-jwt':'1'},
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error('Consulta Bling indisponível (HTTP '+response.status+').');
  const result=await response.json().catch(()=>null);
  return result?.data||null;
}
async function review(){
  const [allProducts,allOrders,pilot,pilotExport,stockSync]=await Promise.all([
    getJson('data/products',[]),getJson('data/orders',[]),
    getJson(PILOT,null),getJson(EXPORT,null),getStockSyncStatus()
  ]);
  const products=Array.isArray(allProducts)?allProducts:[];
  const active=products.filter(p=>p?.active!==false&&p?.catalog_visible!==false);
  const total=active.length;
  const codes=new Map(),ids=new Map();
  products.forEach(p=>{
    const sku=SKU(p.sku),id=String(p.bling_product_id||'');
    if(sku)codes.set(sku,(codes.get(sku)||0)+1);
    if(id)ids.set(id,(ids.get(id)||0)+1);
  });
  const issues={};
  issues.without_sku=active.filter(p=>!SKU(p.sku)).length;
  issues.duplicate_sku=active.filter(p=>SKU(p.sku)&&codes.get(SKU(p.sku))>1).length;
  issues.without_bling_id=active.filter(p=>!numericId(p.bling_product_id)&&
    !/^bling-product-\d+$/.test(String(p.id||''))).length;
  issues.allow_backorder=active.filter(p=>p.catalog_allow_backorder!==false).length;
  issues.zero_stock=active.filter(p=>!Number.isFinite(Number(p.stock_quantity))||Number(p.stock_quantity)<=0).length;
  issues.not_verified_stock=active.filter(p=>p.stock_source!=='bling'||!p.stock_synced_at).length;
  const productionOrderCount=Array.isArray(allOrders)?allOrders.filter(o=>
    String(o.source||'').toLowerCase().includes('production')||
    String(o.asaas_reference||'').startsWith('EVERCLEAN-PROD-EC-')
  ).length:0;
  const lookup=active.filter(p=>
    !SKU(p.sku)||codes.get(SKU(p.sku))>1||
    !numericId(p.bling_product_id)&&!/^bling-product-\d+$/.test(String(p.id||''))||
    p.catalog_allow_backorder!==false||
    !Number.isFinite(Number(p.stock_quantity))||Number(p.stock_quantity)<=0
  ).slice(0,18).map(p=>({
    id:String(p.id||''),sku:String(p.sku||'').slice(0,55),
    name:String(p.name||'Produto').slice(0,95),
    stock:Number(p.stock_quantity)||0,
    backorder:p.catalog_allow_backorder!==false,
    bling_linked:Boolean(numericId(p.bling_product_id)||/^bling-product-\d+$/.test(String(p.id||'')))
  }));
  const orderId=numericId(pilotExport?.bling_order_id);
  let pilotOrder=null,remoteStock=null,lookupError=null;
  if(orderId){
    try{
      const token=await blingAccessToken();
      if(!token)throw Error('Bling não conectado.');
      const data=await blingGet('/pedidos/vendas/'+encodeURIComponent(orderId),token);
      if(data&&String(data.id)===orderId){
        pilotOrder={id:orderId,number:String(data.numero||pilotExport.order_number||''),
          situation_id:data?.situacao?.id??null,
          amount:Number(data.total??data.totalProdutos??0),
          customer_id:String(data?.contato?.id||''),
          quantity:Array.isArray(data?.itens)?data.itens.reduce((n,x)=>n+Number(x.quantidade||0),0):null,
          stock_movement_verified:false};
      }
      const match=products.find(p=>SKU(p.sku)==='100388');
      const productId=numericId(match?.bling_product_id)||
        numericId(String(match?.id||'').match(/^bling-product-(\d+)$/)?.[1]);
      if(productId){
        await new Promise(resolve=>setTimeout(resolve,650));
        const params=new URLSearchParams();params.append('idsProdutos[]',productId);
        const saldos=await blingGet('/estoques/saldos?'+params.toString(),token);
        const item=Array.isArray(saldos)?saldos.find(s=>String(s.produto?.id||s.idProduto||'')===productId):null;
        if(item)remoteStock={
          sku:'100388',physical:item.saldoFisicoTotal??null,virtual:item.saldoVirtualTotal??null
        };
      }
    }catch(error){lookupError=String(error?.message||'Falha no Bling').slice(0,135);}
  }
  const checkoutSandbox=String(env('ASAAS_BASE_URL')).replace(/\/+$/,'')==='https://api-sandbox.asaas.com/v3';
  const stockAuditComplete=false; // Não existe prova de baixa de estoque no piloto.
  const blockers=[
    {key:'checkout',label:'Checkout público separado do Sandbox',ok:false,
      details:checkoutSandbox?'Checkout atual ainda cria cobranças apenas no Asaas Sandbox.':'Configuração do Sandbox não identificada; confirmar antes de liberar pagamentos.'},
    {key:'stock',label:'Baixa/reserva da unidade vendida no pedido 1237',ok:stockAuditComplete,
      details:'Há pedido pago e vinculado. A movimentação de estoque ainda não foi certificada; conferir no Bling antes de ativar vendas automáticas.'},
    {key:'backorder',label:'Venda sem estoque bloqueada para os produtos disponíveis',ok:issues.allow_backorder===0,
      details:issues.allow_backorder+' produto(s) visível(is) permitem sob encomenda ou não têm bloqueio explícito de estoque.'},
    {key:'sku',label:'Todos os produtos visíveis vinculados por SKU único',ok:issues.without_sku===0&&issues.duplicate_sku===0&&issues.without_bling_id===0,
      details:'Sem SKU: '+issues.without_sku+'; duplicados: '+issues.duplicate_sku+'; sem vínculo Bling: '+issues.without_bling_id+'.'},
    {key:'stock_freshness',label:'Estoque confirmado recentemente pelo Bling',ok:stockSync.last_result==='success'&&stockSync.enabled===true,
      details:stockSync?.last_success_at?'Última sincronização: '+stockSync.last_success_at:'Ainda sem execução automática confirmada.'}
  ];
  return json({ok:true,checked_at:new Date().toISOString(),
    active_products:total,issue_counts:issues,examples:lookup,
    source_of_truth:'bling',
    checkout_mode:'sandbox',sandbox_separate:checkoutSandbox,
    production_payment_checkout_enabled:false,production_order_auto_export_enabled:false,
    stock_auto_deduction_enabled:false,invoice_automatic_enabled:false,
    paid_production_catalog_orders:productionOrderCount,
    pilot:{
      payment_confirmed:pilot?.payment_status==='RECEIVED',
      order_linked:pilotExport?.state==='enviado'&&!!orderId,
      order:pilotOrder,stock:remoteStock,
      stock_release_not_yet_verified:true
    },
    stock_sync:stockSync,remote_error:lookupError,
    blockers,readiness_ok:blockers.every(item=>item.ok),
    message:'Auditoria somente leitura. O envio e a cobrança automáticos permanecem desligados.'
  });
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const input=await request.json().catch(()=>null);
  if(input?.action!=='audit')return json({ok:false,message:'Somente a auditoria está disponível.'},403);
  try{return await review();}
  catch(error){console.error('Ever Clean readiness:',String(error?.message||'Erro').slice(0,150));return json({ok:false,message:'Não foi possível realizar a auditoria de produção. Nenhuma operação foi executada.'},502);}
}
