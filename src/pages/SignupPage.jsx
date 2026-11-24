import React from 'react';
import {Link} from 'react-router-dom';
import {UserPlus, ShieldCheck, CheckCircle2, ArrowLeft} from 'lucide-react';
import AddressFields from '../components/AddressFields.jsx';
import {addressIssues} from '../lib/address.js';
import {maskDocument,validDocument,documentDigits} from '../lib/document.js';

// Cadastro feito pelo próprio cliente. Fica em análise até a Ever Clean
// aprovar no admin; depois o cliente entra em /login com a senha criada aqui.
const empty={legal_name:'',trade_name:'',document:'',email:'',phone:'',
  state_registration:'',notes:'',password:'',confirm:'',website:''};

const maskPhone=v=>{
  const d=String(v).replace(/\D/g,'').slice(0,11);
  if(d.length<=2)return d;
  if(d.length<=6)return '('+d.slice(0,2)+') '+d.slice(2);
  if(d.length<=10)return '('+d.slice(0,2)+') '+d.slice(2,6)+'-'+d.slice(6);
  return '('+d.slice(0,2)+') '+d.slice(2,7)+'-'+d.slice(7);
};

export default function SignupPage(){
  const [form,setForm]=React.useState(empty);
  const [address,setAddress]=React.useState({});
  const [missing,setMissing]=React.useState([]);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [done,setDone]=React.useState('');
  const set=(field,value)=>setForm(f=>({...f,[field]:value}));
  const isCompany=documentDigits(form.document).length>11;

  async function submit(event){
    event.preventDefault();setError('');
    const problems=[];
    if(form.legal_name.trim().length<3)problems.push(isCompany?'razão social':'nome completo');
    if(!validDocument(form.document))problems.push('CPF ou CNPJ válido');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim()))problems.push('e-mail válido');
    if(form.phone.replace(/\D/g,'').length<10)problems.push('WhatsApp com DDD');
    const addr=addressIssues(address);setMissing(addr);
    if(addr.length)problems.push('endereço ('+addr.join(', ')+')');
    if(form.password.length<12)problems.push('senha com pelo menos 12 caracteres');
    else if(form.password!==form.confirm)problems.push('as duas senhas iguais');
    if(problems.length){setError('Confira: '+problems.join('; ')+'.');return;}
    setBusy(true);
    try{
      const response=await fetch('/.netlify/functions/customer-portal',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'signup',...form,confirm:undefined,
          email:form.email.trim(),address})
      });
      const data=await response.json().catch(()=>({ok:false}));
      if(!response.ok||!data?.ok)throw Error(data?.message||'Não foi possível enviar o cadastro.');
      setDone(data.message||'Cadastro enviado.');
      window.scrollTo?.(0,0);
    }catch(err){setError(err.message||'Não foi possível conectar ao servidor.');}
    finally{setBusy(false);}
  }

  const card={width:'100%',maxWidth:560,margin:'0 auto'};
  if(done)return <div className="login-page" style={{gridTemplateColumns:'1fr'}}>
    <section className="login-card-wrap"><div className="login-card" style={card}>
      <div style={{color:'#14734e'}}><CheckCircle2 size={42}/></div>
      <h2>Cadastro enviado</h2>
      <p>{done}</p>
      <p style={{fontSize:13}}>Enquanto o cadastro estiver em análise, ao tentar entrar você verá esse aviso.</p>
      <Link to="/login" className="btn btn-primary" style={{width:'100%',height:46,marginTop:10}}>Ir para o login</Link>
    </div></section>
  </div>;

  return <div className="login-page" style={{gridTemplateColumns:'1fr'}}>
    <section className="login-card-wrap" style={{alignItems:'flex-start'}}>
      <form className="login-card" style={card} onSubmit={submit} noValidate>
        <Link to="/login" style={{display:'inline-flex',gap:6,alignItems:'center',fontSize:13,color:'#315047'}}>
          <ArrowLeft size={15}/>Voltar ao login</Link>
        <h2>Criar cadastro</h2>
        <p>Preencha seus dados. A Ever Clean confere e libera seu acesso; depois é só entrar com seu e-mail e senha.</p>

        <div className="field"><label>CPF ou CNPJ</label>
          <input inputMode="numeric" value={form.document} placeholder="000.000.000-00"
            onChange={e=>set('document',maskDocument(e.target.value))}/></div>
        <div className="field"><label>{isCompany?'Razão social':'Nome completo'}</label>
          <input autoComplete={isCompany?'organization':'name'} value={form.legal_name}
            onChange={e=>set('legal_name',e.target.value)}/></div>
        {isCompany&&<div className="product-edit">
          <div className="field"><label>Nome fantasia (opcional)</label>
            <input value={form.trade_name} onChange={e=>set('trade_name',e.target.value)}/></div>
          <div className="field"><label>Inscrição estadual (opcional)</label>
            <input value={form.state_registration} placeholder="Número ou ISENTO"
              onChange={e=>set('state_registration',e.target.value)}/></div>
        </div>}
        <div className="product-edit">
          <div className="field"><label>E-mail</label>
            <input type="email" autoComplete="email" value={form.email}
              onChange={e=>set('email',e.target.value)}/></div>
          <div className="field"><label>WhatsApp</label>
            <input inputMode="tel" autoComplete="tel" value={form.phone} placeholder="(67) 99999-9999"
              onChange={e=>set('phone',maskPhone(e.target.value))}/></div>
        </div>

        <div style={{borderTop:'1px solid #e3ebe6',marginTop:14,paddingTop:10}}>
          <strong style={{fontSize:14}}>Endereço</strong>
          <p className="muted" style={{fontSize:12,margin:'2px 0 6px'}}>Usado na entrega e na nota fiscal.</p>
          <AddressFields value={address} missing={missing}
            onChange={value=>{setAddress(value);if(missing.length)setMissing(addressIssues(value));}}/>
        </div>

        <div className="field"><label>Observação (opcional)</label>
          <input value={form.notes} maxLength={240} placeholder="Ex.: indicado por…, tipo de estabelecimento"
            onChange={e=>set('notes',e.target.value)}/></div>

        <div style={{borderTop:'1px solid #e3ebe6',marginTop:14,paddingTop:10}}>
          <strong style={{fontSize:14}}>Senha de acesso</strong>
          <div className="product-edit">
            <div className="field"><label>Senha (mín. 12 caracteres)</label>
              <input type="password" autoComplete="new-password" value={form.password}
                onChange={e=>set('password',e.target.value)}/></div>
            <div className="field"><label>Repita a senha</label>
              <input type="password" autoComplete="new-password" value={form.confirm}
                onChange={e=>set('confirm',e.target.value)}/></div>
          </div>
        </div>
        {/* Campo escondido contra robôs. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={form.website}
          onChange={e=>set('website',e.target.value)}
          style={{position:'absolute',left:'-9999px',width:1,height:1,opacity:0}} aria-hidden="true"/>

        {error&&<div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary" style={{width:'100%',height:48,marginTop:8}} disabled={busy}>
          <UserPlus size={18}/>{busy?'Enviando...':'Enviar cadastro'}</button>
        <div style={{marginTop:14,display:'flex',gap:8,alignItems:'center',color:'#718087',fontSize:11}}>
          <ShieldCheck size={15}/>Seus dados são usados só para atendimento, entrega e nota fiscal.</div>
      </form>
    </section>
  </div>;
}
