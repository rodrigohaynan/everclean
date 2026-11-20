import React from 'react';
import {useNavigate} from 'react-router-dom';
import {KeyRound,ShieldCheck,Copy} from 'lucide-react';
import {toast} from 'sonner';
import {testApi} from '../lib/testApi.js';

const ADMIN_EMAIL='evercleanhigieneprofissional@gmail.com';
function generateRecoveryKey(){
  const bytes=crypto.getRandomValues(new Uint8Array(36));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}

export default function ResetPasswordPage(){
  const navigate=useNavigate();
  const [setupKey,setSetupKey]=React.useState('');
  const [password,setPassword]=React.useState('');
  const [confirmPassword,setConfirmPassword]=React.useState('');
  const [loading,setLoading]=React.useState(false);
  const [error,setError]=React.useState('');
  const [done,setDone]=React.useState(false);
  async function copyKey(){
    if(!setupKey)return;
    try{await navigator.clipboard.writeText(setupKey);toast.success('Código copiado para a área de transferência.');}
    catch{toast.error('Selecione e copie o código manualmente.');}
  }
  async function handleSubmit(event){
    event.preventDefault();setError('');
    if(setupKey.length<32){setError('Informe o mesmo código de pelo menos 32 caracteres configurado no Netlify.');return;}
    if(password.length<12){setError('Use uma senha com pelo menos 12 caracteres.');return;}
    if(password!==confirmPassword){setError('As senhas não coincidem.');return;}
    setLoading(true);
    try{
      const data=await testApi('secure_set_password',{email:ADMIN_EMAIL,setup_key:setupKey,password},{auth:false});
      if(!data?.ok){setError(data?.message||'Não foi possível salvar a senha.');return;}
      setDone(true);setSetupKey('');setPassword('');setConfirmPassword('');
      toast.success('Nova senha administrativa configurada!');
    }catch{setError('Não foi possível comunicar com o servidor.');}
    finally{setLoading(false);}
  }
  return <div className="login-page">
    <section className="login-brand"><div className="login-brand-inner">
      <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div></div>
      <h1>Proteção do acesso administrativo.</h1>
      <p>A redefinição exige uma chave privada configurada no Netlify. O antigo acesso sem senha foi desativado.</p>
    </div></section>
    <section className="login-card-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>CONFIGURAR SENHA SEGURA</small></div></div>
        {done?<>
          <h2>Senha configurada!</h2>
          <p>Entre com sua nova senha. O código de recuperação utilizado não poderá ser reutilizado.</p>
          <button type="button" className="btn btn-primary" style={{width:'100%',height:46}} onClick={()=>navigate('/login',{replace:true})}>Ir para o login</button>
        </>:<>
          <h2>Configurar senha administrativa</h2>
          <p style={{fontSize:13,lineHeight:1.6}}>1. Gere um código seguro abaixo e copie-o. 2. No Netlify, adicione a variável <strong>EVERCLEAN_ADMIN_SETUP_KEY</strong> com esse código e aplique um novo deploy. 3. Volte aqui para criar a senha.</p>
          <div className="field"><label>Código privado de recuperação</label>
            <input type="password" value={setupKey} onChange={e=>setSetupKey(e.target.value)} placeholder="Cole o código cadastrado no Netlify" autoComplete="off" required />
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
            <button type="button" className="btn btn-white btn-sm" onClick={()=>setSetupKey(generateRecoveryKey())}>Gerar código seguro</button>
            <button type="button" className="btn btn-white btn-sm" onClick={copyKey} disabled={!setupKey}><Copy size={15}/>Copiar código</button>
          </div>
          <div className="field"><label>Nova senha (mínimo 12 caracteres)</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" required /></div>
          <div className="field"><label>Confirme a nova senha</label><input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" required /></div>
          {error&&<div className="form-error">{error}</div>}
          <button className="btn btn-primary" style={{width:'100%',height:48}} disabled={loading}><KeyRound size={18}/>{loading?'Salvando...':'Definir senha segura'}</button>
          <button type="button" className="btn" onClick={()=>navigate('/login')} style={{width:'100%',height:42,marginTop:10,background:'#f4f7f6',color:'#315047'}}>Voltar ao login</button>
          <div style={{marginTop:15,display:'flex',gap:8,alignItems:'center',color:'#718087',fontSize:11}}><ShieldCheck size={15}/>Código válido para uma única configuração de senha. Nunca envie o código ou a senha pelo chat.</div>
        </>}
      </form>
    </section>
  </div>;
}
