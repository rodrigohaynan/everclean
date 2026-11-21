import legacy from './test-api-v7.mjs';
import {json,getJson,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {listProductionOrders} from '../shared/everclean-transactional-checkout.mjs';

// Consulta restrita à administração, sem funções de lançamento financeiro.
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const access=await requireSecureAdmin(request,legacy,context);
  if(!access.ok)return access.response;
  const body=await request.json().catch(()=>null);
  if(body?.action!=='list')return json({ok:false,message:'Ação não permitida.'},403);
  try{
    const [orders,clients]=await Promise.all([
      listProductionOrders(75),getJson('data/clients',[])
    ]);
    const names=new Map((Array.isArray(clients)?clients:[]).map(c=>
      [String(c.id),String(c.trade_name||c.legal_name||'Cliente').slice(0,150)]));
    return json({ok:true,orders:orders.map(o=>({...o,
      customer_name:names.get(o.customer_id)||'Cliente não localizado'
    })),automatic_bling_export:false,automatic_invoices:false,
      message:'Consulta administrativa; nenhuma cobrança, pedido ou estoque alterado.'});
  }catch(error){
    console.warn('Produção consulta pedidos Neon:',String(error.message||'Falha').slice(0,80));
    return json({ok:false,message:'Não foi possível consultar pedidos de produção.'},502);
  }
}
