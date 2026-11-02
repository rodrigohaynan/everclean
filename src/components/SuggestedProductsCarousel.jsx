import React from 'react';
import { useParams } from 'react-router-dom';
import { PackageCheck, Plus, RotateCcw, Sparkles } from 'lucide-react';
import { testApi } from '../lib/testApi.js';

const money=(value)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));
const labelMap={history:'Você já comprou',similar:'Relacionado',featured:'Destaque',fallback:'Pode complementar'};

export default function SuggestedProductsCarousel({items=[],onAdd}){
  const {token}=useParams();
  const [fallbackItems,setFallbackItems]=React.useState([]);

  React.useEffect(()=>{
    if(items.length||!token){setFallbackItems([]);return;}
    let active=true;
    testApi('catalog',{token},{auth:false}).then(payload=>{
      if(!active||!payload?.ok)return;
      const source=(payload.suggestions?.length?payload.suggestions:payload.products)||[];
      const normalized=source.slice(0,10).map(item=>({...item,suggestion_type:item.suggestion_type||'fallback'}));
      setFallbackItems(normalized);
    }).catch(()=>{});
    return()=>{active=false};
  },[items,token]);

  const displayItems=items.length?items:fallbackItems;
  if(!displayItems.length)return null;

  return <section className="panel" style={{marginBottom:16,overflow:'hidden'}}>
    <div className="panel-head" style={{display:'block'}}>
      <h2 style={{display:'flex',alignItems:'center',gap:8,margin:0}}><Sparkles size={18}/>Sugestões para adicionar</h2>
      <div className="muted" style={{fontSize:11,marginTop:4}}>Itens do seu histórico, produtos relacionados e destaques da Ever Clean.</div>
    </div>
    <div style={{display:'flex',gap:12,overflowX:'auto',padding:'14px 16px 18px',scrollSnapType:'x mandatory',WebkitOverflowScrolling:'touch'}}>
      {displayItems.map(item=><article key={item.id} style={{flex:'0 0 190px',scrollSnapAlign:'start',border:'1px solid #e1e7ea',borderRadius:16,background:'#fff',padding:12,boxShadow:'0 2px 8px rgba(15,23,42,.04)'}}>
        <div style={{height:108,borderRadius:12,background:'#fff',border:'1px solid #edf1f3',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',marginBottom:10}}>
          {item.image_url?<img src={item.image_url} alt={item.name} loading="lazy" style={{width:'100%',height:'100%',objectFit:'contain',padding:5}}/>:<PackageCheck size={38} color="#88aaa5"/>}
        </div>
        <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10,fontWeight:800,padding:'4px 7px',borderRadius:999,background:item.suggestion_type==='featured'?'#fff3d8':'#ecf8f5',color:item.suggestion_type==='featured'?'#8a5800':'#0b665c',marginBottom:7}}>{item.suggestion_type==='history'?<RotateCcw size={10}/>:<Sparkles size={10}/>} {labelMap[item.suggestion_type]||'Sugestão'}</span>
        <div style={{fontSize:13,fontWeight:800,lineHeight:1.25,minHeight:34,color:'#0f172a'}}>{item.name}</div>
        <div className="muted" style={{fontSize:10,marginTop:4}}>{[item.brand,item.unit].filter(Boolean).join(' • ')||'Produto Ever Clean'}</div>
        <div style={{fontSize:16,fontWeight:900,color:'#0b4f48',margin:'9px 0'}}>{money(item.base_price)}</div>
        <button className="btn btn-primary btn-sm" style={{width:'100%',justifyContent:'center'}} onClick={()=>onAdd(item)}><Plus size={14}/>Adicionar +1</button>
      </article>)}
    </div>
  </section>;
}
