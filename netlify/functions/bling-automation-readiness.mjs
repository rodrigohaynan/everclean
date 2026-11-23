import {getStore} from '@netlify/blobs';
import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {getStockSyncStatus} from '../shared/bling-stock-sync.mjs';
import {readProducts} from '../shared/catalog-store.mjs';

// Diagnóstico exclusivamente de leitura. Nenhuma cobrança, NF-e, ordem ou estoque é alterado.
// O checkout público continua usando exclusivamente o Asaas Sandbox nesta etapa.
const numericId=value=>/^\d{1,20}$/.test(String(value||''))?String(value):null;
const SKU=value=>String(value||'').trim().toUpperCase();
const PILOT='integrations/asaas-prod/pilot/first-payment';
const EXPORT='integrations/bling/exports/first-production-pilot';
const STOCK_PROOF='integrations/bling/audits/first-production-pilot-stock';
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
  const [allProducts,allOrders,pilot,pilotExport,stockSync,stockProof]=await Promise.all([
    readProducts(),getJson('data/orders',[]),
    getJson(PILOT,null),getJson(EXPORT,null),getStockSyncStatus(),getJson(STOCK_PROOF,null)
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
  // A API de saldos, isoladamente, não comprova a origem da baixa.
  // É necessária a confirmação manual explícita do histórico da venda no Bling.
  const stockAuditComplete=Boolean(
    stockProof?.source==='admin_bling_history'&&
    String(stockProof?.order_id||'')===orderId&&
    stockProof?.order_number==='1237'&&stockProof?.sku==='100388'&&
    Number(stockProof?.quantity)===1&&
    pilot?.payment_status==='RECEIVED'&&
    pilotOrder?.number==='1237'&&pilotOrder?.quantity===1
  );
  if(pilotOrder)pilotOrder.stock_movement_verified=stockAuditComplete;
  const blockers=[
    {key:'checkout',label:'Checkout público separado do Sandbox',ok:false,
      details:checkoutSandbox?'Checkout atual ainda cria cobranças apenas no Asaas Sandbox.':'Configuração do Sandbox não identificada; confirmar antes de liberar pagamentos.'},
    {key:'stock',label:'Baixa/reserva da unidade vendida no pedido 1237',ok:stockAuditComplete,
      details:stockAuditComplete?
        'Saída de 1 unidade do SKU 100388 conferida manualmente no histórico do Bling e registrada para o pedido 1237. Sem nova movimentação.':
        'Saldo zerado não comprova a origem da saída. Conferir no histórico do Bling a saída de 1 unidade com origem Venda 1237 e registrar a confirmação manual.'},
    {key:'backorder',label:'Venda sob encomenda permitida com conferência manual',ok:true,
      details:issues.allow_backorder+' produto(s) permitem pedidos sob encomenda; '+issues.zero_stock+' estão sem estoque positivo. Pedidos sem saldo exigem confirmação de reposição ou ajuste de estoque antes do atendimento.'},
    {key:'sku',label:'Todos os produtos visíveis vinculados por SKU único',ok:issues.without_sku===0&&issues.duplicate_sku===0&&issues.without_bling_id===0,
      details:'Sem SKU: '+issues.without_sku+'; duplicados: '+issues.duplicate_sku+'; sem vínculo Bling: '+issues.without_bling_id+'.'},
    {key:'stock_freshness',label:'Estoque confirmado recentemente pelo Bling',ok:stockSync.last_result==='success'&&stockSync.enabled===true,
      details:stockSync?.last_success_at?'Última sincronização: '+stockSync.last_success_at:'Ainda sem execução automática confirmada.'}
  ];
  return json({ok:true,checked_at:new Date().toISOString(),order_policy:'allow_backorder_manual_review',
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
      stock_release_not_yet_verified:!stockAuditComplete,
      stock_proof:stockAuditComplete?{source:'Conferência manual do histórico Bling',verified_at:stockProof.verified_at}:null
    },
    stock_sync:stockSync,remote_error:lookupError,
    blockers,readiness_ok:blockers.every(item=>item.ok),
    message:'Auditoria somente leitura. O envio e a cobrança automáticos permanecem desligados.'
  });
}
async function confirmStockMovement(input){
  // Confirma apenas evidência administrativa; NÃO lança nem estorna estoque.
  if(input?.confirmed!==true||input?.order_number!=='1237'||input?.sku!=='100388'||Number(input?.quantity)!==1){
    return json({ok:false,message:'Confirmação explícita da saída de 1 unidade, origem Venda 1237, é obrigatória.'},403);
  }
  const current=await getJson(STOCK_PROOF,null);
  if(current?.source==='admin_bling_history'){
    return json({ok:true,message:'Conferência manual do pedido 1237 já registrada. Nenhum estoque foi alterado.'});
  }
  const reportResponse=await review();
  const report=await reportResponse.json();
  const order=report?.pilot?.order,stock=report?.pilot?.stock;
  if(report?.remote_error||report?.pilot?.payment_confirmed!==true||
    report?.pilot?.order_linked!==true||order?.number!=='1237'||
    order?.quantity!==1||Math.round(Number(order?.amount)*100)!==700||
    !order?.id||Number(stock?.physical)!==0||Number(stock?.virtual)!==0||
    stock?.physical===null||stock?.virtual===null){
    return json({ok:false,message:'Dados do pedido 1237 ou saldo do Bling não confirmados nesta consulta. Auditoria permanece pendente.'},409);
  }
  const proof={
    source:'admin_bling_history',order_id:order.id,order_number:'1237',
    sku:'100388',quantity:1,verified_at:new Date().toISOString(),
    description:'Histórico Bling: saída 1,00 UN, origem Venda 1237; conferido pelo administrador.',
    stock_physical_when_confirmed:0,stock_virtual_when_confirmed:0
  };
  const saved=await getStore({name:'everclean-test',consistency:'strong'})
    .setJSON(STOCK_PROOF,proof,{onlyIfNew:true});
  if(!saved?.modified){
    return json({ok:false,message:'Já existe registro de conferência. Reexecute a auditoria sem registrar outro.'},409);
  }
  return json({ok:true,manual_confirmation:proof,
    message:'Baixa do pedido 1237 registrada como conferência manual. Nenhum pedido, cobrança, NF-e ou movimento de estoque foi criado.'});
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const input=await request.json().catch(()=>null);
  if(input?.action!=='audit'&&input?.action!=='confirm_stock_movement')
    return json({ok:false,message:'Ação não permitida.'},403);
  try{
    if(input?.action==='confirm_stock_movement')return await confirmStockMovement(input);
    return await review();
  }catch(error){
    console.error('Ever Clean readiness:',String(error?.message||'Erro').slice(0,150));
    return json({ok:false,message:'A solicitação não foi concluída. Confira o catálogo antes de repetir.'},502);
  }
}
