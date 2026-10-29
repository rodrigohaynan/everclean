import React from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';

function readRecoveryParams() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

  return {
    code: searchParams.get('code'),
    accessToken: hashParams.get('access_token'),
    refreshToken: hashParams.get('refresh_token'),
    type: hashParams.get('type') || searchParams.get('type'),
    errorCode: hashParams.get('error_code') || searchParams.get('error_code'),
    errorDescription: hashParams.get('error_description') || searchParams.get('error_description'),
  };
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [validating, setValidating] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let mounted = true;
    let validationTimer;

    function authorizeRecovery(session) {
      if (!mounted || !session) return false;
      setReady(true);
      setValidating(false);
      setError('');
      return true;
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        authorizeRecovery(session);
      }
    });

    async function validateRecovery() {
      if (!isSupabaseConfigured) {
        if (mounted) {
          setValidating(false);
          setError('Supabase não está configurado no ambiente de produção.');
        }
        return;
      }

      const params = readRecoveryParams();

      if (params.errorCode) {
        if (mounted) {
          setValidating(false);
          setError(params.errorDescription || 'O link de recuperação é inválido ou expirou.');
        }
        return;
      }

      try {
        // PKCE: o Supabase retorna ?code=... e o código precisa ser trocado por uma sessão.
        if (params.code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
          if (exchangeError) throw exchangeError;
          if (authorizeRecovery(data?.session)) return;
        }

        // Fluxo implícito: alguns templates retornam tokens no fragmento da URL.
        if (params.accessToken && params.refreshToken) {
          const { data, error: setSessionError } = await supabase.auth.setSession({
            access_token: params.accessToken,
            refresh_token: params.refreshToken,
          });
          if (setSessionError) throw setSessionError;
          if (authorizeRecovery(data?.session)) return;
        }

        // detectSessionInUrl também pode concluir a recuperação automaticamente.
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (authorizeRecovery(data?.session)) return;

        // Evita falso negativo enquanto o cliente Supabase termina de processar a URL.
        validationTimer = window.setTimeout(async () => {
          const { data: delayedData } = await supabase.auth.getSession();
          if (!mounted) return;
          if (authorizeRecovery(delayedData?.session)) return;

          setValidating(false);
          setError('Este link de recuperação é inválido ou expirou. Solicite um novo link na tela de login.');
        }, 1200);
      } catch (recoveryError) {
        if (!mounted) return;
        setValidating(false);
        setError(recoveryError?.message || 'Não foi possível validar o link de recuperação. Solicite um novo link.');
      }
    }

    validateRecovery();

    return () => {
      mounted = false;
      if (validationTimer) window.clearTimeout(validationTimer);
      listener?.subscription?.unsubscribe();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!ready) {
      setError('O link de recuperação ainda não foi validado.');
      return;
    }

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

          {validating && (
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
