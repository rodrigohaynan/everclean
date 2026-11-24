import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,requireSecureAdmin,blingIssueKey} from '../shared/everclean-bling.mjs';
import {listProductionOrders} from '../shared/everclean-transactional-checkout.mjs';
import {readClients} from '../shared/catalog-store.mjs';

// Consulta restrita à administração, sem funções de lançamento financeiro.
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const body=await request.json().catch(()=>null);
  if(body?.action!=='list')return json({ok:false,message:'Ação não permitida.'},403);
  try{
    const [orders,clients]=await Promise.all([
      listProductionOrders(75),readClients()
    ]);
    const names=new Map((Array.isArray(clients)?clients:[]).map(c=>
      [String(c.id),String(c.trade_name||c.legal_name||'Cliente').slice(0,150)]));
    // Pedidos pagos ainda fora do Bling: motivo registrado pela rotina automática.
    const issues=await Promise.all(orders.map(o=>
      o.status==='paid'&&!o.bling_export_confirmed&&!o.bling_export_state?
        getJson(blingIssueKey(o.request_number),null).catch(()=>null):null));
    return json({ok:true,orders:orders.map((o,i)=>({...o,
      customer_name:names.get(o.customer_id)||'Cliente não localizado',
      bling_issue:issues[i]?{issues:(Array.isArray(issues[i].issues)?issues[i].issues:[]).slice(0,3)
        .map(x=>String(x).slice(0,200)),at:issues[i].at||null}:null
    })),automatic_invoices:false,mode:'read_only',
      message:'Consulta administrativa ao Neon. Nenhuma cobrança, pedido, estoque ou NF-e foi alterado.'});
  }catch(error){
    console.warn('Produção consulta pedidos Neon:',String(error.message||'Falha').slice(0,80));
    return json({ok:false,message:'Não foi possível consultar pedidos de produção.'},502);
  }
}
