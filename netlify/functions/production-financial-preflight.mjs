import legacy from '../shared/admin-api/index.mjs';
import {json,requireSecureAdmin} from '../shared/everclean-bling.mjs';
import {checkoutDb} from '../shared/everclean-transactional-checkout.mjs';
import {getGeneralProductionContext,generalProductionCatalog,
  validateGeneralProductionCompletion} from '../shared/everclean-general-production-checkout.mjs';

// Homologação financeira: leitura da preparação registrada no Neon e cotação.
// Não contém POST ao Asaas ou Bling, não autoriza pagamentos nem grava no Neon.
// A preparação isolada não ativa EVERCLEAN_PUBLIC_CHECKOUT_PIX_ENABLE.
const validId=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
const normalizeItems=(items,key)=>{
  if(!Array.isArray(items)||!items.length||items.length>50)return null;
  const values=items.map(x=>{
    const sku=String(x?.[key]||'').trim();
    const qty=Number(x?.quantity),unit=Number(x?.unit_price_cents);
    if(!sku||!Number.isSafeInteger(qty)||qty<=0||
      !Number.isSafeInteger(unit)||unit<=0)return null;
    return sku+'|'+qty+'|'+unit;
  });
  return values.some(x=>x===null)?null:values.sort().join(';');
};
export default async function handler(request,context){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  if(Number(request.headers.get('content-length')||0)>32*1024)
    return json({ok:false,message:'Requisição acima do limite.'},413);
  const auth=await requireSecureAdmin(request,legacy,context);
  if(!auth.ok)return auth.response;
  const input=await request.json().catch(()=>null);
  if(!['catalog','validate'].includes(input?.action)||!validId(input?.link_id))
    return json({ok:false,message:'Selecione um link de produção válido.'},400);
  try{
    // Token exclusivo acessado apenas no servidor; não é devolvido ao navegador.
    const {rows}=await checkoutDb().query(
      'SELECT id,token,request_number,customer_name,status,expires_at FROM '+
      'everclean_private.production_catalog_links WHERE id=$1 LIMIT 1',
      [input.link_id]
    );
    if(rows.length!==1)return json({ok:false,message:'Link não encontrado.'},404);
    const link=rows[0];
    if(link.status!=='prepared'||Date.parse(link.expires_at)<=Date.now())
      return json({ok:false,message:'Link cancelado ou expirado. Prepare outro link sem PIX.'},410);
    const c=await getGeneralProductionContext(link.token);
    if(!c||String(c.link.id)!==String(link.id))
      return json({ok:false,message:'Vínculo do cliente ou link não confirmado.'},409);
    const [existingLink,existingNumber]=await Promise.all([
      checkoutDb().query('SELECT id,state FROM everclean_private.checkout_orders WHERE link_digest=$1 LIMIT 2',[c.digest]),
      checkoutDb().query('SELECT id,state FROM everclean_private.checkout_orders WHERE request_number=$1 LIMIT 2',[String(link.request_number)])
    ]);
    const unused=existingLink.rows.length===0&&existingNumber.rows.length===0;
    const catalogue=generalProductionCatalog(c);
    const stagedItems=Array.isArray(c.link.payment_approved_items)?
      c.link.payment_approved_items:[];
    const exactPreparation=unused&&link.request_number==='1000000001'&&
      Number(c.link.payment_max_cents)===1169&&
      normalizeItems(stagedItems,'sku')===
        normalizeItems([
          {sku:'100388',quantity:1,unit_price_cents:700},
          {sku:'100561',quantity:1,unit_price_cents:469}
        ],'sku');
    const stageReady=exactPreparation&&
      c.link.payment_authorized===false&&!c.link.payment_authorized_at;
    const paymentActive=exactPreparation&&
      c.link.payment_authorized===true&&
      Boolean(c.link.payment_authorized_at)&&catalogue.enabled===true;
    const preparation={
      state:paymentActive?'authorized_for_single_pix':
        stageReady?'awaiting_final_confirmation':'not_prepared',
      amount_cents:exactPreparation?1169:null,
      items:exactPreparation?stagedItems:[],
      payment_authorized:paymentActive
    };
    const common={
      ok:true,preview_only:true,no_pix_created:true,no_bling_order_created:true,
      authorization_action_performed:false,
      request_number:String(link.request_number),customer_name:String(link.customer_name||''),
      link_unused:unused,expires_at:link.expires_at,
      checkout_enabled_for_customer:catalogue.enabled===true,
      max_items:catalogue.max_items,preparation
    };
    if(input.action==='catalog'){
      return json({...common,products:catalogue.products,
        message:paymentActive?
          'PIX real de R$ 11,69 autorizado somente neste link. A cobrança ainda não foi gerada; abra o link do cliente para confirmar a emissão única.':
          unused?'Link disponível para pré-homologação. Selecione os itens e valide sem PIX.':
          'Link já utilizado: outra cobrança está bloqueada. Escolha um link ainda não utilizado.'});
    }
    if(!unused)return json({ok:false,
      message:'Esse link já possui pedido. Não preparar outra cobrança.',link_unused:false},409);
    if(!Array.isArray(input.items)||input.items.length>50||input.items.length===0)
      return json({ok:false,message:'Selecione de 1 a 50 produtos diferentes.'},400);
    const validation=await validateGeneralProductionCompletion(c,input.items);
    const matchesPreparedCart=exactPreparation&&
      Math.round(Number(validation.amount)*100)===1169&&
      normalizeItems(stagedItems,'sku')===
        normalizeItems(validation.items,'product_sku');
    const readyForFinalReview=validation.eligible_for_future_payment===true&&
      matchesPreparedCart&&stageReady;
    return json({...common,preview_only:true,validation,
      prepared_cart_matches:matchesPreparedCart,
      ready_for_manual_authorization_review:readyForFinalReview,
      message:paymentActive&&matchesPreparedCart?
        'PIX autorizado somente para este carrinho de R$ 11,69. A cobrança ainda não foi criada; abra o link do cliente para emiti-la uma única vez.':
        readyForFinalReview?
        'Carrinho idêntico à preparação exclusiva. Aguarda confirmação final; nenhum PIX foi criado.':
        exactPreparation?'Carrinho diferente dos dois produtos preparados. PIX restrito ao carrinho autorizado.':
        'Prévia validada; preparação financeira exclusiva ainda não registrada.'});
  }catch(error){
    console.warn('Ever Clean pré-homologação:',String(error?.message||'Falha').slice(0,90));
    const status=Number(error?.status);
    return json({ok:false,message:String(error?.message||'Pré-homologação indisponível.').slice(0,170)},
      status>=400&&status<600?status:502);
  }
}
