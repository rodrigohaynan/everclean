import React from 'react';
import {useNavigate} from 'react-router-dom';
import {LogIn, ShieldCheck, KeyRound} from 'lucide-react';
import {toast} from 'sonner';
import {getTestToken,setTestToken,testApi} from '../lib/testApi.js';

const ADMIN_EMAIL='evercleanhigieneprofissional@gmail.com';

export default function LoginPage(){
  const navigate=useNavigate();
  const [email,setEmail]=React.useState(ADMIN_EMAIL);
  const [password,setPassword]=React.useState('');
  const [loading,setLoading]=React.useState(false);
  const [error,setError]=React.useState('');
  React.useEffect(()=>{
    if(!getTestToken())return;
    testApi('session').then(data=>{
      if(data?.ok)navigate('/admin',{replace:true});
      else setTestToken('');
    }).catch(()=>setTestToken(''));
  },[navigate]);
  async function handleSubmit(event){
    event.preventDefault();setError('');setLoading(true);
    try{
      const data=await testApi('login',{email,password},{auth:false});
      if(!data?.ok){setError(data?.message||'Não foi possível entrar.');return;}
      setTestToken(data.token);
      toast.success('Acesso autorizado');
      navigate('/admin',{replace:true});
    }catch{setError('Não foi possível conectar ao servidor.');}
    finally{setLoading(false);}
  }
  return <div className="login-page">
    <section className="login-brand"><div className="login-brand-inner">
      <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div></div>
      <h1>Vendas B2B mais rápidas, do catálogo à entrega.</h1>
      <p>Acesso administrativo protegido para gerenciar clientes, produtos, pedidos e integrações.</p>
    </div></section>
    <section className="login-card-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>ACESSO ADMINISTRATIVO</small></div></div>
        <h2>Entrar no sistema</h2>
        <p>Informe a senha administrativa.</p>
        <div className="field"><label>E-mail</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required /></div>
        <div className="field"><label>Senha</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Senha administrativa" autoComplete="current-password" required /></div>
        {error&&<div className="form-error">{error}</div>}
        <button type="submit" className="btn btn-primary" style={{width:'100%',height:48}} disabled={loading}><LogIn size={18}/>{loading?'Entrando...':'Entrar com senha'}</button>
        <button type="button" className="btn" onClick={()=>navigate('/redefinir-senha')} style={{width:'100%',height:42,marginTop:12,background:'#f4f7f6',color:'#315047'}}><KeyRound size={17}/>Configurar ou recuperar senha</button>
        <div style={{marginTop:18,display:'flex',gap:8,alignItems:'center',color:'#718087',fontSize:11}}><ShieldCheck size={15}/>Não compartilhe sua senha ou código de recuperação.</div>
      </form>
    </section>
  </div>;
}
