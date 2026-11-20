import legacy from './test-api-v7.mjs';
import {json,getJson,requireSecureAdmin,readBlingTokens,blingAccessToken} from '../shared/everclean-bling.mjs';
import {runBlingStockSync,getStockSyncStatus,setStockSyncEnabled} from '../shared/bling-stock-sync.mjs';

export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  try{
    const auth=await requireSecureAdmin(request,legacy,context);
    if(!auth.ok)return auth.response;
    const body=await request.json().catch(()=>({}));
    const action=String(body.action||'status');
    if(!['status','test','sync_now','sync_pause','sync_resume'].includes(action))return json({ok:false,message:'Ação inválida.'},400);
    const configured=Boolean(process.env.BLING_CLIENT_ID&&process.env.BLING_CLIENT_SECRET&&process.env.BLING_REDIRECT_URI);
    let tokens=null;
    try{tokens=await readBlingTokens();}catch{return json({ok:false,message:'Tokens incompatíveis. Autorize novamente o aplicativo.'},409);}
    const connected=Boolean(tokens?.refresh_token);
    if(action==='status'){
      const stock_sync=await getStockSyncStatus();
      return json({ok:true,configured,connected,connected_at:tokens?.connected_at||null,expires_at:tokens?.expires_at||null,stock_sync,automatic_orders:false,automatic_invoices:false});
    }
    if(!connected)return json({ok:false,message:'Autorize primeiro o Bling no painel.'},409);
    if(action==='sync_pause'||action==='sync_resume'){
      const status=await setStockSyncEnabled(action==='sync_resume');
      return json({ok:true,stock_sync:status,message:status.enabled?'Sincronização automática ativada.':'Sincronização automática pausada.'});
    }
    if(action==='sync_now'){
      const result=await runBlingStockSync({source:'manual'});
      return json(result,result.ok?200:502);
    }
    const access=await blingAccessToken();
    const res=await fetch('https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=1',{
      method:'GET',
      headers:{Authorization:'Bearer '+access,'Accept':'application/json','enable-jwt':'1'},
      signal:AbortSignal.timeout(15000)
    });
    if(!res.ok)return json({ok:false,message:res.status===403?'Conexão ativa, mas sem permissão para consultar produtos.':res.status===401?'O Bling recusou o token. Autorize o aplicativo novamente.':'O Bling respondeu HTTP '+res.status},res.status===403?403:502);
    return json({ok:true,connected:true,message:'Conexão validada. Consulta de produtos autorizada.',automatic_orders:false,automatic_invoices:false});
  }catch(error){
    console.error('Ever Clean Bling integration:',String(error?.message||'Erro').slice(0,150));
    return json({ok:false,message:'Não foi possível validar o Bling. Confira a autorização e tente novamente.'},500);
  }
}
