import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,requireSecureAdmin,blingAccessToken} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {buildSafeBlingPreview} from '../shared/everclean-bling-payload.mjs';
import {readProducts,readClients} from '../shared/catalog-store.mjs';
import {billingTypeMatches} from '../shared/payment-methods.mjs';

// Preview local e homologação externa por leitura (GET): NUNCA executa
// POST/PUT no Asaas ou Bling, não registra exportação nem altera financeiro/estoque.
function todayCampoGrande(){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Campo_Grande',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const get=type=>parts.find(part=>part.type===type)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
}
const onlyDigits=value=>String(value||'').replace(/\D/g,'');
let nextReadAt=0;
async function getRemote(url,headers){
  // GET espaçados: limite da API Bling, sem retentar POST e sem tempestade de 429.
  const delay=Math.max(0,nextReadAt-Date.now());
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  nextReadAt=Date.now()+850;
  const response=await fetch(url,{
    method:'GET',headers,signal:AbortSignal.timeout(14000)
  });
  if(!response.ok)throw Error('Consulta externa indisponível (HTTP '+response.status+').');
  const data=await response.json().catch(()=>null);
  if(!data||typeof data!=='object')throw Error('Resposta externa inválida.');
  return data;
}
export async function verifyExternal({order,customer,products,preview,pilot,exportState}){
  if(!preview.valid)return {verified:false,issues:['Prévia local inválida.'],checks:[]};
  const issues=[],checks=[];
  const secret=String(env('ASAAS_PROD_API_KEY')||'');
  if(secret.length<20)throw Error('Credencial de produção Asaas indisponível.');
  const asaas=await getRemote('https://api.asaas.com/v3/payments/'+
    encodeURIComponent(order.payment_id),{
      Accept:'application/json',access_token:secret,
      'User-Agent':'EverCleanCatalogo/1.0'
    });
  // Diz exatamente o que não bate (sem códigos internos), para o admin saber
  // o que resolver. Situações do Asaas traduzidas.
  const STATUS_LABEL={PENDING:'aguardando pagamento',OVERDUE:'vencido',REFUNDED:'estornado',
    REFUND_REQUESTED:'estorno solicitado',REFUND_IN_PROGRESS:'estorno em andamento',
    CHARGEBACK_REQUESTED:'contestação (chargeback) aberta',CHARGEBACK_DISPUTE:'contestação em disputa',
    AWAITING_CHARGEBACK_REVERSAL:'aguardando reversão de contestação',DUNNING_REQUESTED:'em negativação',
    RECEIVED_IN_CASH:'recebido em dinheiro',AWAITING_RISK_ANALYSIS:'em análise de risco no Asaas',
    DELETED:'excluído'};
  const BILLING_LABEL={PIX:'PIX',BOLETO:'boleto',CREDIT_CARD:'cartão',UNDEFINED:'não definida'};
  const status=String(asaas.status||'');
  const mismatch=[];
  if(asaas.id!==order.payment_id)mismatch.push('o código do pagamento é outro');
  if(asaas.externalReference!==order.checkout_reference)mismatch.push('a referência do pedido é outra');
  if(!billingTypeMatches(String(order.payment_method||'pix'),asaas.billingType))
    mismatch.push('a forma de pagamento no Asaas é '+(BILLING_LABEL[asaas.billingType]||'outra'));
  if(!['RECEIVED','CONFIRMED'].includes(status))
    mismatch.push('a situação no Asaas é "'+(STATUS_LABEL[status]||status.toLowerCase()||'desconhecida')+'"');
  if(Math.round(Number(asaas.value)*100)!==Number(order.amount_cents))
    mismatch.push('o valor no Asaas é R$ '+Number(asaas.value||0).toFixed(2).replace('.',','));
  if(mismatch.length)
    issues.push('Pagamento no Asaas não confere com o pedido: '+mismatch.join('; ')+'.');
  else checks.push('Pagamento Asaas confirmado: ID, referência e valor.');
  const token=await blingAccessToken();
  if(!token)throw Error('Bling não conectado.');
  const headers={Accept:'application/json',Authorization:'Bearer '+token};
  const root='https://api.bling.com.br/Api/v3';
  const contact=await getRemote(root+'/contatos/'+preview.payload.contato.id,headers);
  if(onlyDigits(contact?.data?.numeroDocumento)!==
    onlyDigits(customer.document||customer.cpf_cnpj))
    issues.push('Documento do cliente divergente no Bling.');
  else checks.push('Contato e CPF/CNPJ conferidos no Bling.');
  const indexed=new Map((Array.isArray(products)?products:[])
    .map(p=>[String(p.id),p]));
  const entries=Array.isArray(order.items)?order.items:[];
  for(let i=0;i<preview.payload.itens.length;i++){
    const item=preview.payload.itens[i],input=entries[i];
    const data=await getRemote(root+'/produtos/'+item.produto.id,headers);
    const expectedSku=String(input?.product_sku||'').trim();
    const local=indexed.get(String(input?.product_id));
    if(String(data?.data?.codigo||'').trim()!==expectedSku||
       String(local?.sku||'').trim()!==expectedSku)
      issues.push('SKU '+expectedSku+' divergente no Bling.');
  }
  if(!issues.some(x=>x.startsWith('SKU ')))checks.push('SKU dos produtos conferidos no Bling.');
  const params=new URLSearchParams({pagina:'1',limite:'100'});
  params.append('numerosLojas[]',preview.origin_reference);
  const bling=await getRemote(root+'/pedidos/vendas?'+params.toString(),headers);
  if(!Array.isArray(bling.data)||
    bling.data.some(p=>String(p.numeroLoja||'')!==preview.origin_reference))
    throw Error('Consulta de duplicidade do Bling não confiável.');
  if(bling.data.length>1)issues.push('Mais de um pedido encontrado para a referência.');
  let remoteNumber=null, remoteId=null;
  if(bling.data.length===1){
    remoteNumber=String(bling.data[0].numero||'');
    const id=String(bling.data[0].id||'');
    remoteId=id;
    const expected=order.request_number==='HOMOLOG-01'?
      String(pilot?.bling_order_id||''):null;
    if(expected&&expected!==id)issues.push('Pedido localizado não coincide com o registro de exportação.');
    else if(!expected&&exportState&&['sent','already_exists'].includes(exportState.state)&&
      String(exportState.bling_order_id||'')!==id)
      issues.push('Pedido Bling não coincide com a tentativa transacional.');
    else checks.push('Referência de origem já existente no Bling, sem novo envio.');
  }else if((order.request_number==='HOMOLOG-01'&&pilot?.bling_order_id)||
    ['sent','already_exists'].includes(exportState?.state)){
    issues.push('Pedido marcado como exportado, mas não encontrado no Bling.');
  }else checks.push('Referência ausente no Bling; nenhum pedido criado.');
  return {verified:issues.length===0,issues,checks,
    existing_bling_order:remoteNumber,existing_bling_id:remoteId};
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const input=await request.json().catch(()=>null);
  const number=String(input?.request_number||'').trim();
  if(!['preview_payload','verify_external'].includes(input?.action)||
    !(/^[1-9][0-9]{0,9}$/.test(number)||number==='HOMOLOG-01'))
    return json({ok:false,message:'Ação ou pedido inválido.'},400);
  try{
    const [orderQuery,clients,products,pilot]=await Promise.all([
      checkoutDb().query(
        'SELECT id,request_number,customer_id,amount_cents,state,payment_state,payment_id,'+
        'checkout_reference,items,requires_stock_review,paid_at,created_at,payment_method '+
        'FROM everclean_private.checkout_orders WHERE request_number=$1 ORDER BY created_at DESC LIMIT 2',
        [number]),
      readClients(),
      readProducts(),
      getJson('integrations/bling/exports/homolog-01',null)
    ]);
    if(orderQuery.rows.length!==1)
      return json({ok:false,message:'Pedido não localizado de forma única no Neon.'},409);
    const order=orderQuery.rows[0];
    const customer=Array.isArray(clients)?
      clients.find(x=>String(x.id)===String(order.customer_id)):null;
    const preview=buildSafeBlingPreview(order,customer,products,{today:todayCampoGrande()});
    const exists=number==='HOMOLOG-01'&&pilot?.reference==='EC-HOMOLOG-01'&&
      ['enviado','ja_existente'].includes(String(pilot?.state||''))&&
      Boolean(pilot.bling_order_id);
    // Proteção transacional adicional: a prévia informa o estado de tentativas
    // já reservadas sem permitir sua repetição ou alteração.
    const intent=await checkoutDb().query(
      'SELECT state,bling_order_id,bling_order_number,attempt_count FROM everclean_private.bling_export_intents '+
      'WHERE checkout_order_id=$1',[order.id]);
    const exportState=intent.rows[0]||null;
    const verification=input.action==='verify_external'?
      await verifyExternal({order,customer,products,preview,pilot,exportState}):null;
    return json({ok:true,request_number:number,
      reference:preview.origin_reference,
      simulated:true,no_external_writes:true,
      automatic_export_enabled:false,
      can_send_now:false,
      already_exported:exists||['sent','already_exists'].includes(exportState?.state),
      bling_order_number:exists?String(pilot.bling_order_number||''):
        exportState?.bling_order_number||null,
      transaction_state:exportState?.state||'sem_tentativa',
      valid:preview.valid,
      external_verified:verification?.verified===true,
      external_checks:verification?.checks||[],
      external_issues:verification?.issues||[],
      external_order_number:verification?.existing_bling_order||null,
      requires_stock_review:preview.backorder===true,
      issues:preview.issues,
      amount:preview.amount||null,
      item_count:preview.item_count||0,
      // Esta estrutura é uma prévia administrativa, nunca é transmitida ao Bling.
      bling_payload_preview:preview.payload,
      message:exists?'Pedido já exportado ao Bling. Prévia somente para conferência; não reenviar.':
        preview.valid?'Dados preparados para prévia técnica. Envio automático permanece desativado.':
        'A prévia exige correções de cadastro ou valores antes de qualquer envio.'});
  }catch(error){
    console.warn('Ever Clean Bling read-only validation:',String(error?.message||'Erro').slice(0,100));
    return json({ok:false,message:'Consulta externa não concluída. Nenhuma venda foi criada. '+String(error?.message||'').slice(0,85)},502);
  }
}
