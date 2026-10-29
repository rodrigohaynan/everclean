import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) navigate('/admin', { replace: true });
    });
  }, [navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
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
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" required />
          </div>
          <div className="field">
            <label>Senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%', height: 46 }} disabled={loading}>
            {loading ? 'Entrando...' : <><LogIn size={18} /> Entrar</>}
          </button>
          <div style={{ marginTop: 18, display: 'flex', gap: 8, alignItems: 'center', color: '#718087', fontSize: 11 }}>
            <ShieldCheck size={15} /> Ambiente interno protegido por autenticação Supabase.
          </div>
        </form>
      </section>
    </div>
  );
}
