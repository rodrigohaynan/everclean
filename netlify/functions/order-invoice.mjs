import crypto from 'node:crypto';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {blingAccessToken} from '../shared/everclean-bling.mjs';
import {invoiceDocument,invoicesFor} from '../shared/invoices.mjs';

// Download da nota fiscal (PDF ou XML) pelo link sigiloso do pedido.
// Somente GET e somente nota autorizada; o cliente nunca acessa o Bling.
const fail=(message,status)=>Response.json({ok:false,message},{status,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

export default async function handler(request){
  if(request.method!=='GET')return fail('Método não permitido.',405);
  const params=new URL(request.url).searchParams;
  const token=String(params.get('token')||'');
  const format=String(params.get('format')||'pdf');
  if(!/^[a-f0-9]{64}$/.test(token)||!['pdf','xml'].includes(format))
    return fail('Link da nota inválido.',404);
  try{
    const digest=crypto.createHash('sha256').update(token).digest('hex');
    const {rows}=await checkoutDb().query(
      'SELECT o.id::text AS id FROM everclean_private.production_catalog_links l '+
      'JOIN everclean_private.checkout_orders o ON o.link_digest=l.token_digest '+
      "WHERE l.token_digest=$1 AND l.token=$2 AND o.state='paid' LIMIT 2",[digest,token]);
    if(rows.length!==1)return fail('Nota fiscal não encontrada para este pedido.',404);
    const invoice=(await invoicesFor(checkoutDb(),[rows[0].id])).get(rows[0].id);
    if(!invoice||invoice.status!=='authorized')return fail('Nota fiscal ainda não disponível.',404);
    const access=await blingAccessToken();
    if(!access)return fail('Nota temporariamente indisponível. Tente novamente em instantes.',503);
    return await invoiceDocument(invoice,format,access,{inline:params.get('view')==='1'});
  }catch(error){
    const status=Number(error?.status);
    console.warn('Ever Clean NF-e download:',String(error?.message||'erro').slice(0,100));
    return fail(status>=400&&status<500?String(error.message):
      'Não foi possível obter a nota agora. Tente novamente em instantes.',status>=400&&status<600?status:502);
  }
}
