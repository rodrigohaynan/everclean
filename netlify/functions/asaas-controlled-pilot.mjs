import crypto from 'node:crypto';
import {getStore} from '@netlify/blobs';
import legacy from './test-api-v7.mjs';
import {json,getJson,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {env} from '../shared/everclean-asaas.mjs';

const KEY='integrations/asaas-prod/controlled-first-checkout';
const PRODUCT_SKU='100388';
const LIMIT_CENTS=700;
const STORE='everclean-test';
const tokenHash=token=>crypto.createHash('sha256').update(token).digest('hex');
const eligibleDocument=v=>[11,14].includes(String(v||'').replace(/\D/g,'').length);
const publicLink=pilot=>'https://evercleancatalogo.netlify.app/pedido-producao/'+encodeURIComponent(pilot.token);
const pilotBillingEnabled=pilot=>Boolean(
  pilot?.state==='prepared'&&pilot?.billing_authorized===false&&
  pilot?.sku==='100388'&&Number(pilot?.quantity)===1&&
  Number(pilot?.max_amount_cents)===700&&
  pilot?.expires_at&&new Date(pilot.expires_at).getTime()>Date.now()&&
  String(env('ASAAS_PROD_PILOT_PIX_ENABLED')||'').toLowerCase()==='true'
);
const safePilot=pilot=>pilot?{
  prepared:true,request_number:pilot.request_number,client_name:pilot.customer_name,
  sku:pilot.sku,quantity:pilot.quantity,amount:pilot.max_amount_cents/100,
  expires_at:pilot.expires_at,state:pilot.state,
  link:publicLink(pilot),payment_enabled:pilotBillingEnabled(pilot)
}:null;

async function eligibleClients(){
  const clients=await getJson('data/clients',[]);
  return (Array.isArray(clients)?clients:[])
    .filter(c=>String(c.id||'')&&eligibleDocument(c.document||c.cpf_cnpj))
    .map(c=>({id:String(c.id),name:String(c.trade_name||c.legal_name||c.name||'Cliente').slice(0,120)}))
    .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}

async function prepare(clientId){
  const existing=await getJson(KEY,null);
  if(existing)return json({ok:true,already_prepared:true,pilot:safePilot(existing),
    message:'Um link único de homologação já foi preparado. Nenhuma cobrança foi criada.'});
  const [clients,products]=await Promise.all([
    getJson('data/clients',[]),getJson('data/products',[])
  ]);
  const customer=(Array.isArray(clients)?clients:[]).find(c=>String(c.id)===String(clientId));
  if(!customer||!eligibleDocument(customer.document||customer.cpf_cnpj))
    return json({ok:false,message:'Escolha um cliente cadastrado com CPF/CNPJ válido.'},400);
  const product=(Array.isArray(products)?products:[]).find(p=>
    String(p.sku||'').trim()===PRODUCT_SKU&&p.active!==false&&p.catalog_visible!==false);
  if(!product||Math.round(Number(product.base_price)*100)!==LIMIT_CENTS||
    product.catalog_allow_backorder===false)
    return json({ok:false,message:'Produto SKU 100388 precisa estar ativo, permitindo encomenda, com preço de R$ 7,00.'},409);
  const token=crypto.randomBytes(24).toString('hex');
  const pilot={
    version:1,state:'prepared',
    token,token_hash:tokenHash(token),
    customer_id:String(customer.id),
    customer_name:String(customer.trade_name||customer.legal_name||customer.name||'Cliente').slice(0,120),
    product_id:String(product.id),sku:PRODUCT_SKU,quantity:1,
    max_amount_cents:LIMIT_CENTS,request_number:'HOMOLOG-01',
    expires_at:new Date(Date.now()+7*86400000).toISOString(),
    prepared_at:new Date().toISOString(),billing_authorized:false
  };
  const store=getStore({name:STORE,consistency:'strong'});
  const written=await store.setJSON(KEY,pilot,{onlyIfNew:true});
  if(!written?.modified){
    const current=await getJson(KEY,null);
    if(current)return json({ok:true,already_prepared:true,pilot:safePilot(current)});
    return json({ok:false,message:'Preparação concorrente não concluída. Consulte novamente.'},409);
  }
  return json({ok:true,pilot:safePilot(pilot),
    message:'Link exclusivo preparado, sem pedidos ou cobranças. Pagamentos reais continuam bloqueados.'});
}

export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const input=await request.json().catch(()=>null);
  if(!['status','prepare'].includes(input?.action))
    return json({ok:false,message:'Ação não permitida.'},403);
  try{
    if(input.action==='status'){
      const [current,clients]=await Promise.all([getJson(KEY,null),eligibleClients()]);
      return json({ok:true,pilot:safePilot(current),clients,
        message:'A homologação está restrita ao link único. Cobranças reais só são geradas após confirmação no checkout.'});
    }
    return await prepare(input.client_id);
  }catch(error){
    console.error('Controlled pilot preparation:',String(error?.message||'Erro').slice(0,100));
    return json({ok:false,message:'Não foi possível preparar a homologação.'},502);
  }
}
