// Etapas do acompanhamento (iguais às do servidor em netlify/shared/fulfillment.mjs).
export const FULFILLMENT_LABELS={
  received:'Pedido recebido',
  preparing:'Em separação',
  ready_for_delivery:'Pedido separado',
  out_for_delivery:'Em rota para entrega',
  delivered:'Pedido entregue',
  on_hold:'Aguardando disponibilidade'
};
// Linha do tempo mostrada ao cliente.
export const MAIN_STEPS=[
  {stage:'received',label:'Recebido'},
  {stage:'ready_for_delivery',label:'Separado'},
  {stage:'out_for_delivery',label:'Em rota'},
  {stage:'delivered',label:'Entregue'}
];
export const normalizeStage=stage=>
  Object.hasOwn(FULFILLMENT_LABELS,String(stage||''))?String(stage):'received';
export function stepIndex(stage){
  const s=normalizeStage(stage);
  if(s==='preparing'||s==='on_hold')return 0;
  return Math.max(0,MAIN_STEPS.findIndex(step=>step.stage===s));
}
export function formatDateTime(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  return date.toLocaleString('pt-BR',{timeZone:'America/Campo_Grande',day:'2-digit',
    month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
