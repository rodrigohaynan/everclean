import crypto from 'node:crypto';
import legacy from '../shared/admin-api/index.mjs';
import {getJson,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {generalProductionCatalog,generalProductionQuote,generalPublicRelease,generalPaymentEnabled} from '../shared/everclean-general-production-checkout.mjs';
import {readProducts,readClients} from '../shared/catalog-store.mjs';
import {requestReusable} from '../shared/portal-requests.mjs';
import {fulfillmentEventsFor,normalizeStage} from '../shared/fulfillment.mjs';
import {invoicesFor,publicInvoice,invoiceDocument} from '../shared/invoices.mjs';
import {blingAccessToken} from '../shared/everclean-bling.mjs';

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
  const rows=await readClients();
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
// Solicitação comercial recebida pelo portal: NÃO é venda no Bling nem cobrança no Asaas.
// Cliente autenticado, preços recalculados no servidor e chave para prevenir duplicidades.
const requestSummary=row=>({
  id:String(row.id),
  request_number:String(row.request_number),
  status:String(row.status),
  approval_source:row.approval_source==='automatic_stock'?'automatic_stock':'manual',
  amount:Number(row.amount_cents)/100,
  created_at:row.created_at,
  requires_stock_review:row.requires_stock_review===true,
  items:(Array.isArray(row.items)?row.items:[]).map(item=>({
    product_id:String(item.product_id),
    sku:clean(item.sku),name:clean(item.name),
    quantity:Number(item.quantity),
    unit_price_cents:Number(item.unit_price_cents)
  })),
  notes:clean(row.notes),invoice_requested:row.invoice_requested===true,
  invoice_channel:row.invoice_channel||null,
  review_note:clean(row.review_note||'').slice(0,240),
  reviewed_at:row.reviewed_at||null
});
// Consulta SOMENTE DE LEITURA: verifica preços e estoque real de cada quantidade.
const portalCartReadiness=async(identity,input)=>{
  const lines=input?.items;
  if(!Array.isArray(lines)||!lines.length||lines.length>50)
    throw fail('Selecione entre 1 e 50 produtos diferentes.',400);
  const products=await readProducts();
  if(!Array.isArray(products))throw fail('Catálogo indisponível.',503);
  const quote=generalProductionQuote({
    customer:identity.customer,products,
    link:{request_number:'CONSULTA'}
  },lines);
  const release=generalPublicRelease();
  const cents=Math.round(Number(quote.amount)*100);
  const ready=!quote.requires_stock_review&&release.enabled&&
    cents>=500&&cents<=release.max_cents;
  return response({ok:true,amount:quote.amount,
    order_minimum_amount:5,
    meets_order_minimum:cents>=500,
    missing_for_minimum:Math.max(0,500-cents)/100,
    requires_stock_review:quote.requires_stock_review,
    ready_for_payment:ready,
    payment_method:'PIX',
    message:ready?'Produtos disponíveis: escolha PIX sem análise prévia.':
      cents<500?'Pedido mínimo R$ 5,00. Adicione mais produtos para finalizar.':
      quote.requires_stock_review?
        'Quantidade insuficiente de pelo menos um item: análise comercial necessária.':
        'Checkout real indisponível ou acima do limite: consulte a equipe.'});
};
const submitPortalRequest=async(identity,input)=>{
  const key=String(input?.idempotency_key||'').toLowerCase();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key))
    throw fail('Identificador da solicitação inválido. Atualize a página.',400);
  const lines=input?.items;
  if(!Array.isArray(lines)||!lines.length||lines.length>50)
    throw fail('Selecione entre 1 e 50 produtos.',400);
  const notes=clean(input?.notes).slice(0,1500);
  if(clean(input?.notes).length>1500)throw fail('Observações acima do limite.',400);
  const invoiceRequested=input?.invoice_requested===true;
  const invoiceChannel=invoiceRequested?clean(input?.invoice_channel):null;
  const invoiceContact=invoiceRequested?clean(input?.invoice_contact):null;
  if(invoiceRequested&&(
    !['email','whatsapp'].includes(invoiceChannel)||
    invoiceContact.length>200||invoiceContact.length<5||
    (invoiceChannel==='email'&&!validEmail(invoiceContact))||
    (invoiceChannel==='whatsapp'&&!/^\+?[0-9()\s-]{10,25}$/.test(invoiceContact))
  ))throw fail('Informe um contato válido para a nota fiscal.',400);

  // Revalida produtos, preços, quantidades e política de encomenda no servidor.
  const allProducts=await readProducts();
  const rawProducts=Array.isArray(allProducts)?allProducts:[];
  const catalog=generalProductionCatalog({
    customer:identity.customer,products:rawProducts,
    link:{status:'prepared',payment_authorized:false}
  });
  const catalogById=new Map(catalog.products.map(p=>[String(p.id),p]));
  const rawById=new Map(rawProducts.map(p=>[String(p.id),p]));
  const seen=new Set();let amountCents=0,stockReview=false;
  const items=lines.map(line=>{
    const id=clean(line?.product_id),qty=Number(line?.quantity);
    if(!id||id.length>150||seen.has(id)||!Number.isSafeInteger(qty)||
      qty<1||qty>10000)throw fail('Produtos repetidos ou quantidades inválidas.',400);
    seen.add(id);
    const product=catalogById.get(id),raw=rawById.get(id);
    if(!product||!raw||product.can_order===false)
      throw fail('Um produto não está disponível no catálogo atual.',409);
    const stock=Number(raw.stock_quantity||0);
    if(stock<qty&&raw.catalog_allow_backorder===false)
      throw fail('Produto sem estoque suficiente e sem encomenda habilitada.',409);
    const unit=Math.round(Number(product.price)*100);
    const subtotal=unit*qty;
    if(!Number.isSafeInteger(unit)||unit<1||!Number.isSafeInteger(subtotal)||
      subtotal<1)throw fail('Preço não disponível para um produto.',409);
    amountCents+=subtotal;
    if(stock<qty)stockReview=true;
    return {product_id:id,sku:clean(product.sku).slice(0,50),
      name:clean(product.name).slice(0,150),quantity:qty,
      unit_price_cents:unit,subtotal_cents:subtotal,
      fulfillment_status:stock<qty?'sob_encomenda':'pronta_entrega'};
  }).sort((a,b)=>a.product_id.localeCompare(b.product_id));
  if(!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>100000000)
    throw fail('Valor total fora do limite permitido.',400);
  if(amountCents<500)
    throw fail('Pedido mínimo R$ 5,00. Adicione mais produtos para continuar.',400);
  const release=generalPublicRelease();
  const document=String(identity.customer.document||identity.customer.cpf_cnpj||'').replace(/\D/g,'');
  const instantApproved=!stockReview&&release.enabled&&
    amountCents<=release.max_cents&&[11,14].includes(document.length);
  const fingerprint=hash(JSON.stringify({
    customer_id:identity.id,items,notes,invoiceRequested,invoiceChannel,invoiceContact
  }));
  const pool=checkoutDb();
  const existing=await pool.query(
    'SELECT * FROM everclean_private.customer_portal_order_requests '+
    'WHERE customer_id=$1 AND idempotency_key=$2 LIMIT 1',[identity.id,key]);
  if(existing.rows.length){
    if(String(existing.rows[0].request_hash).trim()!==fingerprint)
      throw fail('Essa solicitação já foi utilizada para outro carrinho. Atualize a página.',409);
    return response({ok:true,created:false,request:requestSummary(existing.rows[0]),
      message:'Solicitação já recebida. Nenhum pedido duplicado foi criado.'});
  }
  const {rows:recent}=await pool.query(
    'SELECT count(*)::int AS count FROM everclean_private.customer_portal_order_requests '+
    "WHERE customer_id=$1 AND created_at>now()-interval '1 hour'",[identity.id]);
  if(Number(recent[0]?.count||0)>=15)
    throw fail('Limite de solicitações atingido. Entre em contato com a Ever Clean.',429);
  const id=crypto.randomUUID();
  const inserted=await pool.query(
    'INSERT INTO everclean_private.customer_portal_order_requests '+
    '(id,customer_id,customer_name,idempotency_key,request_hash,amount_cents,'+
    'items,requires_stock_review,notes,invoice_requested,invoice_channel,invoice_contact,'+
    'status,approval_source,reviewed_at,review_note) '+
    "VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14::text,"+
    "CASE WHEN $14::text='automatic_stock' THEN now() ELSE NULL END,$15) "+
    'ON CONFLICT(customer_id,idempotency_key) DO NOTHING RETURNING *',
    [id,identity.id,clientName(identity.customer),key,fingerprint,amountCents,
      JSON.stringify(items),stockReview,notes,invoiceRequested,
      invoiceChannel,invoiceContact,
      instantApproved?'quoted':'received',
      instantApproved?'automatic_stock':'manual',
      instantApproved?'Quantidade disponível em estoque. Pagamento liberado automaticamente.':'']
  );
  const recorded=inserted.rows[0]||(await pool.query(
    'SELECT * FROM everclean_private.customer_portal_order_requests '+
    'WHERE customer_id=$1 AND idempotency_key=$2 LIMIT 1',
    [identity.id,key])).rows[0];
  if(!recorded)throw fail('Solicitação inconclusiva. Consulte o histórico antes de reenviar.',503);
  if(String(recorded.request_hash).trim()!==fingerprint)
    throw fail('Não foi possível confirmar a solicitação sem duplicidade.',409);
  return response({ok:true,created:Boolean(inserted.rows.length),
    request:requestSummary(recorded),ready_for_payment:recorded.status==='quoted',
    message:recorded.status==='quoted'?
      'Estoque confirmado: escolha o PIX. Nenhuma cobrança foi gerada.':
      'Solicitação recebida para análise da equipe. Nenhuma cobrança foi gerada.'},
    inserted.rows.length?201:200);
};
// Aprovação apenas comercial. Jamais cria PIX, pedido no Bling, estoque ou NF-e.
// A aprovação comercial pode ser convertida em um link individual PIX.
// Ação sem custo: NÃO chama Asaas e NÃO cria cobrança, venda, estoque ou NF-e.
// O link tem carrinho/valor imutáveis; nova cobrança só após confirmação no checkout.
const prepareApprovedPayment=async(identity,input)=>{
  const id=String(input?.request_id||'').toLowerCase();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
    throw fail('Solicitação inválida.',400);
  const release=generalPublicRelease();
  if(!release.enabled)
    throw fail('Checkout de produção temporariamente indisponível. Nenhum pagamento foi gerado.',503);
  const db=checkoutDb();
  const preview=await db.query(
    'SELECT id,request_number,status,customer_id,amount_cents,items,reviewed_at,approval_source '+
    'FROM everclean_private.customer_portal_order_requests WHERE id=$1 AND customer_id=$2',
    [id,identity.id]
  );
  const request=preview.rows[0];
  if(!request)throw fail('Solicitação não encontrada para este cliente.',404);
  if(request.status!=='quoted'||!request.reviewed_at)
    throw fail('Esta solicitação ainda não foi aprovada pela equipe.',409);
  const amount=Number(request.amount_cents),original=Array.isArray(request.items)?request.items:[];
  if(!original.length||original.length>50||!Number.isSafeInteger(amount)||
    amount<1||amount>release.max_cents)
    throw fail('Valor fora do limite ou solicitação inválida. Consulte a Ever Clean.',409);
  // Reabrir um checkout existente é somente leitura; inclusive quando
  // o PIX já foi emitido e a autorização de uso único foi consumida.
  const prior=await db.query(
    'SELECT token,token_digest,request_number,customer_id,status,expires_at,'+
    'payment_authorized,payment_authorized_at,payment_max_cents,'+
    'payment_approved_items,created_at '+
    'FROM everclean_private.production_catalog_links '+
    'WHERE source_request_id=$1 LIMIT 2',[id]
  );
  if(prior.rows.length>1)throw fail('Vários links para esta solicitação. Consulte o atendimento.',409);
  if(prior.rows.length===1){
    const link=prior.rows[0];
    if(String(link.customer_id)!==identity.id)
      throw fail('Link não pertence a este cliente.',403);
    if(link.status!=='prepared'||Date.parse(link.expires_at)<=Date.now())
      throw fail('Link expirado ou encerrado. Consulte a Ever Clean.',410);
    const {rows:existingOrder}=await db.query(
      'SELECT id,state FROM everclean_private.checkout_orders WHERE link_digest=$1 LIMIT 2',
      [link.token_digest]
    );
    if(existingOrder.length>1||(!generalPaymentEnabled({link})&&existingOrder.length!==1))
      throw fail('Link bloqueado para nova cobrança. Consulte a Ever Clean.',409);
    return response({ok:true,request_number:String(request.request_number||''),
      checkout_number:String(link.request_number),
      payment_method:'PIX',already_prepared:true,
      url:URL_BASE+'/pedido-producao/'+encodeURIComponent(link.token),
      message:'Checkout existente recuperado, sem criar nova cobrança.'});
  }
  const products=await readProducts();
  if(!Array.isArray(products))throw fail('Catálogo indisponível.',503);
  let quote;
  try{
    quote=generalProductionQuote(
      {customer:identity.customer,products,link:{request_number:'APROVADA'}},
      original.map(item=>({product_id:String(item.product_id),quantity:Number(item.quantity)}))
    );
  }catch{
    throw fail('Produto ou estoque mudou desde a aprovação. Solicite revisão da equipe.',409);
  }
  if(request.approval_source==='automatic_stock'&&quote.requires_stock_review)
    throw fail('O estoque mudou desde a liberação automática. Solicite análise da equipe antes de pagar.',409);
  const approved=new Map(original.map(item=>[String(item.sku),item]));
  if(approved.size!==original.length||
    Math.round(Number(quote.amount)*100)!==amount||
    quote.items.length!==original.length||
    quote.items.some(item=>{
      const before=approved.get(String(item.product_sku));
      return !before||
        String(item.product_id)!==String(before.product_id)||
        Number(item.quantity)!==Number(before.quantity)||
        Number(item.unit_price_cents)!==Number(before.unit_price_cents);
    }))
    throw fail('Os produtos ou valores mudaram após a aprovação. Solicite nova conferência.',409);
  const approvedItems=quote.items.map(item=>({
    sku:String(item.product_sku),quantity:Number(item.quantity),
    unit_price_cents:Number(item.unit_price_cents)
  }));
  const tx=await db.connect();
  let begun=false;
  try{
    await tx.query('BEGIN');begun=true;
    const current=await tx.query(
      'SELECT id,status,customer_id,amount_cents,request_number,reviewed_at,approval_source '+
      'FROM everclean_private.customer_portal_order_requests '+
      'WHERE id=$1 AND customer_id=$2 FOR UPDATE',[id,identity.id]
    );
    const locked=current.rows[0];
    if(!locked||locked.status!=='quoted'||!locked.reviewed_at||
       Number(locked.amount_cents)!==amount||
       String(locked.approval_source)!==String(request.approval_source))
      throw fail('A aprovação foi alterada. Atualize a página.',409);
    const existing=await tx.query(
      'SELECT token,token_digest,request_number,customer_id,status,expires_at,'+
      'payment_authorized,payment_authorized_at,payment_max_cents,'+
      'payment_approved_items,created_at '+
      'FROM everclean_private.production_catalog_links '+
      'WHERE source_request_id=$1 FOR UPDATE',[id]
    );
    let link=existing.rows[0];
    if(!link){
      // A numeração é comum aos outros links de produção, protegida por UNIQUE.
      // Não altera links antigos nem tenta criar uma cobrança financeira.
      for(let attempt=0;attempt<4;attempt++){
        const token=crypto.randomBytes(32).toString('hex');
        const digest=hash(token);
        const inserted=await tx.query(
          'INSERT INTO everclean_private.production_catalog_links '+
          '(id,token_digest,token,request_number,customer_id,customer_name,'+
          'expires_at,payment_authorized,payment_authorized_at,payment_max_cents,'+
          'payment_approved_items,source_request_id) '+
          'SELECT $1,$2,$3,CAST(COALESCE(MAX(request_number::bigint),999999999)+1 AS varchar),'+
          "$4,$5,now()+interval '7 days',true,now(),$6,$7::jsonb,$8 "+
          'FROM everclean_private.production_catalog_links WHERE true '+
          'ON CONFLICT DO NOTHING RETURNING *',
          [crypto.randomUUID(),digest,token,identity.id,
            clientName(identity.customer),amount,JSON.stringify(approvedItems),id]
        );
        link=inserted.rows[0];
        if(link)break;
      }
      if(!link)throw fail('Não foi possível reservar o link. Atualize e tente novamente.',409);
    }
    if(link.status!=='prepared'||Date.parse(link.expires_at)<=Date.now())
      throw fail('O link aprovado expirou ou foi encerrado. Solicite novo atendimento.',410);
    const belongs=String(link.customer_id)===identity.id;
    if(!belongs)throw fail('Vínculo do cliente inválido.',403);
    if(!generalPaymentEnabled({link})){
      const currentOrder=await tx.query(
        'SELECT id FROM everclean_private.checkout_orders WHERE link_digest=$1 LIMIT 2',
        [link.token_digest]
      );
      if(currentOrder.rows.length!==1)
        throw fail('A autorização financeira do pedido não está ativa.',409);
    }
    const approvedCurrent=Array.isArray(link.payment_approved_items)?
      link.payment_approved_items:[];
    if(Number(link.payment_max_cents)!==amount||
      approvedCurrent.length!==approvedItems.length||
      !approvedItems.every(item=>approvedCurrent.some(x=>
        String(x.sku)===item.sku&&Number(x.quantity)===item.quantity&&
        Number(x.unit_price_cents)===item.unit_price_cents)))
      throw fail('O vínculo de pagamento não corresponde à aprovação.',409);
    await tx.query('COMMIT');begun=false;
    return response({ok:true,request_number:String(locked.request_number),
      checkout_number:String(link.request_number),
      payment_method:'PIX',
      url:URL_BASE+'/pedido-producao/'+encodeURIComponent(link.token),
      message:'Checkout PIX preparado. Nenhuma cobrança foi criada. Confirme no checkout se desejar pagar.'});
  }catch(error){
    if(begun)await tx.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{tx.release();}
};
const adminReviewRequest=async(input)=>{
  const id=String(input?.id||'').toLowerCase();
  const next=String(input?.status||'');
  const expected=String(input?.expected_status||'');
  const note=String(input?.review_note||'').trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)||
    !['in_review','quoted','rejected'].includes(next)||
    !['received','in_review'].includes(expected)||
    note.length>240)
    return response({ok:false,message:'Revisão inválida.'},400);
  if(next==='rejected'&&note.length<5)
    return response({ok:false,message:'Informe o motivo da recusa (mínimo 5 caracteres).'},400);
  if(next==='quoted'&&(
    input?.stock_checked!==true||input?.prices_checked!==true||
    input?.approve_confirm!==true))
    return response({ok:false,
      message:'Confirme a disponibilidade, o valor e a aprovação comercial.'},403);
  if(next===expected||!((expected==='received'&&
      ['in_review','quoted','rejected'].includes(next))||
      (expected==='in_review'&&['quoted','rejected'].includes(next))))
    return response({ok:false,message:'Transição não permitida.'},409);
  const {rows}=await checkoutDb().query(
    'UPDATE everclean_private.customer_portal_order_requests '+
    'SET status=$3,review_note=$4,reviewed_at=now(),updated_at=now() '+
    "WHERE id=$1 AND status=$2 AND status IN ('received','in_review') RETURNING "+
    'id,request_number,customer_id,customer_name,status,amount_cents,items,'+
    'requires_stock_review,notes,invoice_requested,invoice_channel,'+
    'review_note,reviewed_at,created_at',
    [id,expected,next,note]
  );
  if(rows.length!==1)return response({ok:false,
    message:'A solicitação já foi alterada por outra sessão. Atualize a lista.'},409);
  return response({ok:true,request:requestSummary(rows[0]),
    message:next==='quoted'?
      'Solicitação aprovada comercialmente. Nenhuma cobrança ou venda foi gerada.':
      next==='rejected'?'Solicitação recusada. Nenhuma cobrança foi gerada.':
      'Solicitação em análise, sem geração de cobrança.'});
};
const adminPortalRequests=async()=>{
  const {rows}=await checkoutDb().query(
    'SELECT r.id,r.request_number,r.customer_id,r.customer_name,r.status,r.amount_cents,r.items,'+
    'r.requires_stock_review,r.notes,r.invoice_requested,r.invoice_channel,r.invoice_contact,'+
    'r.review_note,r.reviewed_at,r.approval_source,r.created_at,'+
    'l.request_number AS checkout_number,o.state AS checkout_payment_state,'+
    'o.payment_state AS checkout_asaas_status,o.paid_at AS checkout_paid_at,'+
    'i.state AS checkout_bling_state,i.bling_order_id AS checkout_bling_id,'+
    'i.origin_reference AS checkout_bling_reference '+
    'FROM everclean_private.customer_portal_order_requests r '+
    'LEFT JOIN everclean_private.production_catalog_links l ON l.source_request_id=r.id '+
    'LEFT JOIN everclean_private.checkout_orders o ON o.link_digest=l.token_digest '+
    'LEFT JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id '+
    'ORDER BY r.created_at DESC LIMIT 200'
  );
  return response({ok:true,requests:rows.map(row=>({
    ...requestSummary(row),customer_name:clean(row.customer_name).slice(0,160),
    customer_id:String(row.customer_id),
    invoice_contact:row.invoice_requested?clean(row.invoice_contact):null,
    checkout_number:row.checkout_number||null,
    checkout_paid:row.checkout_payment_state==='paid'&&
      ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(row.checkout_asaas_status)&&
      Boolean(row.checkout_paid_at),
    checkout_bling_registered:row.checkout_payment_state==='paid'&&
      ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(row.checkout_asaas_status)&&
      Boolean(row.checkout_paid_at)&&
      ['sent','already_exists'].includes(row.checkout_bling_state)&&
      /^[0-9]{1,20}$/.test(String(row.checkout_bling_id||''))&&
      row.checkout_bling_reference==='EC-PROD-'+String(row.checkout_number)
  }))});
};
// Arquivo histórico: vínculos Sandbox ficam em Netlify Blobs, não no Neon.
// Consultar somente o customer_id autenticado pelo cookie HttpOnly do portal.
// Nenhum token de link, código PIX, dado bancário ou identificador Asaas é exposto.
function archivedSandboxOrders(customerId,rawLinks,rawOrders){
  const id=String(customerId);
  const links=Array.isArray(rawLinks)?rawLinks:[];
  const records=Array.isArray(rawOrders)?rawOrders:[];
  const normalized=n=>/^\d{1,6}$/.test(String(n??'').trim())?
    String(Number(n)).padStart(6,'0'):null;
  const knownOrders=new Map();
  for(const row of records){
    if(!row||String(row.customer_id)!==id)continue;
    const number=normalized(row.request_number);
    if(!number||knownOrders.has(number))continue;
    knownOrders.set(number,row);
  }
  const archived=new Map();
  for(const link of links){
    if(!link||String(link.customer_id)!==id||
      link.checkout_mode==='production')continue;
    const number=normalized(link.request_number);
    if(!number||archived.has(number))continue;
    const row=knownOrders.get(number)||null;
    const date=String(link.submitted_at||row?.created_at||link.created_at||'');
    const amount=Number(link.known_total||row?.total_amount||0);
    const state=String(link.payment_status||row?.payment_status||'').toLowerCase();
    const linkState=String(link.status||'').toLowerCase();
    const paid=state==='pago'||row?.status==='pago';
    const paymentInitiated=Boolean(link.asaas_reference||row?.asaas_reference);
    const status=paid?'simulated_paid':
      linkState==='cancelado'?'canceled':
      linkState==='expirado'?'expired':
      paymentInitiated?'payment_pending':'draft';
    const source=Array.isArray(row?.items)?row.items:[];
    archived.set(number,{
      request_number:number,origin:'sandbox',status,
      amount:Number.isFinite(amount)&&amount>=0?amount:0,
      created_at:Number.isFinite(Date.parse(date))?date:link.created_at||null,
      item_count:source.length,
      items:source.slice(0,50).map(item=>{
        const quantity=Number(item?.quantity)||0;
        const rawPrice=Number(item?.unit_price_cents);
        const price=Number.isFinite(rawPrice)&&rawPrice>0?rawPrice:
          Math.round(Number(item?.unit_price_snapshot||0)*100);
        return {
          sku:clean(item?.product_sku||item?.sku||'').slice(0,50),
          name:clean(item?.product_name||item?.name||'Produto').slice(0,150),
          quantity:Number.isSafeInteger(quantity)&&quantity>0?quantity:0,
          unit_price_cents:Number.isSafeInteger(price)&&price>=0?price:0
        };
      }).filter(item=>item.quantity>0)
    });
  }
  // Pedidos antigos podem ter perdido o link, mas ainda ter o registro local.
  // Incluir apenas registros do próprio cadastro que tenham uma origem Sandbox.
  for(const [number,row] of knownOrders){
    if(archived.has(number)||
       !String(row.source||'').toLowerCase().includes('sandbox'))continue;
    const amount=Number(row.total_amount||0);
    archived.set(number,{
      request_number:number,origin:'sandbox',status:
        row.payment_status==='pago'||row.status==='pago'?'simulated_paid':'payment_pending',
      amount:Number.isFinite(amount)&&amount>=0?amount:0,
      created_at:row.created_at||null,
      item_count:0,items:[]
    });
  }
  return [...archived.values()]
    .sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0))
    .slice(0,60);
}

function orderPageUrl(o,isPaid){
  const token=String(o.link_token||'');
  if(!/^[a-f0-9]{64}$/.test(token)||o.link_status!=='prepared')return null;
  if(isPaid)return '/pedido-producao/'+token;
  const pending=['payment_pending','pix_pending'].includes(String(o.state||''));
  return pending&&Date.parse(o.link_expires_at)>Date.now()?'/pedido-producao/'+token:null;
}

const portalHome=async(identity)=>{
  const {customer,id}=identity;
  const [ordersData,products,requestsData]=await Promise.all([
    checkoutDb().query(
      'SELECT o.id::text AS id,o.request_number,o.state,o.payment_state,o.amount_cents,o.items,'+
      'o.requires_stock_review,o.created_at,o.paid_at,i.state AS export_state,'+
      'i.bling_order_id,i.origin_reference,f.stage AS fulfillment_stage,'+
      'f.public_note AS fulfillment_note,f.updated_at AS fulfillment_updated_at,'+
      'l.token AS link_token,l.status AS link_status,l.expires_at AS link_expires_at '+
      'FROM everclean_private.checkout_orders o '+
      'LEFT JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id '+
      'LEFT JOIN everclean_private.order_fulfillment f ON f.checkout_order_id=o.id '+
      'LEFT JOIN everclean_private.production_catalog_links l '+
      'ON l.token_digest=o.link_digest AND l.customer_id=o.customer_id '+
      'WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 60',[id]
    ),
    readProducts(),
    checkoutDb().query(
      'SELECT r.id,r.request_number,r.status,r.amount_cents,r.items,r.requires_stock_review,'+
      'r.notes,r.invoice_requested,r.invoice_channel,r.review_note,r.reviewed_at,'+
      'r.approval_source,r.created_at,'+
      'l.request_number AS checkout_number,l.status AS checkout_link_status,'+
      'l.expires_at AS checkout_link_expires_at,'+
      'o.state AS checkout_payment_state,o.payment_state AS checkout_asaas_status,'+
      'o.paid_at AS checkout_paid_at,'+
      'i.state AS checkout_bling_state,i.bling_order_id AS checkout_bling_id,'+
      'i.origin_reference AS checkout_bling_reference '+
      'FROM everclean_private.customer_portal_order_requests r '+
      'LEFT JOIN everclean_private.production_catalog_links l ON l.source_request_id=r.id '+
      'LEFT JOIN everclean_private.checkout_orders o ON o.link_digest=l.token_digest '+
      'LEFT JOIN everclean_private.bling_export_intents i ON i.checkout_order_id=o.id '+
      'WHERE r.customer_id=$1 ORDER BY r.created_at DESC LIMIT 60',[id]
    )
  ]);
  const catalog=generalProductionCatalog({
    customer,products:Array.isArray(products)?products:[],
    link:{status:'prepared',payment_authorized:false,request_number:'RASCUNHO',
      expires_at:new Date(Date.now()+3600000).toISOString()}
  });
  const paidIds=ordersData.rows.filter(o=>o.state==='paid'&&o.paid_at).map(o=>o.id);
  const eventsByOrder=await fulfillmentEventsFor(checkoutDb(),paidIds,20);
  const invoicesByOrder=await invoicesFor(checkoutDb(),paidIds);
  const orders=ordersData.rows.map(o=>{
    const isPaid=o.state==='paid'&&
      ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(o.payment_state)&&Boolean(o.paid_at);
    const bling=isPaid&&['sent','already_exists'].includes(o.export_state)&&
      /^\d{1,20}$/.test(String(o.bling_order_id||''))&&
      o.origin_reference==='EC-PROD-'+String(o.request_number);
    return {request_number:String(o.request_number),status:String(o.state),
      amount:Number(o.amount_cents)/100,created_at:o.created_at,
      stock_review:o.requires_stock_review===true,bling_registered:bling,
      fulfillment_stage:isPaid?normalizeStage(o.fulfillment_stage):null,
      fulfillment_note:isPaid?clean(o.fulfillment_note||'').slice(0,240):'',
      fulfillment_updated_at:isPaid?(o.fulfillment_updated_at||null):null,
      fulfillment_events:isPaid?(eventsByOrder.get(o.id)||[]):[],
      invoice:isPaid?publicInvoice(invoicesByOrder.get(o.id)):null,
      // Página do pedido (do próprio cliente): pago abre sempre para consulta;
      // pagamento pendente só enquanto o link estiver válido.
      order_url:orderPageUrl(o,isPaid),
      item_count:Array.isArray(o.items)?o.items.length:0,
      items:(Array.isArray(o.items)?o.items:[]).slice(0,50).map(item=>({
        sku:clean(item.product_sku||item.sku).slice(0,50),
        name:clean(item.product_name||'Produto').slice(0,150),
        quantity:Number(item.quantity)||0,unit_price_cents:Number(item.unit_price_cents)||0
      }))
    };
  });
  // Histórico dos pedidos de teste do MESMO cliente, sem mexer na cobrança.
  // Falha no armazenamento legado não pode ocultar os pedidos reais do Neon.
  let sandboxOrders=[],sandboxHistoryUnavailable=false;
  try{
    const [archivedLinks,archivedRecords]=await Promise.all([
      getJson('data/links',[]),getJson('data/orders',[])
    ]);
    sandboxOrders=archivedSandboxOrders(id,archivedLinks,archivedRecords);
  }catch(error){
    sandboxHistoryUnavailable=true;
    console.warn('Ever Clean portal: histórico de testes indisponível',
      String(error?.message||'erro').slice(0,80));
  }
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
  return response({ok:true,checkout_enabled:generalPublicRelease().enabled,
    request_enabled:true,customer:{
    name:clientName(customer),email:clientEmail(customer)},
    orders,sandbox_orders:sandboxOrders,
    sandbox_history_unavailable:sandboxHistoryUnavailable,
    requests:requestsData.rows.map(row=>({
      ...requestSummary(row),
      checkout_number:row.checkout_number||null,
      checkout_payment_state:row.checkout_payment_state||null,
      // Aprovação ainda pode seguir para pagamento? Pedido pago, cancelado,
      // estornado ou link vencido: não; o cliente faz um pedido novo.
      checkout_reusable:requestReusable(row),
      // Status financeiro confirmado apenas com estado, webhook Asaas e data.
      checkout_paid:row.checkout_payment_state==='paid'&&
        ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(row.checkout_asaas_status)&&
        Boolean(row.checkout_paid_at),
      checkout_bling_registered:row.checkout_payment_state==='paid'&&
        ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(row.checkout_asaas_status)&&
        Boolean(row.checkout_paid_at)&&
        ['sent','already_exists'].includes(row.checkout_bling_state)&&
        /^\d{1,20}$/.test(String(row.checkout_bling_id||''))&&
        row.checkout_bling_reference==='EC-PROD-'+String(row.checkout_number)
    })),
    // Formas de pagamento do cliente (boleto só se liberado no cadastro).
    payment_methods:catalog.available_payment_methods,boleto_due_days:catalog.boleto_due_days,
    products:displayProducts,max_items:catalog.max_items,
    message:'Itens disponíveis seguem ao PIX com confirmação final do cliente. Encomendas dependem de análise.'});
};
// Download da nota fiscal pelo portal: GET com o cookie da sessão; só pedidos
// pagos do próprio cliente e só nota autorizada.
async function portalInvoiceDownload(request){
  const params=new URL(request.url).searchParams;
  const number=String(params.get('order')||''),format=String(params.get('format')||'pdf');
  if(!/^[1-9][0-9]{0,9}$/.test(number)||!['pdf','xml'].includes(format))
    return response({ok:false,message:'Nota fiscal inválida.'},404);
  const identity=await session(request);
  if(!identity)return response({ok:false,message:'Entre na sua conta para baixar a nota.'},401);
  const {rows}=await checkoutDb().query(
    "SELECT id::text AS id FROM everclean_private.checkout_orders "+
    "WHERE request_number=$1 AND customer_id=$2 AND state='paid' LIMIT 2",[number,identity.id]);
  if(rows.length!==1)return response({ok:false,message:'Nota fiscal não encontrada.'},404);
  const invoice=(await invoicesFor(checkoutDb(),[rows[0].id])).get(rows[0].id);
  if(!invoice||invoice.status!=='authorized')
    return response({ok:false,message:'Nota fiscal ainda não disponível.'},404);
  const token=await blingAccessToken();
  if(!token)return response({ok:false,message:'Nota temporariamente indisponível.'},503);
  return invoiceDocument(invoice,format,token);
}

export default async function handler(request,context){
  if(request.method==='GET'&&new URL(request.url).searchParams.get('action')==='invoice'){
    try{return await portalInvoiceDownload(request);}
    catch(error){
      const status=Number(error?.status);
      console.warn('Ever Clean portal NF-e:',String(error?.message||'erro').slice(0,90));
      return response({ok:false,message:status>=400&&status<500?String(error.message):
        'Não foi possível obter a nota agora.'},status>=400&&status<600?status:502);
    }
  }
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
      if(action==='admin_requests')return await adminPortalRequests();
      if(action==='admin_review_request')return await adminReviewRequest(input);
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
    if(action==='session'||action==='home'||action==='submit_request'||action==='cart_readiness'||
      action==='prepare_approved_payment'){
      const identity=await session(request);
      if(!identity)return response({ok:false,message:'Entre na sua conta para continuar.'},401,
        {'Set-Cookie':clearCookie()});
      if(action==='session')return response({ok:true,customer_name:clientName(identity.customer)});
      if(action==='cart_readiness')return await portalCartReadiness(identity,input);
      if(action==='submit_request')return await submitPortalRequest(identity,input);
      if(action==='prepare_approved_payment')
        return await prepareApprovedPayment(identity,input);
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
