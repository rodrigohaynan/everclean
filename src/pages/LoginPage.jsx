import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, ShieldCheck, KeyRound, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { getTestToken, setTestToken, testApi } from '../lib/testApi.js';

const ADMIN_EMAIL = 'evercleanhigieneprofissional@gmail.com';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState(ADMIN_EMAIL);
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
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
          <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div></div>
          <h1>Vendas B2B mais rápidas, do catálogo à entrega.</h1>
          <p>Ambiente experimental para testar clientes, catálogo, links e pedidos sem depender do Supabase.</p>
        </div>
      </section>
      <section className="login-card-wrap">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>AMBIENTE DE TESTES</small></div></div>
          <div style={{display:'flex',gap:8,alignItems:'center',margin:'12px 0',padding:'9px 11px',borderRadius:10,background:'#fff6df',color:'#7c5a13',fontSize:11}}><FlaskConical size={15}/> Dados temporários. Não usar informações sensíveis.</div>
          <h2>Entrar no sistema</h2>
          <p>Acesso administrativo experimental da Ever Clean.</p>
          <div className="field"><label>E-mail</label><input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} autoComplete="email" required /></div>
          <div className="field"><label>Senha</label><input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Senha do ambiente de testes" autoComplete="current-password" required /></div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary" style={{width:'100%',height:46}} disabled={loading}>{loading?'Entrando...':<><LogIn size={18}/> Entrar</>}</button>
          <button type="button" className="btn" onClick={goReset} disabled={loading} style={{width:'100%',height:42,marginTop:10,background:'#f4f7f6',color:'#315047'}}><KeyRound size={17}/> Redefinir senha de teste</button>
          <div style={{marginTop:12,padding:'9px 10px',border:'1px dashed #d6dfdc',borderRadius:10,color:'#73847e',fontSize:10.5}}>Nesta fase, a redefinição é direta e não envia e-mail. Antes do lançamento, o controle de acesso será substituído por autenticação segura.</div>
          <div style={{marginTop:18,display:'flex',gap:8,alignItems:'center',color:'#718087',fontSize:11}}><ShieldCheck size={15}/> Backend temporário hospedado no Netlify.</div>
        </form>
      </section>
    </div>
  );
}
