import crypto from 'node:crypto';
import legacy from './test-api-v7.mjs';
import {getJson,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {generalProductionCatalog} from '../shared/everclean-general-production-checkout.mjs';

// Portal independente do checkout de pagamento. Provisionamento manual pelo administrador.
// Todos os acessos a dados privados exigem cookie de sessão HttpOnly, Secure e SameSite.
const API_COOKIE='ec_customer_portal';
const URL_BASE='https://evercleancatalogo.netlify.app';
const SESSION_SECONDS=14*24*3600;
const LINK_SESSION_SECONDS=12*3600;
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const response=(data,status=200,headers={})=>Response.json(data,{status,headers:{
  'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',...headers
}});
const clean=v=>String(v??'').trim();
const mail=v=>clean(v).toLocaleLowerCase('en-US');
const clientName=c=>clean(c.trade_name||c.legal_name||c.name||'Cliente Ever Clean').slice(0,160);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const validEmail=v=>/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)&&v.length<=254;
const clientEmail=c=>mail(c.email||'');
const tokenValid=t=>/^[a-f0-9]{64}$/.test(t);
const passwordValid=v=>typeof v==='string'&&v.length>=12&&v.length<=72&&
  !/^\s+$/.test(v);
const passwordHash=v=>{
  const salt=crypto.randomBytes(16).toString('hex');
  return 'scrypt-v1:'+salt+':'+crypto.scryptSync(v,salt,32).toString('hex');
};
const passwordMatches=(password,record)=>{
  const pieces=String(record||'').split(':');
  if(pieces.length!==3||pieces[0]!=='scrypt-v1'||!/^[a-f0-9]{32}$/.test(pieces[1])||
     !/^[a-f0-9]{64}$/.test(pieces[2]))return false;
  const expected=Buffer.from(pieces[2],'hex');
  const actual=crypto.scryptSync(String(password||''),pieces[1],32);
  return crypto.timingSafeEqual(actual,expected);
};
const clearCookie=()=>API_COOKIE+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax';
const setCookie=(token,maxAge=SESSION_SECONDS)=>API_COOKIE+'='+token+'; Path=/; Max-Age='+maxAge+
  '; Secure; HttpOnly; SameSite=Lax';
const parseCookie=request=>{
  const raw=String(request.headers.get('cookie')||'');
  const parts=raw.split(';').map(x=>x.trim());
  const cookie=parts.find(x=>x.startsWith(API_COOKIE+'='));
  const token=cookie?cookie.slice(API_COOKIE.length+1):'';
  return tokenValid(token)?token:null;
};
const allClients=async()=>{
  const rows=await getJson('data/clients',[]);
  return Array.isArray(rows)?rows:[];
};
const verifiedClient=(clients,id,email)=>{
  const c=clients.find(c=>String(c.id)===String(id));
  return c&&validEmail(clientEmail(c))&&clientEmail(c)===email?c:null;
};
// O link de pedido é uma credencial temporária: nunca aceitar apenas customer_id
// enviado pelo navegador. Revalidar a origem e a expiração em cada uso da sessão.
const resolveOrderLink=async(kind,raw,digest)=>{
  if(!['legacy','production'].includes(kind)||!/^[a-f0-9]{64}$/.test(digest))
    return null;
  if(kind==='production'){
    const {rows}=await checkoutDb().query(
      'SELECT customer_id,expires_at FROM everclean_private.production_catalog_links '+
      "WHERE token_digest=$1 AND status='prepared' AND expires_at>now() "+
      (raw?'AND token=$2 ':'')+'LIMIT 1',raw?[digest,raw]:[digest]
    );
    return rows[0]||null;
  }
  const links=await getJson('data/links',[]);
  if(!Array.isArray(links))return null;
  const revoked=new Set(['cancelado','canceled','expirado','expired','disabled','desativado','revoked']);
  const link=links.find(item=>{
    const stored=String(item?.token||'');
    return stored.length>=32&&stored.length<=128&&
      /^[a-f0-9]+$/.test(stored)&&hash(stored)===digest&&
      (!raw||stored===raw);
  });
  if(!link||revoked.has(String(link.status||'').toLowerCase())||
    !link.expires_at||Date.parse(link.expires_at)<=Date.now()||
    !Number.isFinite(Date.parse(link.expires_at)))return null;
  return {customer_id:String(link.customer_id),expires_at:link.expires_at};
};
const session=async(request)=>{
  const token=parseCookie(request);
  if(!token)return null;
  const {rows}=await checkoutDb().query(
    'SELECT s.customer_id,s.auth_method,s.source_kind,s.source_token_digest,'+
    'a.email,a.status AS account_status FROM everclean_private.customer_portal_sessions s '+
    'LEFT JOIN everclean_private.customer_portal_accounts a ON a.customer_id=s.customer_id '+
    'WHERE s.token_digest=$1 AND s.expires_at>now() LIMIT 1',
    [hash(token)]
  );
  const record=rows[0];
  if(!record||record.account_status==='disabled')return null;
  const clients=await allClients();
  if(record.auth_method==='link'){
    const source=await resolveOrderLink(record.source_kind,null,
      String(record.source_token_digest||'').trim());
    if(!source||String(source.customer_id)!==String(record.customer_id))return null;
    const customer=clients.find(c=>String(c.id)===String(record.customer_id));
    return customer?{customer,id:String(record.customer_id),access:'order_link'}:null;
  }
  if(record.auth_method!=='password'||record.account_status!=='active')return null;
  const customer=verifiedClient(clients,record.customer_id,record.email);
  return customer?{customer,id:String(record.customer_id),access:'account'}:null;
};
const exchangeOrderLink=async(kind,raw)=>{
  const sourceKind=String(kind||'');
  const sourceToken=String(raw||'').trim();
  if(!['legacy','production'].includes(sourceKind)||
    !/^[a-f0-9]{32,128}$/.test(sourceToken)||
    (sourceKind==='production'&&!tokenValid(sourceToken)))
    return response({ok:false,message:'Link de pedido inválido.'},400);
  const digest=hash(sourceToken);
  const source=await resolveOrderLink(sourceKind,sourceToken,digest);
  if(!source)return response({ok:false,message:'Link expirado ou desativado. Solicite um novo acesso.'},410);
  const clients=await allClients();
  const customer=clients.find(c=>String(c.id)===String(source.customer_id));
  if(!customer)return response({ok:false,message:'Cliente não localizado no cadastro.'},404);
  const {rows}=await checkoutDb().query(
    'SELECT status FROM everclean_private.customer_portal_accounts '+
    'WHERE customer_id=$1 LIMIT 1',[String(source.customer_id)]
  );
  if(rows[0]?.status==='disabled')
    return response({ok:false,message:'Acesso do cliente desativado.'},403);
  const expiresAt=Date.parse(source.expires_at);
  const duration=Math.min(LINK_SESSION_SECONDS,Math.floor((expiresAt-Date.now())/1000));
  if(!Number.isFinite(duration)||duration<1)
    return response({ok:false,message:'Este link expirou.'},410);
  const sessionToken=crypto.randomBytes(32).toString('hex');
  await checkoutDb().query(
    'INSERT INTO everclean_private.customer_portal_sessions '+
    '(token_digest,customer_id,expires_at,auth_method,source_kind,source_token_digest) '+
    "VALUES ($1,$2,now()+($3::integer*interval '1 second'),'link',$4,$5)",
    [hash(sessionToken),String(source.customer_id),duration,sourceKind,digest]
  );
  return response({ok:true,customer_name:clientName(customer),expires_in_seconds:duration,
    message:'Acesso temporário validado pelo link original do cliente.'},200,
    {'Set-Cookie':setCookie(sessionToken,duration)});
};
const newSession=async(customerId)=>{
  const raw=crypto.randomBytes(32).toString('hex');
  await checkoutDb().query(
    'INSERT INTO everclean_private.customer_portal_sessions(token_digest,customer_id,expires_at) '+
    "VALUES ($1,$2,now()+interval '14 days')",[hash(raw),String(customerId)]
  );
  return raw;
};
const adminClients=async()=>{
  const clients=await allClients();
  const {rows}=await checkoutDb().query(
    'SELECT customer_id,status FROM everclean_private.customer_portal_accounts LIMIT 1500'
  );
  const registered=new Map(rows.map(x=>[String(x.customer_id),x.status]));
  const emails=new Map();
  for(const c of clients){
    const e=clientEmail(c);
    if(e)emails.set(e,(emails.get(e)||0)+1);
  }
  return clients.filter(c=>c.id!==undefined&&c.id!==null).slice(0,1500).map(c=>{
    const email=clientEmail(c);
    return {id:String(c.id),name:clientName(c),email,
      eligible:validEmail(email)&&emails.get(email)===1,
      status:registered.get(String(c.id))||'not_invited'};
  }).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
};
const adminInvite=async(input)=>{
  if(input.confirm!==true)return response({ok:false,message:'Confirme o convite exclusivo.'},403);
  const clients=await adminClients();
  const target=clients.find(c=>c.id===String(input.customer_id||''));
  if(!target||!target.eligible)return response({ok:false,
    message:'Cliente sem e-mail válido ou com e-mail duplicado. Regularize o cadastro.'},409);
  const raw=crypto.randomBytes(32).toString('hex'),client=await checkoutDb().connect();
  try{
    await client.query('BEGIN');
    await client.query(
      'UPDATE everclean_private.customer_portal_invitations SET consumed_at=now() '+
      'WHERE customer_id=$1 AND consumed_at IS NULL',[target.id]
    );
    await client.query(
      'INSERT INTO everclean_private.customer_portal_invitations '+
      "(token_digest,customer_id,email,expires_at) VALUES ($1,$2,$3,now()+interval '48 hours')",
      [hash(raw),target.id,target.email]
    );
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});throw error;
  }finally{client.release();}
  return response({ok:true,customer_name:target.name,
    invitation_url:URL_BASE+'/cliente/ativar/'+raw,
    expires_in_hours:48,customer_status:target.status,
    message:'Convite único gerado. Copie e envie diretamente ao contato verificado do cliente.'});
};
const adminDisable=async(input)=>{
  if(input.confirm!==true)return response({ok:false,message:'Confirmação obrigatória.'},403);
  const target=String(input.customer_id||'');
  if(!target||target.length>150)return response({ok:false,message:'Cliente inválido.'},400);
  const client=await checkoutDb().connect();
  try{
    await client.query('BEGIN');
    const result=await client.query(
      "UPDATE everclean_private.customer_portal_accounts SET status='disabled',"+
      "updated_at=now() WHERE customer_id=$1 RETURNING customer_id",[target]
    );
    await client.query('DELETE FROM everclean_private.customer_portal_sessions WHERE customer_id=$1',[target]);
    await client.query(
      'UPDATE everclean_private.customer_portal_invitations SET consumed_at=now() '+
      'WHERE customer_id=$1 AND consumed_at IS NULL',[target]
    );
    await client.query('COMMIT');
    return response({ok:true,disabled:result.rowCount===1});
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});throw error;
  }finally{client.release();}
};
const checkInvitation=async(raw)=>{
  if(!tokenValid(raw))return response({ok:false,message:'Convite inválido.'},404);
  const {rows}=await checkoutDb().query(
    'SELECT customer_id,email FROM everclean_private.customer_portal_invitations '+
    'WHERE token_digest=$1 AND consumed_at IS NULL AND expires_at>now() LIMIT 1',
    [hash(raw)]
  );
  if(!rows.length)return response({ok:false,message:'Convite inválido ou expirado.'},410);
  const customer=verifiedClient(await allClients(),rows[0].customer_id,rows[0].email);
  if(!customer)return response({ok:false,message:'Cadastro alterado. Solicite outro convite.'},409);
  return response({ok:true,customer_name:clientName(customer),email_hint:
    rows[0].email.replace(/^(.{1,2}).*(@.*)$/,'$1***$2'),expires_in_hours_max:48});
};
const activate=async(raw,password)=>{
  if(!tokenValid(raw)||!passwordValid(password))
    return response({ok:false,message:'Convite inválido ou senha fora de 12 a 72 caracteres.'},400);
  const db=await checkoutDb().connect();let customerId;
  try{
    await db.query('BEGIN');
    const {rows}=await db.query(
      'SELECT customer_id,email FROM everclean_private.customer_portal_invitations '+
      'WHERE token_digest=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',
      [hash(raw)]
    );
    if(rows.length!==1)throw fail('Convite inválido, já usado ou expirado.',410);
    const client=verifiedClient(await allClients(),rows[0].customer_id,rows[0].email);
    if(!client)throw fail('Cadastro atualizado. Solicite novo convite.',409);
    customerId=String(rows[0].customer_id);
    const pw=passwordHash(password);
    await db.query(
      'INSERT INTO everclean_private.customer_portal_accounts '+
      '(customer_id,email,password_hash,status,updated_at) '+
      "VALUES ($1,$2,$3,'active',now()) ON CONFLICT(customer_id) DO UPDATE SET "+
      "email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,status='active',"+
      'failed_attempts=0,locked_until=NULL,updated_at=now()',
      [customerId,rows[0].email,pw]
    );
    await db.query('DELETE FROM everclean_private.customer_portal_sessions WHERE customer_id=$1',
      [customerId]);
    const done=await db.query(
      'UPDATE everclean_private.customer_portal_invitations SET consumed_at=now() '+
      'WHERE token_digest=$1 AND consumed_at IS NULL RETURNING token_digest',[hash(raw)]
    );
    if(done.rowCount!==1)throw fail('Convite já utilizado.',409);
    await db.query('COMMIT');
  }catch(error){
    await db.query('ROLLBACK').catch(()=>{});throw error;
  }finally{db.release();}
  const token=await newSession(customerId);
  return response({ok:true,message:'Conta ativada. Acesse seu portal Ever Clean.'},200,
    {'Set-Cookie':setCookie(token)});
};
const login=async(email,password)=>{
  const username=mail(email);
  if(!validEmail(username)||typeof password!=='string'||password.length>72)
    return response({ok:false,message:'E-mail ou senha incorretos.'},401);
  const {rows}=await checkoutDb().query(
    'SELECT customer_id,email,password_hash,status,failed_attempts,locked_until '+
    'FROM everclean_private.customer_portal_accounts WHERE lower(email)=$1 LIMIT 2',
    [username]
  );
  if(rows.length!==1)return response({ok:false,message:'E-mail ou senha incorretos.'},401);
  const account=rows[0];
  if(account.status!=='active'||account.locked_until&&
     Date.parse(account.locked_until)>Date.now())
    return response({ok:false,message:'Acesso temporariamente indisponível. Verifique com a Ever Clean.'},403);
  const clients=await allClients();
  const customer=verifiedClient(clients,account.customer_id,username);
  if(!customer)return response({ok:false,message:'Cadastro indisponível. Consulte a Ever Clean.'},403);
  if(!passwordMatches(password,account.password_hash)){
    await checkoutDb().query(
      'UPDATE everclean_private.customer_portal_accounts '+
      "SET failed_attempts=LEAST(failed_attempts+1,10),"+
      "locked_until=CASE WHEN failed_attempts>=4 THEN now()+interval '15 minutes' ELSE NULL END,"+
      'updated_at=now() WHERE customer_id=$1',[String(account.customer_id)]
    );
    return response({ok:false,message:'E-mail ou senha incorretos.'},401);
  }
  await checkoutDb().query(
    'UPDATE everclean_private.customer_portal_accounts '+
    'SET failed_attempts=0,locked_until=NULL,updated_at=now() WHERE customer_id=$1',
    [String(account.customer_id)]
  );
  const token=await newSession(account.customer_id);
  return response({ok:true,customer_name:clientName(customer)},200,
    {'Set-Cookie':setCookie(token)});
};
const portalHome=async(identity)=>{
  const {customer,id}=identity;
  const [ordersData,products]=await Promise.all([
    checkoutDb().query(
      'SELECT o.request_number,o.state,o.payment_state,o.amount_cents,o.items,'+
      'o.requires_stock_review,o.created_at,o.paid_at,i.state AS export_state,'+
      'i.bling_order_id,i.origin_reference '+
      'FROM everclean_private.checkout_orders o '+
      'LEFT JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id '+
      'WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 60',[id]
    ),
    getJson('data/products',[])
  ]);
  const catalog=generalProductionCatalog({
    customer,products:Array.isArray(products)?products:[],
    link:{status:'prepared',payment_authorized:false,request_number:'RASCUNHO',
      expires_at:new Date(Date.now()+3600000).toISOString()}
  });
  const orders=ordersData.rows.map(o=>{
    const isPaid=o.state==='paid'&&
      ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(o.payment_state)&&Boolean(o.paid_at);
    const bling=isPaid&&['sent','already_exists'].includes(o.export_state)&&
      /^\d{1,20}$/.test(String(o.bling_order_id||''))&&
      o.origin_reference==='EC-PROD-'+String(o.request_number);
    return {request_number:String(o.request_number),status:String(o.state),
      amount:Number(o.amount_cents)/100,created_at:o.created_at,
      stock_review:o.requires_stock_review===true,bling_registered:bling,
      item_count:Array.isArray(o.items)?o.items.length:0,
      items:(Array.isArray(o.items)?o.items:[]).slice(0,50).map(item=>({
        sku:clean(item.product_sku||item.sku).slice(0,50),
        name:clean(item.product_name||'Produto').slice(0,150),
        quantity:Number(item.quantity)||0,unit_price_cents:Number(item.unit_price_cents)||0
      }))
    };
  });
  // Os mesmos campos visuais usados no catálogo por link. Não expõe custos,
  // estoque interno, credenciais nem dados comerciais de outros clientes.
  const originalProducts=new Map(
    (Array.isArray(products)?products:[]).map(p=>[String(p.id),p])
  );
  const safeImage=value=>{
    const url=clean(value);
    if(url.length>350000)return null;
    if(/^https:\/\/[^\s]+$/i.test(url))return url;
    if(/^\/(?!\/)[a-zA-Z0-9_./?&=%#-]+$/.test(url))return url;
    if(/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/i.test(url))return url;
    return null;
  };
  const displayProducts=catalog.products.map(p=>{
    const original=originalProducts.get(String(p.id))||{};
    return {...p,
      brand:clean(original.brand||'').slice(0,60),
      image_url:safeImage(original.image_url)||null,
      sales_orders_count:Math.max(0,Number(original.sales_orders_count)||0)
    };
  });
  return response({ok:true,read_only:true,checkout_enabled:false,customer:{
    name:clientName(customer),email:clientEmail(customer)},
    orders,products:displayProducts,max_items:catalog.max_items,
    message:'Acesso permanente do cliente. Orçamentos e pagamentos ainda não habilitados neste portal.'});
};
export default async function handler(request,context){
  if(request.method!=='POST')return response({ok:false,message:'Método não permitido.'},405);
  if(Number(request.headers.get('content-length')||0)>16*1024)
    return response({ok:false,message:'Requisição acima do limite.'},413);
  const origin=request.headers.get('origin');
  if(origin!==new URL(request.url).origin)
    return response({ok:false,message:'Origem não permitida.'},403);
  const input=await request.json().catch(()=>null),action=String(input?.action||'');
  try{
    if(action.startsWith('admin_')){
      const access=await requireSecureAdmin(request,legacy,context);
      if(!access.ok)return access.response;
      if(action==='admin_clients')return response({ok:true,clients:await adminClients()});
      if(action==='admin_invite')return await adminInvite(input);
      if(action==='admin_disable')return await adminDisable(input);
      return response({ok:false,message:'Ação administrativa inválida.'},403);
    }
    if(action==='invite_check')return await checkInvitation(clean(input?.token));
    if(action==='activate')return await activate(clean(input?.token),input?.password);
    if(action==='login')return await login(input?.email,input?.password);
    if(action==='link_exchange')return await exchangeOrderLink(input?.kind,input?.token);
    if(action==='logout'){
      const raw=parseCookie(request);
      if(raw)await checkoutDb().query(
        'DELETE FROM everclean_private.customer_portal_sessions WHERE token_digest=$1',[hash(raw)]
      );
      return response({ok:true},200,{'Set-Cookie':clearCookie()});
    }
    if(action==='session'||action==='home'){
      const identity=await session(request);
      if(!identity)return response({ok:false,message:'Entre na sua conta para continuar.'},401,
        {'Set-Cookie':clearCookie()});
      if(action==='session')return response({ok:true,customer_name:clientName(identity.customer)});
      return await portalHome(identity);
    }
    return response({ok:false,message:'Ação não autorizada.'},403);
  }catch(error){
    console.warn('Ever Clean portal:',String(error?.message||'Erro').slice(0,85));
    const status=Number(error?.status);
    return response({ok:false,message:
      status>=400&&status<500?String(error.message).slice(0,150):
      'Operação do portal indisponível. Nenhum pedido ou cobrança foi criado.'},
      status>=400&&status<500?status:503);
  }
}
