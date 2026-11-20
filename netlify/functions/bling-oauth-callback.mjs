// URL estável para cadastro do aplicativo privado no Bling.
// A troca de tokens OAuth só será liberada após autenticação administrativa segura.
export default async function handler(request) {
  if (request.method !== 'GET') return Response.json({ok:false,message:'Método não permitido.'},{status:405});
  return new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bling | Ever Clean</title><body style="font:16px system-ui;margin:0;padding:32px;background:#f1f6f4;color:#183d38"><main style="background:white;border:1px solid #dbe7e3;border-radius:18px;padding:24px;max-width:550px;margin:40px auto"><h1>Integração Bling</h1><p>URL de retorno cadastrada. A autorização ainda está bloqueada até a proteção do acesso administrativo e configuração segura do aplicativo.</p><p>Nenhum token ou dado fiscal foi armazenado.</p><a href="/admin/bling">Voltar para a Ever Clean</a></main></body></html>',
    {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex'}}
  );
}
