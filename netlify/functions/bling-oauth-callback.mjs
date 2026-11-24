import {BLING_CALLBACK,json,getJson,setJson,hash,blingToken,saveBlingTokens} from '../shared/everclean-bling.mjs';
import {SITE_URL} from '../../src/lib/site.js';

const PAGE=SITE_URL+'/admin/bling';
const redirect=(result)=>Response.redirect(PAGE+'?bling='+encodeURIComponent(result),303);
export default async function handler(request){
  if(request.method!=='GET')return json({ok:false,message:'Método não permitido.'},405);
  const address=new URL(request.url);
  if(address.origin+address.pathname!==BLING_CALLBACK){
    return json({ok:false,message:'URL de retorno incorreta.'},400);
  }
  if(process.env.BLING_REDIRECT_URI!==BLING_CALLBACK){
    return redirect('config_error');
  }
  const state=address.searchParams.get('state')||'';
  if(!/^[a-zA-Z0-9_-]{40,120}$/.test(state))return redirect('invalid_state');
  const key='integrations/bling/oauth-state/'+hash(state);
  try{
    const saved=await getJson(key,null);
    if(!saved||saved.used||Date.now()-Number(saved.created_at)>600000){
      return redirect('invalid_state');
    }
    await setJson(key,{created_at:saved.created_at,used:true});
    if(address.searchParams.has('error'))return redirect('denied');
    const code=address.searchParams.get('code')||'';
    if(!code||code.length>2048)return redirect('missing_code');
    // Código OAuth do Bling expira em 30 segundos: troca imediata no servidor.
    const tokens=await blingToken({grant_type:'authorization_code',code});
    await saveBlingTokens(tokens);
    return redirect('connected');
  }catch(error){
    console.error('Ever Clean Bling callback:',String(error?.message||'Falha OAuth').slice(0,130));
    return redirect('token_error');
  }
}
