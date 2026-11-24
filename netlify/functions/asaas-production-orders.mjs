import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,requireSecureAdmin,blingIssueKey,blingAccessToken} from '../shared/everclean-bling.mjs';
import {listProductionOrders,checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {syncOrderInvoice,NFE_SITUATIONS} from '../shared/invoices.mjs';
import {readClients} from '../shared/catalog-store.mjs';
import {operationalSql} from '../shared/order-release.mjs';

// Consulta restrita à administração, sem funções de lançamento financeiro.
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const body=await request.json().catch(()=>null);
  if(body?.action==='invoice_refresh'||body?.action==='invoice_shared')
    return invoiceAction(body);
  if(body?.action!=='list')return json({ok:false,message:'Ação não permitida.'},403);
  try{
    const [orders,clients]=await Promise.all([
      listProductionOrders(75),readClients()
    ]);
    const names=new Map((Array.isArray(clients)?clients:[]).map(c=>
      [String(c.id),String(c.trade_name||c.legal_name||'Cliente').slice(0,150)]));
    const phones=new Map((Array.isArray(clients)?clients:[]).map(c=>
      [String(c.id),String(c.phone||'').replace(/\D/g,'').slice(0,13)]));
    // Pedidos pagos ainda fora do Bling: motivo registrado pela rotina automática.
    const issues=await Promise.all(orders.map(o=>
      (o.status==='paid'||o.released)&&!o.bling_export_confirmed&&!o.bling_export_state?
        getJson(blingIssueKey(o.request_number),null).catch(()=>null):null));
    return json({ok:true,orders:orders.map((o,i)=>({...o,
      customer_name:names.get(o.customer_id)||'Cliente não localizado',
      customer_phone:phones.get(o.customer_id)||null,
      invoice:o.invoice?{...o.invoice,
        bling_status_label:NFE_SITUATIONS[o.invoice.bling_status]||null}:null,
      bling_issue:issues[i]?{issues:(Array.isArray(issues[i].issues)?issues[i].issues:[]).slice(0,3)
        .map(x=>String(x).slice(0,200)),at:issues[i].at||null}:null
    })),automatic_invoices:false,mode:'read_only',
      message:'Consulta administrativa ao Neon. Nenhuma cobrança, pedido, estoque ou NF-e foi alterado.'});
  }catch(error){
    console.warn('Produção consulta pedidos Neon:',String(error.message||'Falha').slice(0,80));
    return json({ok:false,message:'Não foi possível consultar pedidos de produção.'},502);
  }
}

// Nota fiscal no admin: consultar o Bling agora (somente leitura) ou marcar
// que o link foi enviado ao cliente pelo WhatsApp.
async function invoiceAction(body){
  const number=String(body?.request_number||'');
  if(!/^[1-9][0-9]{0,9}$/.test(number))return json({ok:false,message:'Pedido inválido.'},400);
  const {rows}=await checkoutDb().query(
    "SELECT o.id::text AS id,o.request_number,i.bling_order_id FROM everclean_private.checkout_orders o "+
    "LEFT JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id "+
    "WHERE o.request_number=$1 AND "+operationalSql('o')+" LIMIT 2",[number]);
  if(rows.length!==1)return json({ok:false,message:'Pedido pago não encontrado.'},404);
  const order=rows[0];
  if(body.action==='invoice_shared'){
    const updated=await checkoutDb().query(
      "UPDATE everclean_private.order_invoices SET shared_at=now(),updated_at=now() "+
      "WHERE checkout_order_id=$1 AND status='authorized' RETURNING shared_at",[order.id]);
    return json({ok:updated.rowCount===1,shared_at:updated.rows[0]?.shared_at||null});
  }
  if(!/^[0-9]{1,20}$/.test(String(order.bling_order_id||'')))
    return json({ok:false,message:'Pedido ainda não registrado no Bling.'},409);
  try{
    const token=await blingAccessToken();
    if(!token)return json({ok:false,message:'Bling desconectado.'},503);
    const result=await syncOrderInvoice(checkoutDb(),order,token);
    return json({ok:true,invoice:{status:result.status,number:result.number,series:result.series,
      issued_at:result.issued_at,bling_status:result.bling_status,
      bling_status_label:NFE_SITUATIONS[result.bling_status]||null}});
  }catch(error){
    console.warn('Ever Clean NF-e admin:',String(error?.message||'erro').slice(0,90));
    return json({ok:false,message:'Não foi possível consultar a nota no Bling agora.'},502);
  }
}
