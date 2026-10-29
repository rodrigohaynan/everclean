import React from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let mounted = true;

    async function checkRecoverySession() {
      if (!isSupabaseConfigured) {
        if (mounted) setError('Supabase não está configurado no ambiente de produção.');
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!mounted) return;

      if (sessionError) {
        setError('Não foi possível validar o link de recuperação.');
        return;
      }

      if (data?.session) {
        setReady(true);
      } else {
        setError('Este link de recuperação é inválido ou expirou. Solicite um novo link na tela de login.');
      }
    }

    checkRecoverySession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        setReady(true);
        setError('');
      }
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas digitadas não coincidem.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(`Não foi possível alterar a senha: ${updateError.message}`);
      return;
    }

    toast.success('Senha redefinida com sucesso');
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="login-page">
      <section className="login-brand">
        <div className="login-brand-inner">
          <div className="brand">
            <div className="brand-mark">EC</div>
            <div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div>
          </div>
          <h1>Redefinição experimental de senha.</h1>
          <p>Este recurso está disponível apenas durante a fase de testes do sistema. Antes do lançamento oficial, o fluxo será substituído por um mecanismo mais rígido de administração de acessos.</p>
        </div>
      </section>

      <section className="login-card-wrap">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="brand">
            <div className="brand-mark">EC</div>
            <div className="brand-copy">Ever Clean<small>REDEFINIR SENHA</small></div>
          </div>

          <h2>Criar nova senha</h2>
          <p>Defina uma nova senha para o acesso administrativo.</p>

          {!ready && !error && (
            <div style={{ marginBottom: 12, color: '#718087', fontSize: 12 }}>Validando link de recuperação...</div>
          )}

          <div className="field">
            <label>Nova senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo de 8 caracteres"
              autoComplete="new-password"
              disabled={!ready || loading}
              required
            />
          </div>

          <div className="field">
            <label>Confirmar nova senha</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Digite novamente"
              autoComplete="new-password"
              disabled={!ready || loading}
              required
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button className="btn btn-primary" style={{ width: '100%', height: 46 }} disabled={!ready || loading}>
            <KeyRound size={18} /> {loading ? 'Alterando...' : 'Salvar nova senha'}
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => navigate('/login')}
            style={{ width: '100%', height: 42, marginTop: 10, background: '#f4f7f6', color: '#315047' }}
          >
            Voltar ao login
          </button>

          <div style={{ marginTop: 18, display: 'flex', gap: 8, alignItems: 'center', color: '#718087', fontSize: 11 }}>
            <ShieldCheck size={15} /> O link é validado pela autenticação do Supabase.
          </div>
        </form>
      </section>
    </div>
  );
}
