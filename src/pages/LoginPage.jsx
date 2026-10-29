import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, ShieldCheck, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';

const ADMIN_EMAIL = 'evercleanhigieneprofissional@gmail.com';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [resetLoading, setResetLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [resetMessage, setResetMessage] = React.useState('');

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) navigate('/admin', { replace: true });
    });
  }, [navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setResetMessage('');

    if (!isSupabaseConfigured) {
      setError('Supabase não está configurado no ambiente de produção.');
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (signInError) {
      setError('E-mail ou senha inválidos.');
      return;
    }

    toast.success('Acesso liberado');
    navigate('/admin', { replace: true });
  }

  async function handleResetPassword() {
    setError('');
    setResetMessage('');

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError('Informe o e-mail administrativo para recuperar a senha.');
      return;
    }

    if (normalizedEmail !== ADMIN_EMAIL) {
      setError('Nesta fase experimental, a recuperação está liberada apenas para o administrador principal da Ever Clean.');
      return;
    }

    setResetLoading(true);

    try {
      const response = await fetch('/.netlify/functions/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        setError(payload?.message || 'Não foi possível enviar o link de recuperação.');
        return;
      }

      const message = payload?.message || 'Link de redefinição enviado. Verifique a caixa de entrada e o spam.';
      setResetMessage(message);
      toast.success('Link de redefinição enviado');
    } catch {
      setError('Não foi possível acessar o serviço de recuperação. Tente novamente.');
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-brand">
        <div className="login-brand-inner">
          <div className="brand">
            <div className="brand-mark">EC</div>
            <div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div>
          </div>
          <h1>Vendas B2B mais rápidas, do catálogo à entrega.</h1>
          <p>Gerencie clientes, produtos, estoque e pedidos em um único ambiente. Envie um link exclusivo e deixe o cliente montar a reposição sem login e sem burocracia.</p>
        </div>
      </section>

      <section className="login-card-wrap">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="brand">
            <div className="brand-mark">EC</div>
            <div className="brand-copy">Ever Clean<small>ACESSO INTERNO</small></div>
          </div>

          <h2>Entrar no sistema</h2>
          <p>Acesso administrativo da Ever Clean.</p>

          <div className="field">
            <label>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label>Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && <div className="form-error">{error}</div>}
          {resetMessage && (
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: '#eef8f1', color: '#23633b', fontSize: 12 }}>
              {resetMessage}
            </div>
          )}

          <button className="btn btn-primary" style={{ width: '100%', height: 46 }} disabled={loading || resetLoading}>
            {loading ? 'Entrando...' : <><LogIn size={18} /> Entrar</>}
          </button>

          <button
            type="button"
            className="btn"
            onClick={handleResetPassword}
            disabled={loading || resetLoading}
            style={{ width: '100%', height: 42, marginTop: 10, background: '#f4f7f6', color: '#315047' }}
          >
            <KeyRound size={17} /> {resetLoading ? 'Enviando...' : 'Esqueci minha senha'}
          </button>

          <div style={{ marginTop: 12, padding: '9px 10px', border: '1px dashed #d6dfdc', borderRadius: 10, color: '#73847e', fontSize: 10.5 }}>
            Recuperação experimental liberada apenas para o administrador principal. O fluxo será reforçado antes do lançamento oficial.
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 8, alignItems: 'center', color: '#718087', fontSize: 11 }}>
            <ShieldCheck size={15} /> Ambiente interno protegido por autenticação Supabase.
          </div>
        </form>
      </section>
    </div>
  );
}
