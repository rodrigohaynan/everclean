import {json} from '../shared/everclean-asaas.mjs';
import {catalogProductionPreview,validateProductionCart,
  publicProductionStatus,createProductionPix} from '../shared/everclean-live-checkout.mjs';

// Endpoint isolado da produção, sem reutilizar a API de cobrança Sandbox.
// Nenhum POST ao Asaas enquanto ASAAS_PROD_CATALOG_ENABLED não for 'true'.
export default async function handler(request){
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405);
  if(Number(request.headers.get('content-length')||0)>64*1024)
    return json({ok:false,message:'Requisição excede o limite.'},413);
  const input=await request.json().catch(()=>null);
  const action=String(input?.action||''),token=String(input?.token||'');
  if(!['catalog','quote','status','create_pix'].includes(action))
    return json({ok:false,message:'Ação não permitida.'},403);
  try{
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
