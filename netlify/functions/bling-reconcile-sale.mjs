import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';

// Apenas consulta os registros do piloto e os dois provedores. Sem POST financeiro,
// lançamento de estoque, NF-e ou alteração da situação de pedido.
const PILOT='integrations/asaas-prod/pilot/first-payment';
const EXPORT='integrations/bling/exports/first-production-pilot';
const BLING='https://api.bling.com.br/Api/v3';
const ASAAS='https://api.asaas.com/v3';
const normalize=value=>String(value??'').trim().toUpperCase();
const cents=value=>Number.isFinite(Number(value))?Math.round(Number(value)*100):null;
const positiveInt=value=>/^\d{1,20}$/.test(String(value||''))?String(value):null;
const check=(label,status,details='')=>({label,status,details});
const getItemCode=item=>normalize(item?.codigo||item?.produto?.codigo||item?.sku);
async function getRemote(base,path,token,source){
  const headers=source==='bling'
    ?{'Accept':'application/json','Authorization':'Bearer '+token,'enable-jwt':'1'}
    :{'Accept':'application/json','access_token':token,'User-Agent':'EverCleanCatalogo/1.0'};
  const resp=await fetch(base+path,{method:'GET',headers,signal:AbortSignal.timeout(12000)});
  if(!resp.ok)throw new Error(source==='bling'
    ?'Bling retornou HTTP '+resp.status+' ao consultar o pedido.'
    :'Asaas retornou HTTP '+resp.status+' ao consultar o pagamento.');
  const body=await resp.json().catch(()=>null);
  if(!body)throw new Error('Resposta inválida do '+(source==='bling'?'Bling':'Asaas')+'.');
  return source==='bling'?body.data:body;
}
async function reconcile(){
  const [pilot,exportRecord]=await Promise.all([
    getJson(PILOT,null),getJson(EXPORT,null)
  ]);
  const paymentId=String(pilot?.payment_id||'');
  const orderId=positiveInt(exportRecord?.bling_order_id);
  if(!/^pay_[a-zA-Z0-9]+$/.test(paymentId)||!orderId){
    return json({ok:true,found:false,checks:[],
      message:'Vínculo incompleto. Verifique os registros do pagamento e do pedido no painel de integração.'});
  }
  const token=await blingAccessToken();
  if(!token)throw new Error('A autorização do Bling não está ativa.');
  const asaasKey=String(env('ASAAS_PROD_API_KEY')||'');
  if(asaasKey.length<20)throw new Error('Chave de produção Asaas ausente.');
  // Não repetir chamadas automaticamente em erro 429: consulta manual, somente leitura.
  const payment=await getRemote(ASAAS,'/payments/'+encodeURIComponent(paymentId),asaasKey,'asaas');
  const order=await getRemote(BLING,'/pedidos/vendas/'+encodeURIComponent(orderId),token,'bling');
  if(!order||typeof order!=='object')throw new Error('O Bling não retornou os dados do pedido.');

  const checks=[];
  const asaasStatus=String(payment?.status||'');
  checks.push(check('Pagamento recebido no Asaas',
    asaasStatus==='RECEIVED'?'ok':'attention','Situação: '+asaasStatus));
  checks.push(check('Valor do pagamento R$ 7,00',
    cents(payment?.value)===700?'ok':'attention',
    'Valor conferido diretamente no Asaas de produção'));
  checks.push(check('Pagamento PIX',
    payment?.billingType==='PIX'?'ok':'attention',
    'Tipo consultado na cobrança real'));
  checks.push(check('Referência única da cobrança',
    String(payment?.externalReference||'')===String(pilot?.external_reference||'')?'ok':'attention',
    'Vínculo da cobrança com o registro da Ever Clean'));
  checks.push(check('ID do pedido vinculado',
    String(order.id)===orderId?'ok':'attention','Número no Bling: '+String(order.numero||'não informado')));

  const expectedReference=String(exportRecord?.reference||'');
  const remoteReference=String(order.numeroLoja||'');
  checks.push(check('Referência de origem do pedido',
    remoteReference&&remoteReference===expectedReference?'ok':remoteReference?'attention':'unverified',
    remoteReference===expectedReference?'Corresponde à referência única do PIX':'Número de loja não confirmado na resposta'));
  const clientId=String(order?.contato?.id||'');
  const allClients=await getJson('data/clients',[]);
  const localClient=Array.isArray(allClients)?allClients.find(c=>String(c.id)===String(pilot?.client_id)):null;
  const expectedClientId=String(localClient?.bling_contact_id||
    String(localClient?.id||'').match(/^client-(\d+)$/)?.[1]||'');
  checks.push(check('Cliente vinculado no Bling',
    expectedClientId&&clientId===expectedClientId?'ok':clientId?'attention':'unverified',
    clientId?'Contato ID '+clientId:'Contato não retornado'));

  const lines=Array.isArray(order.itens)?order.itens:[];
  const allProducts=await getJson('data/products',[]);
  const localProduct=Array.isArray(allProducts)?allProducts.find(p=>normalize(p.sku)==='100388'):null;
  const expectedProductId=positiveInt(localProduct?.bling_product_id||
    String(localProduct?.id||'').match(/^bling-product-(\d+)$/)?.[1]);
  const matching=lines.filter(item=>String(item?.produto?.id||'')===expectedProductId||getItemCode(item)==='100388');
  const match=matching[0];
  checks.push(check('Produto SKU 100388 no pedido',
    lines.length===1&&matching.length===1&&match&&
    (String(match?.produto?.id||'')===expectedProductId||getItemCode(match)==='100388')
      ?'ok':'attention',
    lines.length+' item(ns) no pedido'));
  checks.push(check('Quantidade de 1 unidade',
    match&&Number(match.quantidade)===1?'ok':'attention',
    match?'Quantidade retornada: '+String(match.quantidade):'Item não identificado'));
  checks.push(check('Preço unitário de R$ 7,00',
    match&&cents(match.valor)===700?'ok':'attention',
    match?'Valor unitário informado no pedido':'Preço não identificado'));
  const totalCandidates=[order.total,order.totalProdutos].filter(v=>v!==undefined&&v!==null);
  checks.push(check('Total do pedido R$ 7,00',
    totalCandidates.length?cents(totalCandidates[0])===700?'ok':'attention':'unverified',
    totalCandidates.length?'Valor informado pelo Bling: R$ '+Number(totalCandidates[0]).toFixed(2).replace('.',','):'Total não retornado pela API'));

  let stock=null;
  if(expectedProductId){
    try{
      const query=new URLSearchParams();
      query.append('idsProdutos[]',expectedProductId);
      const saldos=await getRemote(BLING,'/estoques/saldos?'+query.toString(),token,'bling');
      const row=Array.isArray(saldos)?saldos.find(s=>String(s?.produto?.id||s?.idProduto||'')===expectedProductId):null;
      stock=row?{
        virtual:row.saldoVirtualTotal??null,
        physical:row.saldoFisicoTotal??null,
        checked:true
      }:null;
    }catch(error){
      // Sem inferir o saldo nem alterar estoque: a conciliação financeira é independente.
      console.warn('Ever Clean reconcile stock unavailable:',String(error?.message||'').slice(0,70));
    }
  }
  const attention=checks.filter(v=>v.status==='attention');
  const unverified=checks.filter(v=>v.status==='unverified');
  const result={
    checked_at:new Date().toISOString(),
    read_only:true,
    payment:{status:asaasStatus,amount:Number(payment?.value||0),payment_id:paymentId},
    order:{id:orderId,number:String(order.numero||exportRecord?.order_number||''),
      situation_id:order?.situacao?.id??null,reference:remoteReference,
      items_count:lines.length},
    stock,checks,
    reconciled:attention.length===0&&unverified.length===0,
    attention_count:attention.length,unverified_count:unverified.length,
    automatic_financial_entries:false,automatic_invoice:false,automatic_stock_write:false,
    message:attention.length?'Há divergências a conferir antes de qualquer lançamento fiscal ou financeiro.':
      unverified.length?'Valores principais conferidos; alguns campos não foram retornados pela API.':
      'Pagamento e pedido conferidos. Estoque, contas e NF-e permanecem para conferência manual.'
  };
  return json({ok:true,...result});
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const body=await request.json().catch(()=>null);
  if(body?.action!=='reconcile')return json({ok:false,message:'Somente conferência de leitura está disponível.'},403);
  try{return await reconcile();}
  catch(error){
    console.error('Ever Clean sale reconciliation:',String(error?.message||'erro').slice(0,140));
    return json({ok:false,message:String(error?.message||'Consulta não concluída').slice(0,140)+'. Nenhuma alteração foi feita no Bling.'},502);
  }
}
