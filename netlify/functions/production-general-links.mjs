import crypto from 'node:crypto';
import legacy from '../shared/admin-api/index.mjs';
import {json,getJson,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {generalPublicRelease,generalPaymentEnabled} from '../shared/everclean-general-production-checkout.mjs';
import {readClients} from '../shared/catalog-store.mjs';

// Links gerais de produção isolados dos links Sandbox e do piloto.
// A preparação NÃO cria PIX, pedido, cliente Asaas ou qualquer efeito no Bling.
const digits=value=>String(value||'').replace(/\D/g,'');
const name=c=>String(c.trade_name||c.legal_name||c.name||'Cliente Ever Clean').slice(0,160);
const publicUrl=token=>'https://evercleancatalogo.netlify.app/pedido-producao/'+token;
function safeLink(x){
  const orderState=String(x.checkout_state||'');
  return {id:x.id,request_number:x.request_number,customer_id:x.customer_id,
    customer_name:x.customer_name,status:orderState||x.status,link_status:x.status,
    created_at:x.created_at,expires_at:x.expires_at,checkout_mode:'production',
    payment_enabled:!orderState&&generalPaymentEnabled({link:x}),
    payment_scope:x.source_request_id?'approved_customer_request':null,
    url:publicUrl(x.token)};
}
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const input=await request.json().catch(()=>null);
  const action=String(input?.action||'');
  if(!['options','prepare','list','cancel'].includes(action))
    return json({ok:false,message:'Ação não permitida.'},403);
  try{
    if(action==='options'){
      const clients=await readClients();
      return json({ok:true,clients:(Array.isArray(clients)?clients:[]).map(c=>({
        id:String(c.id||''),name:name(c),has_document:[11,14].includes(
          digits(c.document||c.cpf_cnpj).length)
      })).filter(c=>c.id).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).slice(0,1000)});
    }
    if(action==='prepare'){
      if(input?.accept!==true)return json({ok:false,message:'Confirme a preparação do link.'},403);
      const clients=await readClients();
      const customer=Array.isArray(clients)?
        clients.find(c=>String(c.id)===String(input.customer_id)):null;
      if(!customer||![11,14].includes(digits(customer.document||customer.cpf_cnpj).length))
        return json({ok:false,message:'Cliente com CPF/CNPJ não localizado.'},409);
      // Número isolado da série Sandbox (~1238), com limite de 10 dígitos.
      // A restrição UNIQUE impede referências de pedidos duplicadas.
      for(let i=0;i<4;i++){
        const token=crypto.randomBytes(32).toString('hex');
        const sha=crypto.createHash('sha256').update(token).digest('hex');
        try{
          const {rows}=await checkoutDb().query(
            'INSERT INTO everclean_private.production_catalog_links '+
            '(id,token_digest,token,request_number,customer_id,customer_name,expires_at) '+
            "SELECT $1,$2,$3,CAST(COALESCE(MAX(request_number::bigint),999999999)+1 AS varchar),$4,$5,now()+interval '7 days' "+
            'FROM everclean_private.production_catalog_links RETURNING *',
            [crypto.randomUUID(),sha,token,String(customer.id),name(customer)]
          );
          const ready=safeLink(rows[0]);
          return json({ok:true,link:ready,
            message:ready.payment_enabled?
              'Link PIX real preparado. Nenhuma cobrança criada: o cliente precisará conferir o carrinho e confirmar o pagamento.':
              'Link de prévia preparado sem cobrança real.'});
        }catch(error){if(error?.code!=='23505'||i===3)throw error;}
      }
      return json({ok:false,message:'Conflito na numeração; tente novamente.'},409);
    }
    if(action==='cancel'){
      const id=String(input?.id||'');
      if(!/^[a-f0-9-]{36}$/i.test(id))return json({ok:false,message:'Identificador inválido.'},400);
      const q=await checkoutDb().query(
        "UPDATE everclean_private.production_catalog_links SET status='canceled' "+
        "WHERE id=$1 AND status='prepared' AND NOT EXISTS ("+
        'SELECT 1 FROM everclean_private.checkout_orders o WHERE o.link_digest=token_digest'+
        ') RETURNING id',[id]
      );
      if(!q.rowCount)return json({ok:false,message:'Link já utilizado ou cancelado; operação bloqueada.'},409);
      return json({ok:true,message:'Link cancelado. Nenhum pedido alterado.'});
    }
    const {rows}=await checkoutDb().query(
      'SELECT l.id,l.token,l.request_number,l.customer_id,l.customer_name,l.status,l.created_at,l.expires_at, '+
      'l.payment_authorized,l.payment_authorized_at,l.payment_max_cents,l.payment_approved_items,l.source_request_id, '+
      '(SELECT o.state FROM everclean_private.checkout_orders o WHERE o.link_digest=l.token_digest LIMIT 1) AS checkout_state '+
      'FROM everclean_private.production_catalog_links l ORDER BY l.created_at DESC LIMIT 100'
    );
    const release=generalPublicRelease();
    return json({ok:true,links:rows.map(safeLink),payment_enabled:release.enabled,
      max_payment_amount:release.enabled?release.max_cents/100:null,
      message:release.enabled?
        'Novos links podem aceitar PIX real, confirmado pelo cliente. Links antigos permanecem no Sandbox.':
        'Links de produção preparados para consulta. PIX geral bloqueado.'});
  }catch(error){
    console.warn('Ever Clean links de produção:',String(error?.message||'').slice(0,90));
    return json({ok:false,message:'Operação de links não concluída. Nenhuma cobrança criada.'},502);
  }
}
