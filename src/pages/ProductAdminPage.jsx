import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ImagePlus, LogOut, Package, Pencil, Plus, RefreshCw, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { getTestToken, logoutTest, testApi } from '../lib/testApi.js';
import './product-admin.css';

const money=(v)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));

function Brand(){return <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>AMBIENTE DE TESTES</small></div></div>}

function cropToSquare(file,{zoom=1,x=50,y=50}={}){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const size=800;
        const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);
        const base=Math.max(size/img.width,size/img.height);
        const scale=base*zoom;
        const dw=img.width*scale,dh=img.height*scale;
        const overflowX=Math.max(0,dw-size),overflowY=Math.max(0,dh-size);
        const dx=-(overflowX*(x/100));
        const dy=-(overflowY*(y/100));
        ctx.drawImage(img,dx,dy,dw,dh);
        resolve(canvas.toDataURL('image/webp',0.84));
      };
      img.onerror=reject;img.src=reader.result;
    };
    reader.onerror=reject;reader.readAsDataURL(file);
  });
}

export default function ProductAdminPage(){
  const navigate=useNavigate();
  const [products,setProducts]=React.useState([]);
  const [loading,setLoading]=React.useState(true);
  const [search,setSearch]=React.useState('');
  const [edit,setEdit]=React.useState(null);
  const [saving,setSaving]=React.useState(false);
  const [deleting,setDeleting]=React.useState('');

  const load=React.useCallback(async()=>{
    if(!getTestToken()){navigate('/login',{replace:true});return;}
    const res=await testApi('bootstrap');
    if(!res?.ok){toast.error(res?.message||'Não foi possível carregar produtos.');return;}
    setProducts(res.products||[]);setLoading(false);
  },[navigate]);
  React.useEffect(()=>{load()},[load]);

  const rows=products.filter(p=>`${p.name||''} ${p.sku||''} ${p.brand||''}`.toLowerCase().includes(search.toLowerCase()));
  const blank={name:'',sku:'',brand:'',category:'',unit:'',base_price:'',stock_quantity:0,image_url:'',active:true,catalog_visible:true,catalog_show_stock:true,catalog_allow_backorder:true,featured:false};

  async function save(){
    if(!edit?.name?.trim()){toast.error('Informe o nome do produto');return;}
    setSaving(true);const res=await testApi('save_product',{product:edit});setSaving(false);
    if(!res?.ok){toast.error(res?.message||'Erro ao salvar produto');return;}
    toast.success('Produto salvo');setEdit(null);await load();
  }

  async function remove(product){
    if(!window.confirm(`Excluir o produto “${product.name}”? Esta ação remove o produto do catálogo de testes.`))return;
    setDeleting(product.id);const res=await testApi('delete_product',{id:product.id});setDeleting('');
    if(!res?.ok){toast.error(res?.message||'Erro ao excluir produto');return;}
    toast.success('Produto excluído');await load();
  }

  function logout(){logoutTest();navigate('/login',{replace:true})}

  if(loading)return <div className="loading"><div><div className="spinner"/>Carregando produtos...</div></div>;

  return <div className="product-admin-page">
    <header className="topbar product-admin-topbar"><Brand/><div className="topbar-actions"><button className="btn btn-white btn-sm" onClick={()=>navigate('/admin')}><ArrowLeft size={15}/>Painel</button><button className="btn btn-white btn-sm" onClick={logout}><LogOut size={15}/>Sair</button></div></header>
    <main className="content product-admin-content">
      <section className="hero"><div><span className="eyebrow">CATÁLOGO • TESTE</span><h1>Produtos</h1><p>Cadastre, edite, exclua e defina a imagem exibida no catálogo.</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-white" onClick={()=>setEdit({...blank})}><Plus size={16}/>Novo produto</button><button className="btn btn-white" onClick={load}><RefreshCw size={16}/>Atualizar</button></div></section>

      <div className="panel"><div className="panel-head"><div style={{position:'relative',width:'100%'}}><Search size={16} style={{position:'absolute',left:12,top:13,color:'#819096'}}/><input className="search" style={{paddingLeft:36,width:'100%'}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, marca ou SKU..."/></div></div>
      <div className="product-admin-grid">{rows.map(p=><article className="product-admin-card" key={p.id}>
        <div className="product-admin-image">{p.image_url?<img src={p.image_url} alt={p.name}/>:<Package size={42} color="#91a5ad"/>}</div>
        <div className="product-admin-info"><div className="product-admin-name">{p.name}</div><div className="muted">{[p.sku,p.brand,p.unit].filter(Boolean).join(' • ')||'Sem detalhes'}</div><div className="product-admin-meta"><strong>{p.base_price!=null?money(p.base_price):'Sem preço'}</strong><span>{Number(p.stock_quantity||0)} em estoque</span></div><div className="product-admin-badges"><span className={`badge ${p.catalog_visible!==false?'green':'red'}`}>{p.catalog_visible!==false?'Visível':'Oculto'}</span>{p.featured&&<span className="badge orange">Destaque</span>}</div></div>
        <div className="product-admin-actions"><button className="btn btn-white btn-sm" onClick={()=>setEdit({...p})}><Pencil size={15}/>Editar</button><button className="btn btn-white btn-sm product-delete-btn" disabled={deleting===p.id} onClick={()=>remove(p)}><Trash2 size={15}/>{deleting===p.id?'Excluindo...':'Excluir'}</button></div>
      </article>)}</div>{!rows.length&&<div className="empty">Nenhum produto encontrado.</div>}</div>
    </main>
    {edit&&<ProductModal value={edit} setValue={setEdit} onClose={()=>setEdit(null)} onSave={save} saving={saving}/>} 
  </div>;
}

function ProductModal({value,setValue,onClose,onSave,saving}){
  const [sourceFile,setSourceFile]=React.useState(null);
  const [preview,setPreview]=React.useState(value.image_url||'');
  const [zoom,setZoom]=React.useState(1);
  const [posX,setPosX]=React.useState(50);
  const [posY,setPosY]=React.useState(50);
  const [processing,setProcessing]=React.useState(false);

  async function chooseFile(e){
    const file=e.target.files?.[0];if(!file)return;
    if(!file.type.startsWith('image/')){toast.error('Selecione uma imagem válida.');return;}
    if(file.size>8*1024*1024){toast.error('A imagem original deve ter no máximo 8 MB.');return;}
    setSourceFile(file);const reader=new FileReader();reader.onload=()=>setPreview(reader.result);reader.readAsDataURL(file);
    setZoom(1);setPosX(50);setPosY(50);
  }

  async function applyImage(){
    if(!sourceFile)return;
    setProcessing(true);
    try{const dataUrl=await cropToSquare(sourceFile,{zoom,x:posX,y:posY});setValue({...value,image_url:dataUrl});setPreview(dataUrl);setSourceFile(null);toast.success('Imagem ajustada para 800×800 px');}
    catch{toast.error('Não foi possível processar a imagem.');}
    finally{setProcessing(false)}
  }

  function removeImage(){setSourceFile(null);setPreview('');setValue({...value,image_url:''})}

  return <div className="modal-backdrop"><div className="modal product-modal-v2"><div className="modal-head"><h3>{value.id?'Editar produto':'Novo produto'}</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div><div className="modal-body product-modal-scroll">
    <section className="image-editor-block"><div className="image-editor-title"><div><strong>Imagem do produto</strong><div className="muted">Padrão final: 800 × 800 px, formato quadrado.</div></div><label className="btn btn-white btn-sm image-upload-label"><Upload size={15}/>Escolher imagem<input type="file" accept="image/*" onChange={chooseFile} hidden/></label></div>
      <div className="image-editor-wrap"><div className="image-editor-preview">{preview?<img src={preview} alt="Prévia" style={sourceFile?{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${zoom})`,transformOrigin:`${posX}% ${posY}%`}:{width:'100%',height:'100%',objectFit:'cover'}}/>:<div className="image-empty"><ImagePlus size={38}/><span>Adicione uma imagem</span></div>}</div>
      <div className="image-editor-controls">{sourceFile&&<><label>Zoom <input type="range" min="1" max="2.5" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label><label>Horizontal <input type="range" min="0" max="100" value={posX} onChange={e=>setPosX(Number(e.target.value))}/></label><label>Vertical <input type="range" min="0" max="100" value={posY} onChange={e=>setPosY(Number(e.target.value))}/></label><button className="btn btn-primary btn-sm" onClick={applyImage} disabled={processing}><Save size={14}/>{processing?'Ajustando...':'Aplicar recorte'}</button></>}{preview&&<button className="btn btn-white btn-sm product-delete-btn" onClick={removeImage}><Trash2 size={14}/>Remover imagem</button>}</div></div>
    </section>

    <div className="field"><label>Produto</label><input value={value.name||''} onChange={e=>setValue({...value,name:e.target.value})}/></div>
    <div className="product-edit"><div className="field"><label>SKU</label><input value={value.sku||''} onChange={e=>setValue({...value,sku:e.target.value})}/></div><div className="field"><label>Categoria</label><input value={value.category||''} onChange={e=>setValue({...value,category:e.target.value})}/></div></div>
    <div className="product-edit"><div className="field"><label>Unidade</label><input value={value.unit||''} onChange={e=>setValue({...value,unit:e.target.value})}/></div><div className="field"><label>Marca</label><input value={value.brand||''} onChange={e=>setValue({...value,brand:e.target.value})}/></div></div>
    <div className="product-edit"><div className="field"><label>Preço</label><input type="number" step="0.01" min="0" value={value.base_price??''} onChange={e=>setValue({...value,base_price:e.target.value})}/></div><div className="field"><label>Estoque</label><input type="number" min="0" value={value.stock_quantity??0} onChange={e=>setValue({...value,stock_quantity:e.target.value})}/></div></div>
    <div className="product-options"><label className="switch"><input type="checkbox" checked={value.active!==false} onChange={e=>setValue({...value,active:e.target.checked})}/> Produto ativo</label><label className="switch"><input type="checkbox" checked={value.catalog_visible!==false} onChange={e=>setValue({...value,catalog_visible:e.target.checked})}/> Exibir no catálogo</label><label className="switch"><input type="checkbox" checked={value.catalog_show_stock!==false} onChange={e=>setValue({...value,catalog_show_stock:e.target.checked})}/> Exibir estoque</label><label className="switch"><input type="checkbox" checked={value.catalog_allow_backorder!==false} onChange={e=>setValue({...value,catalog_allow_backorder:e.target.checked})}/> Permitir sob encomenda</label><label className="switch"><input type="checkbox" checked={Boolean(value.featured)} onChange={e=>setValue({...value,featured:e.target.checked})}/> Marcar como destaque / promoção</label></div>
  </div><div className="modal-foot"><button className="btn btn-white" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={onSave} disabled={saving||processing||Boolean(sourceFile)}><Save size={16}/>{sourceFile?'Aplique o recorte':saving?'Salvando...':'Salvar produto'}</button></div></div></div>;
}
