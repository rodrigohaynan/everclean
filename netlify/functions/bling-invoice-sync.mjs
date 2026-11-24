import {checkoutDb,databaseConfigured} from '../shared/everclean-transactional-checkout.mjs';
import {blingAccessToken} from '../shared/everclean-bling.mjs';
import {syncOrderInvoice} from '../shared/invoices.mjs';
import {operationalSql} from '../shared/order-release.mjs';

// A cada 10 minutos: procura no Bling a nota fiscal dos pedidos já
// registrados lá e guarda número, série e chave para o cliente baixar.
// Somente leitura no Bling. Consulta poucos pedidos por vez, com intervalo:
//   - sem registro ainda ou nota pendente: a cada execução;
//   - sem nota: a cada execução nos 3 primeiros dias, depois a cada 3 h;
//   - com problema (rejeitada etc.): a cada 30 min;
//   - autorizada: revisa a cada 6 h nos 3 primeiros dias (cancelamento).
export const config={schedule:'*/10 * * * *'};

const LIMIT=10;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export const DUE_ORDERS_SQL=
  "SELECT o.id::text AS id,o.request_number,i.bling_order_id "+
  "FROM everclean_private.checkout_orders o "+
  "JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id "+
  "LEFT JOIN everclean_private.order_invoices v ON v.checkout_order_id=o.id "+
  "WHERE "+operationalSql('o')+" AND i.state IN ('sent','already_exists') "+
  "AND i.bling_order_id ~ '^[0-9]{1,20}$' AND coalesce(o.paid_at,o.released_at) > now()-interval '60 days' "+
  "AND (v.checkout_order_id IS NULL "+
  "OR (v.status='pending' AND v.checked_at < now()-interval '9 minutes') "+
  "OR (v.status='none' AND v.checked_at < now()-CASE WHEN coalesce(o.paid_at,o.released_at) > now()-interval '3 days' "+
  "THEN interval '9 minutes' ELSE interval '3 hours' END) "+
  "OR (v.status='problem' AND v.checked_at < now()-interval '30 minutes') "+
  "OR (v.status='authorized' AND v.issued_at > now()-interval '3 days' "+
  "AND v.checked_at < now()-interval '6 hours')) "+
  "ORDER BY v.checked_at NULLS FIRST, coalesce(o.paid_at,o.released_at) DESC LIMIT "+LIMIT;

export default async function handler(){
  if(!databaseConfigured())return Response.json({ok:true,checked:0,message:'Banco não configurado.'});
  const started=Date.now();
  try{
    const {rows}=await checkoutDb().query(DUE_ORDERS_SQL);
    if(!rows.length)return Response.json({ok:true,checked:0});
    const token=await blingAccessToken();
    if(!token)return Response.json({ok:false,checked:0,message:'Bling desconectado.'},{status:503});
    const result={checked:0,authorized:[],failed:0};
    for(const order of rows){
      if(Date.now()-started>18000)break;
      try{
        const synced=await syncOrderInvoice(checkoutDb(),order,token);
        result.checked++;
        if(synced.status==='authorized'&&synced.changed)result.authorized.push(order.request_number);
      }catch(error){
        result.failed++;
        console.warn('Ever Clean NF-e: pedido',order.request_number,'não consultado:',
          String(error?.message||'erro').slice(0,100));
        if(Number(error?.status)===429)break;
      }
      await pause(450);
    }
    return Response.json({ok:true,...result});
  }catch(error){
    console.error('Ever Clean NF-e sync:',String(error?.message||'falha').slice(0,100));
    return Response.json({ok:false,message:'Consulta de notas indisponível.'},{status:500});
  }
}
