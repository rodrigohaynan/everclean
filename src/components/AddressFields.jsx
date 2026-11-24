import {useState} from 'react';
import {UFS,lookupCep,normalizeAddress} from '../lib/address.js';

// Campos de endereço completo. Ao digitar o CEP, preenche rua, bairro, cidade e
// UF pela consulta pública (ViaCEP); se a consulta falhar, o cliente digita.
export default function AddressFields({value,onChange,disabled=false,missing=[]}){
  const address=value||{};
  const [lookingUp,setLookingUp]=useState(false);
  const set=(field,fieldValue)=>onChange({...address,[field]:fieldValue});
  const flag=label=>missing.includes(label)?{borderColor:'#c2410c'}:undefined;
  async function cepChanged(raw){
    const masked=String(raw).replace(/\D/g,'').slice(0,8);
    const next={...address,cep:masked.length>5?masked.slice(0,5)+'-'+masked.slice(5):masked};
    onChange(next);
    if(masked.length!==8)return;
    setLookingUp(true);
    const found=await lookupCep(masked);
    setLookingUp(false);
    if(found)onChange({...next,
      street:found.street||next.street||'',district:found.district||next.district||'',
      city:found.city||next.city||'',uf:found.uf||next.uf||''});
  }
  const normalizedUf=normalizeAddress(address).uf;
  return <div className="address-fields">
    <div className="product-edit">
      <div className="field"><label>CEP</label>
        <input inputMode="numeric" autoComplete="postal-code" value={address.cep||''} disabled={disabled}
          style={flag('CEP')} placeholder="00000-000" onChange={e=>cepChanged(e.target.value)}/>
        {lookingUp&&<span className="muted" style={{fontSize:11}}>Buscando endereço…</span>}
      </div>
      <div className="field"><label>Número</label>
        <input value={address.number||''} disabled={disabled} style={flag('número')}
          placeholder="Ex.: 120 ou S/N" onChange={e=>set('number',e.target.value)}/></div>
    </div>
    <div className="field"><label>Rua / avenida</label>
      <input autoComplete="address-line1" value={address.street||''} disabled={disabled} style={flag('rua')}
        onChange={e=>set('street',e.target.value)}/></div>
    <div className="product-edit">
      <div className="field"><label>Complemento (opcional)</label>
        <input value={address.complement||''} disabled={disabled} placeholder="Sala, bloco, referência"
          onChange={e=>set('complement',e.target.value)}/></div>
      <div className="field"><label>Bairro</label>
        <input value={address.district||''} disabled={disabled} style={flag('bairro')}
          onChange={e=>set('district',e.target.value)}/></div>
    </div>
    <div className="product-edit">
      <div className="field"><label>Cidade</label>
        <input autoComplete="address-level2" value={address.city||''} disabled={disabled} style={flag('cidade')}
          onChange={e=>set('city',e.target.value)}/></div>
      <div className="field"><label>UF</label>
        <select value={normalizedUf} disabled={disabled} style={flag('UF')} onChange={e=>set('uf',e.target.value)}>
          <option value="">Selecione</option>
          {UFS.map(uf=><option key={uf} value={uf}>{uf}</option>)}
        </select></div>
    </div>
  </div>;
}
