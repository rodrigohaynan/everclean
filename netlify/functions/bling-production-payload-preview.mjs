import legacy from './test-api-v7.mjs';
import {json,getJson,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {buildSafeBlingPreview} from '../shared/everclean-bling-payload.mjs';

// Preview apenas: não consulta/escreve no Asaas, não executa POST/PUT no Bling,
// não registra exportação e não altera valores financeiros ou estoque.
function todayCampoGrande(){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Campo_Grande',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const get=type=>parts.find(part=>part.type===type)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const input=await request.json().catch(()=>null);
  const number=String(input?.request_number||'').trim();
  if(input?.action!=='preview_payload'||!(/^[1-9][0-9]{0,9}$/.test(number)||number==='HOMOLOG-01'))
    return json({ok:false,message:'Ação ou pedido inválido.'},400);
  try{
    const [orderQuery,clients,products,pilot]=await Promise.all([
      checkoutDb().query(
        'SELECT id,request_number,customer_id,amount_cents,state,payment_state,payment_id,'+
        'checkout_reference,items,requires_stock_review,paid_at,created_at '+
        'FROM everclean_private.checkout_orders WHERE request_number=$1 ORDER BY created_at DESC LIMIT 2',
        [number]),
      getJson('data/clients',[]),
      getJson('data/products',[]),
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
      'SELECT state,bling_order_number,attempt_count FROM everclean_private.bling_export_intents '+
      'WHERE checkout_order_id=$1',[order.id]);
    const exportState=intent.rows[0]||null;
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
    console.warn('Ever Clean Bling payload preview:',String(error?.message||'Erro').slice(0,100));
    return json({ok:false,message:'Prévia não concluída. Nenhuma venda foi criada.'},502);
  }
}
