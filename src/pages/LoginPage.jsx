import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, ShieldCheck, KeyRound, FlaskConical, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getTestToken, setTestToken, testApi } from '../lib/testApi.js';

const ADMIN_EMAIL = 'evercleanhigieneprofissional@gmail.com';

function createTemporaryPassword() {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return `Ec-${Array.from(bytes).map((n) => n.toString(36)).join('-')}!`;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState(ADMIN_EMAIL);
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [testLoading, setTestLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!getTestToken()) return;
    testApi('session').then((data) => {
      if (data?.ok) navigate('/admin', { replace: true });
      else setTestToken('');
    });
  }, [navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const data = await testApi('login', { email, password }, { auth: false });
    setLoading(false);
    if (!data?.ok) {
      setError(data?.message || 'Não foi possível entrar no ambiente de testes.');
      return;
    }
    setTestToken(data.token);
    toast.success('Acesso ao ambiente de testes liberado');
    navigate('/admin', { replace: true });
  }

  async function enterTestMode() {
    setError('');
    setTestLoading(true);
    try {
      const temporaryPassword = createTemporaryPassword();
      const reset = await testApi('reset_password', {
        email: ADMIN_EMAIL,
        password: temporaryPassword,
      }, { auth: false });

      if (!reset?.ok) {
        setError(reset?.message || 'Não foi possível preparar o ambiente de testes.');
        return;
      }

      const login = await testApi('login', {
        email: ADMIN_EMAIL,
        password: temporaryPassword,
      }, { auth: false });

      if (!login?.ok) {
        setError(login?.message || 'Não foi possível abrir o ambiente de testes.');
        return;
      }

      setTestToken(login.token);
      toast.success('Ambiente de testes aberto');
      navigate('/admin', { replace: true });
    } catch {
      setError('Não foi possível acessar o backend de testes.');
    } finally {
      setTestLoading(false);
    }
  }

  function goReset() {
    const normalized = email.trim().toLowerCase();
    if (normalized && normalized !== ADMIN_EMAIL) {
      setError('A redefinição experimental está disponível apenas para o administrador principal.');
      return;
    }
    navigate(`/redefinir-senha?email=${encodeURIComponent(ADMIN_EMAIL)}`);
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
          <p>Ambiente experimental para testar clientes, produtos, estoque, links de pedido e pedidos online sem depender do Supabase.</p>
        </div>
      </section>

      <section className="login-card-wrap">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="brand">
            <div className="brand-mark">EC</div>
            <div className="brand-copy">Ever Clean<small>AMBIENTE DE TESTES V2</small></div>
          </div>

          <div style={{display:'flex',gap:8,alignItems:'center',margin:'12px 0',padding:'9px 11px',borderRadius:10,background:'#fff6df',color:'#7c5a13',fontSize:11}}>
            <FlaskConical size={15}/> Dados temporários. Não usar informações sensíveis.
          </div>

          <h2>Testar o sistema</h2>
          <p>Para esta fase, você pode entrar direto sem senha.</p>

          <button
            type="button"
            className="btn btn-primary"
            onClick={enterTestMode}
            disabled={testLoading || loading}
            style={{width:'100%',height:52,fontSize:16,marginBottom:18}}
          >
            <PlayCircle size={20}/> {testLoading ? 'Abrindo ambiente...' : 'Entrar no ambiente de testes'}
          </button>

          <div style={{display:'flex',alignItems:'center',gap:10,margin:'4px 0 16px',color:'#8a969b',fontSize:11}}>
            <span style={{height:1,background:'#e3e8e6',flex:1}} /> ou usar login de teste <span style={{height:1,background:'#e3e8e6',flex:1}} />
          </div>

          <div className="field">
            <label>E-mail</label>
            <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="field">
            <label>Senha</label>
            <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Senha do ambiente de testes" autoComplete="current-password" required />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button className="btn" style={{width:'100%',height:44,background:'#f4f7f6',color:'#315047'}} disabled={loading || testLoading}>
            {loading ? 'Entrando...' : <><LogIn size={18}/> Entrar com senha</>}
          </button>

          <button type="button" className="btn" onClick={goReset} disabled={loading || testLoading} style={{width:'100%',height:40,marginTop:8,background:'transparent',color:'#315047'}}>
            <KeyRound size={16}/> Redefinir senha de teste
          </button>

          <div style={{marginTop:18,display:'flex',gap:8,alignItems:'center',color:'#718087',fontSize:11}}>
            <ShieldCheck size={15}/> Backend temporário hospedado no Netlify. Supabase desativado nesta fase.
          </div>
        </form>
      </section>
    </div>
  );
}
