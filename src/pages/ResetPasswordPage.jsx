import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, ShieldCheck, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { testApi } from '../lib/testApi.js';

const ADMIN_EMAIL = 'evercleanhigieneprofissional@gmail.com';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const email = (searchParams.get('email') || ADMIN_EMAIL).trim().toLowerCase();
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (email !== ADMIN_EMAIL) {
      setError('Redefinição experimental disponível apenas para o administrador principal.');
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
    const data = await testApi('reset_password', { email, password }, { auth: false });
    setLoading(false);
    if (!data?.ok) {
      setError(data?.message || 'Não foi possível redefinir a senha de teste.');
      return;
    }
    toast.success('Senha de teste redefinida');
    navigate('/login', { replace: true });
  }

  return (
    <div className="login-page">
      <section className="login-brand">
        <div className="login-brand-inner">
          <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div></div>
          <h1>Redefinição experimental.</h1>
          <p>Nesta fase de testes, a senha é alterada diretamente no backend temporário do Netlify, sem e-mail e sem Supabase.</p>
        </div>
      </section>
      <section className="login-card-wrap">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>REDEFINIR SENHA DE TESTE</small></div></div>
          <div style={{display:'flex',gap:8,alignItems:'center',margin:'12px 0',padding:'9px 11px',borderRadius:10,background:'#fff6df',color:'#7c5a13',fontSize:11}}><FlaskConical size={15}/> Recurso temporário e não indicado para produção.</div>
          <h2>Criar nova senha</h2>
          <p>{ADMIN_EMAIL}</p>
          <div className="field"><label>Nova senha</label><input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" autoComplete="new-password" required /></div>
          <div className="field"><label>Confirmar nova senha</label><input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} placeholder="Digite novamente" autoComplete="new-password" required /></div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary" style={{width:'100%',height:46}} disabled={loading}><KeyRound size={18}/>{loading?'Alterando...':'Salvar nova senha'}</button>
          <button type="button" className="btn" onClick={()=>navigate('/login')} style={{width:'100%',height:42,marginTop:10,background:'#f4f7f6',color:'#315047'}}>Voltar ao login</button>
          <div style={{marginTop:18,display:'flex',gap:8,alignItems:'center',color:'#718087',fontSize:11}}><ShieldCheck size={15}/> A autenticação definitiva será implantada na fase de produção.</div>
        </form>
      </section>
    </div>
  );
}
