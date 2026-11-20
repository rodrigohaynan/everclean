import {runBlingStockSync} from '../shared/bling-stock-sync.mjs';

// Executa somente pelo agendador do Netlify, nunca via URL pública.
// Cron em UTC: a cada meia hora, inclusive fora do horário comercial.
export const config={schedule:'*/30 * * * *'};

export default async function handler(){
  const result=await runBlingStockSync({source:'scheduled'});
  if(!result.ok)console.error('Ever Clean: sincronização automática falhou:',result.message);
  return Response.json({ok:result.ok,result:result.last_result||null,
    checked:result.updated_count||0,changed:result.changed_count||0,
    message:result.message});
}
