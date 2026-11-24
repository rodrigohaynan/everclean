import React from 'react';
import {useNavigate} from 'react-router-dom';
import {LogIn, ShieldCheck, KeyRound, UserPlus} from 'lucide-react';
import {toast} from 'sonner';
import {getTestToken,setTestToken,testApi} from '../lib/testApi.js';

// Uma única página de acesso para clientes e equipe Ever Clean.
// O e-mail decide o destino: o da administração entra no painel; os demais
// entram no portal do cliente. A comparação usa o hash do e-mail para que o
// endereço administrativo não apareça no site. Tentativas de clientes nunca
// passam pelo login administrativo (que bloqueia o IP após 5 falhas).
const ADMIN_EMAIL_SHA256='f42fd49bdff25e24f52510fec47f728168a2e43ce43141acb177f74b93985ebf';

async function isAdminEmail(email){
  try{
    const bytes=new TextEncoder().encode(String(email||'').trim().toLowerCase());
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    return hex===ADMIN_EMAIL_SHA256;
  }catch{return false;}
}

async function customerLogin(email,password){
  const response=await fetch('/.netlify/functions/customer-portal',{
    method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'login',email,password})
  });
  const data=await response.json().catch(()=>({ok:false}));
  if(!response.ok||data?.ok!==true)throw Error(data?.message||'E-mail ou senha incorretos.');
  return data;
}

export default function LoginPage(){
  const navigate=useNavigate();
  const [email,setEmail]=React.useState('');
  const [password,setPassword]=React.useState('');
  const [loading,setLoading]=React.useState(false);
  const [error,setError]=React.useState('');
  const [help,setHelp]=React.useState('');
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
      if(await isAdminEmail(email)){
        const data=await testApi('login',{email,password},{auth:false});
        if(!data?.ok){setError(data?.message||'E-mail ou senha incorretos.');return;}
        setTestToken(data.token);
        toast.success('Acesso autorizado');
        navigate('/admin',{replace:true});
        return;
      }
      await customerLogin(email,password);
      navigate('/cliente',{replace:true});
    }catch(err){setError(err?.message||'Não foi possível conectar ao servidor.');}
    finally{setLoading(false);}
  }
  const helpBox={marginTop:10,padding:'11px 12px',borderRadius:12,background:'#f4f7f6',
    color:'#315047',fontSize:12,lineHeight:1.55};
  return <div className="login-page">
    <section className="login-brand"><div className="login-brand-inner">
      <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div></div>
      <h1>Reposição de higiene profissional, do pedido à entrega.</h1>
      <p>Catálogo, pagamento, acompanhamento do pedido e notas fiscais em um só lugar.</p>
    </div></section>
    <section className="login-card-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>ÁREA DO CLIENTE</small></div></div>
        <h2>Entrar</h2>
        <p>Acesse com seu e-mail e senha.</p>
        <div className="field"><label>E-mail</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username" inputMode="email" placeholder="seu@email.com" required /></div>
        <div className="field"><label>Senha</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" autoComplete="current-password" required /></div>
        {error&&<div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary" style={{width:'100%',height:48}} disabled={loading}><LogIn size={18}/>{loading?'Entrando...':'Entrar'}</button>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:12}}>
          <button type="button" className="btn" onClick={()=>setHelp(help==='password'?'':'password')}
            style={{height:42,background:'#f4f7f6',color:'#315047',fontSize:13}}><KeyRound size={16}/>Esqueci a senha</button>
          <button type="button" className="btn" onClick={()=>navigate('/cadastro')}
            style={{height:42,background:'#f4f7f6',color:'#315047',fontSize:13}}><UserPlus size={16}/>Criar cadastro</button>
        </div>
        {help==='password'&&<div style={helpBox}>
          Peça à equipe Ever Clean um novo link de acesso: com ele você cria uma nova senha.
          <div style={{marginTop:6}}><a href="/redefinir-senha" style={{textDecoration:'underline',color:'#0b4f48'}}>
            Sou da equipe Ever Clean</a></div>
        </div>}
        <div style={{marginTop:18,display:'flex',gap:8,alignItems:'center',color:'#718087',fontSize:11}}><ShieldCheck size={15}/>Não compartilhe sua senha ou código de acesso.</div>
      </form>
    </section>
  </div>;
}
