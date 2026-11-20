import crypto from 'node:crypto';
import {getStore} from '@netlify/blobs';

export const BLING_CALLBACK='https://evercleancatalogo.netlify.app/.netlify/functions/bling-oauth-callback';
const store=()=>getStore({name:'everclean-test',consistency:'strong'});
export const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export const getJson=async(key,fallback=null)=>{
  const result=await store().get(key,{type:'json',consistency:'strong'});
  return result===null?fallback:result;
};
export const setJson=(key,value)=>store().setJSON(key,value);
export const hash=(value)=>crypto.createHash('sha256').update(value).digest('hex');

export async function requireSecureAdmin(request,handler,context){
  const h=new Headers(request.headers);h.delete('content-length');
  const check=new Request(request.url,{method:'POST',headers:h,body:JSON.stringify({action:'session'})});
  const response=await handler(check,context);
  const session=await response.clone().json().catch(()=>null);
  if(!response.ok||!session?.ok||session?.user?.email!=='evercleanhigieneprofissional@gmail.com'){
    return {ok:false,response:json({ok:false,message:'Faça login como administrador.'},401)};
  }
  const config=await getJson('auth/config',null);
  if(!config?.secure_setup_at){
    return {ok:false,response:json({ok:false,message:'Configure primeiro uma senha segura na tela Configurar ou recuperar senha.'},403)};
  }
  return {ok:true};
}

function encryptionKey(){
  const secret=String(process.env.BLING_CLIENT_SECRET||'');
  if(!secret)throw Error('Bling não configurado');
  return crypto.createHash('sha256').update('everclean-bling-tokens-v1:').update(secret).digest();
}
export async function saveBlingTokens(tokens){
  if(!tokens?.access_token||!tokens?.refresh_token)throw Error('Resposta OAuth incompleta.');
  const now=Date.now();
  const record={
    access_token:tokens.access_token,
    refresh_token:tokens.refresh_token,
    expires_at:new Date(now+Number(tokens.expires_in||21600)*1000).toISOString(),
    connected_at:new Date(now).toISOString(),
    token_type:tokens.token_type||'Bearer',
    scope:tokens.scope||''
  };
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(record),'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  await setJson('integrations/bling/tokens',{
    version:1,iv:iv.toString('base64'),tag:tag.toString('base64'),
    data:encrypted.toString('base64'),connected_at:record.connected_at,
    expires_at:record.expires_at
  });
  return {connected_at:record.connected_at,expires_at:record.expires_at};
}
export async function readBlingTokens(){
  const sealed=await getJson('integrations/bling/tokens',null);
  if(!sealed?.iv||!sealed?.tag||!sealed?.data)return null;
  const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(sealed.iv,'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag,'base64'));
  const content=Buffer.concat([decipher.update(Buffer.from(sealed.data,'base64')),decipher.final()]).toString('utf8');
  return JSON.parse(content);
}
export async function blingToken(grant){
  const clientId=String(process.env.BLING_CLIENT_ID||'');
  const clientSecret=String(process.env.BLING_CLIENT_SECRET||'');
  if(!clientId||!clientSecret)throw Error('Credenciais Bling ausentes.');
  const res=await fetch('https://api.bling.com.br/Api/v3/oauth/token',{
    method:'POST',
    headers:{
      'Content-Type':'application/x-www-form-urlencoded',
      'Accept':'application/json',
      'Authorization':'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),
      'enable-jwt':'1'
    },
    body:new URLSearchParams(grant).toString(),
    signal:AbortSignal.timeout(15000)
  });
  const data=await res.json().catch(()=>null);
  if(!res.ok||!data?.access_token||!data?.refresh_token){
    console.warn('Bling OAuth: token exchange error',res.status,String(data?.error||'').slice(0,80));
    throw Error('O Bling não autorizou a conexão. Confira o aplicativo e tente novamente.');
  }
  return data;
}
export async function blingAccessToken(){
  const tokens=await readBlingTokens();
  if(!tokens)return null;
  if(Date.parse(tokens.expires_at)-Date.now()>120000)return tokens.access_token;
  const fresh=await blingToken({grant_type:'refresh_token',refresh_token:tokens.refresh_token});
  await saveBlingTokens(fresh);
  return fresh.access_token;
}
