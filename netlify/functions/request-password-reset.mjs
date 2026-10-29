import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAIL = 'evercleanhigieneprofissional@gmail.com';
const REDIRECT_TO = 'https://evercleancatalogo.netlify.app/redefinir-senha';

export default async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, message: 'Método não permitido.' }, { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
  }

  const email = String(payload?.email || '').trim().toLowerCase();

  if (email !== ADMIN_EMAIL) {
    return Response.json(
      { ok: false, message: 'Recuperação experimental disponível apenas para o administrador principal.' },
      { status: 403 },
    );
  }

  const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL');
  const supabaseAnonKey = Netlify.env.get('VITE_SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Variáveis do Supabase ausentes no ambiente da função.');
    return Response.json(
      { ok: false, message: 'Serviço de recuperação indisponível no momento.' },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: REDIRECT_TO,
    });

    if (error) {
      console.error('Falha no resetPasswordForEmail:', error.message);
      return Response.json(
        { ok: false, message: 'Não foi possível gerar o link de recuperação.' },
        { status: 400 },
      );
    }

    return Response.json({
      ok: true,
      message: 'Link de redefinição enviado. Verifique a caixa de entrada e o spam.',
    });
  } catch (error) {
    console.error('Erro inesperado no reset de senha:', error);
    return Response.json(
      { ok: false, message: 'Não foi possível conectar ao serviço de autenticação.' },
      { status: 502 },
    );
  }
};
