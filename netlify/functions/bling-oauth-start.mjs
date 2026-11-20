import crypto from 'node:crypto';
import legacy from './test-api-v7.mjs';
import {BLING_CALLBACK,json,setJson,hash,requireSecureAdmin} from '../shared/everclean-bling.mjs';

export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  try{
    const auth=await requireSecureAdmin(request,legacy,context);
    if(!auth.ok)return auth.response;
    const clientId=String(process.env.BLING_CLIENT_ID||'');
    const secret=String(process.env.BLING_CLIENT_SECRET||'');
    const redirect=String(process.env.BLING_REDIRECT_URI||'');
    if(!clientId||!secret||redirect!==BLING_CALLBACK){
      return json({ok:false,message:'Confira BLING_CLIENT_ID, BLING_CLIENT_SECRET e BLING_REDIRECT_URI no Netlify.'},503);
    }
    const state=crypto.randomBytes(32).toString('base64url');
    await setJson('integrations/bling/oauth-state/'+hash(state),{
      created_at:Date.now(),used:false
    });
    const url=new URL('https://www.bling.com.br/Api/v3/oauth/authorize');
    url.searchParams.set('response_type','code');
    url.searchParams.set('client_id',clientId);
    url.searchParams.set('state',state);
    return json({ok:true,url:url.toString()});
  }catch(error){
    console.error('Ever Clean Bling start:',error?.message);
    return json({ok:false,message:'Não foi possível iniciar a autorização do Bling.'},500);
  }
}
