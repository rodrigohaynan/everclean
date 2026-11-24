import {json} from '../shared/everclean-asaas.mjs';
import {catalogProductionPreview,validateProductionCart,
  publicProductionStatus,createProductionPix} from '../shared/everclean-live-checkout.mjs';
import {getGeneralProductionContext,generalProductionCatalog,generalProductionQuote,
  generalProductionStatus,validateGeneralProductionCompletion,createGeneralProductionPix,
  getGeneralProductionPix,getGeneralProductionBoleto,generalProductionLastOrder,
  getGeneralProductionInvoice,changeGeneralProductionPayment} from '../shared/everclean-general-production-checkout.mjs';

// Endpoint isolado da produção, sem reutilizar a API de cobrança Sandbox.
// Nenhum POST ao Asaas enquanto ASAAS_PROD_CATALOG_ENABLED não for 'true'.
export default async function handler(request){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  if(Number(request.headers.get('content-length')||0)>64*1024)
    return json({ok:false,message:'Requisição excede o limite.'},413);
  const input=await request.json().catch(()=>null);
  const action=String(input?.action||''),token=String(input?.token||'');
  if(!['catalog','quote','status','create_pix','create_payment','validate_checkout','pix_details','boleto_details',
    'invoice_details','change_payment'].includes(action))
    return json({ok:false,message:'Ação não permitida.'},403);
  try{
    // Os links gerais de produção são isolados dos 26 links Sandbox e do piloto.
    // PIX de produção geral continua BLOQUEADO até homologação e autorização.
    // Consulta de pedido pago continua disponível depois do vencimento do link.
    const general=await getGeneralProductionContext(token,
      {allowPaidView:action==='catalog'||action==='status'});
    if(general){
      if(action==='catalog'){
        const [catalog,lastOrder]=await Promise.all([
          Promise.resolve(generalProductionCatalog(general)),
          generalProductionLastOrder(general)
        ]);
        return json({ok:true,...catalog,last_order:lastOrder});
      }
      if(action==='status')return json({ok:true,...await generalProductionStatus(general)});
      if(action==='pix_details')return json({ok:true,...await getGeneralProductionPix(general)});
      if(action==='boleto_details')return json({ok:true,...await getGeneralProductionBoleto(general)});
      if(action==='invoice_details')return json({ok:true,...await getGeneralProductionInvoice(general)});
      // Troca a forma de pagamento da cobrança já criada (mesma cobrança no Asaas).
      if(action==='change_payment')return json({ok:true,
        ...await changeGeneralProductionPayment(general,input?.payment_method)});
      if(action==='quote')return json(generalProductionQuote(general,input?.items));
      if(action==='validate_checkout')return json(
        await validateGeneralProductionCompletion(general,input?.items)
      );
      if(action==='create_pix'||action==='create_payment')return json({
        ok:true,...await createGeneralProductionPix(general,input?.items,{
          payment_method:input?.payment_method,
          expected_amount_cents:input?.expected_amount_cents,
          notes:input?.notes,
          invoice_requested:input?.invoice_requested,
          invoice_channel:input?.invoice_channel,
          invoice_contact:input?.invoice_contact,
          invoice_address:input?.invoice_address
        })
      });
      return json({ok:false,payment_enabled:false,
        message:'Pagamento real do catálogo geral ainda não autorizado. Nenhuma cobrança criada.'},403);
    }
    if(['create_payment','boleto_details','invoice_details','change_payment'].includes(action))
      return json({ok:false,message:'Método não disponível neste link.'},403);
    if(action==='pix_details')return json({ok:false,
      message:'Consulta PIX disponível somente em pedido de produção vinculado ao Neon.'},403);
    if(action==='validate_checkout')return json({ok:false,
      message:'A validação multitema é exclusiva do checkout geral. Use o fluxo piloto existente.'},403);
    if(action==='catalog')return json({ok:true,...await catalogProductionPreview(token)});
    if(action==='quote'){
      const quote=await validateProductionCart(token,input?.items);
      return json({ok:true,request_number:quote.context.link.request_number,
        amount:quote.amount_cents/100,requires_stock_review:quote.requires_stock_review,
        items:quote.items});
    }
    if(action==='status')return json({ok:true,...await publicProductionStatus(token)});
    return json({ok:true,...await createProductionPix(token,input?.items)});
  }catch(error){
    const status=Number(error?.status);
    console.warn('Ever Clean produção checkout:',String(error?.message||'Erro').slice(0,90));
    return json({ok:false,message:String(error?.message||'Falha no pedido de produção.').slice(0,170)},
      status>=400&&status<600?status:502);
  }
}
