import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { BarChart3, ImagePlus, Link2, LogOut, Package, Pencil, Plus, RefreshCw, Save, Search, ShoppingCart, Trash2, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getTestToken, logoutTest, testApi } from '../lib/testApi.js';

const nav=[
  {path:'/admin',label:'Painel',icon:BarChart3,end:true},
  {path:'/admin/clientes',label:'Clientes',icon:Users},
  {path:'/admin/produtos',label:'Produtos',icon:Package},
  {path:'/admin/pedidos',label:'Pedidos',icon:ShoppingCart},
  {path:'/admin/links-pedido',label:'Links',icon:Link2},
];
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const blankProduct={name:'',sku:'',brand:'',category:'',unit:'',base_price:'',stock_quantity:0,image_url:'',active:true,catalog_visible:true,catalog_show_price:true,catalog_show_stock:true,catalog_allow_backorder:true,featured:false,on_sale:false};

function Brand(){return <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>AMBIENTE DE TESTES</small></div></div>}
function MobileNav(){return <nav className="mobile-bottom-nav" aria-label="Navegação principal">{nav.map(item=>{const Icon=item.icon;return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={20}/><span>{item.label}</span></NavLink>})}</nav>}
function Loading(){return <div className="loading"><div><div className="spinner"/>Carregando produtos...</div></div>}

async function normalizeImage(file){
  if(!file)return '';
  if(!file.type.startsWith('image/'))throw new Error('Selecione uma imagem válida.');
  if(file.size>8*1024*1024)throw new Error('A imagem original deve ter no máximo 8 MB.');
  const objectUrl=URL.createObjectURL(file);
  try{
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Não foi possível abrir a imagem.'));img.src=objectUrl;});
    const size=1200;
    const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,size,size);
    const scale=Math.min(size/image.naturalWidth,size/image.naturalHeight);
    const width=Math.round(image.naturalWidth*scale),height=Math.round(image.naturalHeight*scale);
    const x=Math.round((size-width)/2),y=Math.round((size-height)/2);
    ctx.drawImage(image,x,y,width,height);
    return canvas.toDataURL('image/jpeg',0.86);
  } finally {URL.revokeObjectURL(objectUrl)}
}

export default function AdminProductsPageV2(){
  const navigate=useNavigate();
  const [session,setSession]=React.useState(null);
  const [products,setProducts]=React.useState([]);
  const [loading,setLoading]=React.useState(true);
  const [search,setSearch]=React.useState('');
  const [edit,setEdit]=React.useState(null);
  const [saving,setSaving]=React.useState(false);
  const [deleting,setDeleting]=React.useState('');

  const reload=React.useCallback(async()=>{
    const response=await testApi('bootstrap');
    if(!response?.ok){toast.error(response?.message||'Não foi possível carregar os produtos.');return;}
    setProducts(response.products||[]);
  },[]);

  React.useEffect(()=>{let active=true;(async()=>{
    if(!getTestToken()){navigate('/login',{replace:true});return;}
    const auth=await testApi('session');
    if(!active)return;
    if(!auth?.ok){logoutTest();navigate('/login',{replace:true});return;}
    setSession(auth.user);await reload();if(active)setLoading(false);
  })();return()=>{active=false}},[navigate,reload]);

  function logout(){logoutTest();navigate('/login',{replace:true})}
  async function save(){
    if(!String(edit?.name||'').trim()){toast.error('Informe o nome do produto.');return;}
    setSaving(true);const res=await testApi('save_product',{product:edit});setSaving(false);
    if(!res?.ok){toast.error(res?.message||'Erro ao salvar produto.');return;}
    toast.success(edit?.id?'Produto atualizado':'Produto cadastrado');setEdit(null);await reload();
  }
  async function remove(product){
    if(!window.confirm(`Excluir o produto “${product.name}”?\n\nEle deixará de aparecer no catálogo, mas pedidos antigos mantêm o registro histórico.`))return;
    setDeleting(product.id);const res=await testApi('delete_product',{id:product.id});setDeleting('');
    if(!res?.ok){toast.error(res?.message||'Não foi possível excluir o produto.');return;}
    toast.success('Produto excluído');await reload();
  }
  async function chooseImage(event){
    const file=event.target.files?.[0];if(!file)return;
    try{const imageUrl=await normalizeImage(file);setEdit(current=>({...current,image_url:imageUrl}));toast.success('Imagem ajustada para 1200 × 1200 px.');}
    catch(error){toast.error(error.message||'Erro ao processar imagem.');}
    event.target.value='';
  }

  if(loading)return <Loading/>;
  const rows=products.filter(p=>`${p.name||''} ${p.sku||''} ${p.brand||''} ${p.category||''}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="layout">
    <aside className="sidebar"><Brand/><nav className="nav">{nav.map(item=>{const Icon=item.icon;return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={18}/>{item.label}</NavLink>})}</nav><div className="sidebar-foot"><button className="btn" style={{width:'100%',background:'transparent',color:'#d8ebe8',justifyContent:'flex-start'}} onClick={logout}><LogOut size={17}/> Sair</button></div></aside>
    <main className="main"><header className="topbar"><Brand/><div className="topbar-actions"><span className="hide-mobile" style={{fontSize:12,color:'#6d7a80'}}>{session?.email}</span><button className="btn btn-white btn-sm" onClick={logout}><LogOut size={15}/> Sair</button></div></header>
      <div className="content">
        <section className="hero"><div><span className="eyebrow">CATÁLOGO • TESTE</span><h1>Produtos</h1><p>Cadastre, edite, exclua e mantenha as imagens do catálogo padronizadas.</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-white" onClick={()=>setEdit({...blankProduct})}><Plus size={16}/>Novo produto</button><button className="btn btn-white" onClick={reload}><RefreshCw size={16}/>Atualizar</button></div></section>
        <div className="panel"><div className="panel-head"><div style={{position:'relative',width:'100%',maxWidth:420}}><Search size={16} style={{position:'absolute',left:12,top:13,color:'#819096'}}/><input className="search" style={{paddingLeft:36,width:'100%'}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, marca, categoria ou SKU..."/></div></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Imagem</th><th>Produto</th><th>Preço</th><th>Estoque</th><th>Catálogo</th><th style={{textAlign:'right'}}>Ações</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><div style={{width:58,height:58,border:'1px solid #e2e8f0',borderRadius:10,background:'#fff',display:'grid',placeItems:'center',overflow:'hidden'}}>{p.image_url?<img src={p.image_url} alt={p.name} style={{width:'100%',height:'100%',objectFit:'contain',padding:3}}/>:<Package size={24} color="#94a3b8"/>}</div></td><td><strong>{p.name}</strong><div className="muted" style={{fontSize:11}}>{[p.sku,p.brand,p.unit].filter(Boolean).join(' • ')}</div></td><td>{p.base_price!==''&&p.base_price!=null?money(p.base_price):'—'}</td><td>{Number(p.stock_quantity||0)}</td><td><span className={`badge ${p.catalog_visible!==false?'green':'red'}`}>{p.catalog_visible!==false?'Visível':'Oculto'}</span></td><td><div className="actions"><button className="icon-btn" title="Editar produto" onClick={()=>setEdit({...p})}><Pencil size={15}/></button><button className="icon-btn" title="Excluir produto" disabled={deleting===p.id} onClick={()=>remove(p)} style={{color:'#b42318'}}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">Nenhum produto encontrado.</div>}</div>
        </div>
      </div>
    </main><MobileNav/>

    {edit&&<div className="modal-backdrop"><div className="modal" style={{maxWidth:760}}><div className="modal-head"><h3>{edit.id?'Editar produto':'Novo produto'}</h3><button className="icon-btn" onClick={()=>setEdit(null)}><XCircle size={17}/></button></div><div className="modal-body">
      <div style={{display:'grid',gridTemplateColumns:'minmax(170px,230px) 1fr',gap:20,alignItems:'start'}} className="product-image-editor">
        <div><div style={{width:'100%',aspectRatio:'1 / 1',border:'1px solid #dbe3ea',borderRadius:16,background:'#fff',display:'grid',placeItems:'center',overflow:'hidden'}}>{edit.image_url?<img src={edit.image_url} alt="Prévia" style={{width:'100%',height:'100%',objectFit:'contain',padding:8}}/>:<div style={{textAlign:'center',color:'#64748b',padding:18}}><ImagePlus size={36}/><div style={{fontSize:12,marginTop:8}}>Sem imagem</div></div>}</div><label className="btn btn-white" style={{width:'100%',marginTop:10,cursor:'pointer'}}><ImagePlus size={16}/>Selecionar imagem<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseImage} style={{display:'none'}}/></label>{edit.image_url&&<button className="btn" style={{width:'100%',marginTop:8,color:'#b42318',background:'#fff5f4'}} onClick={()=>setEdit({...edit,image_url:''})}><Trash2 size={15}/>Remover imagem</button>}<div className="muted" style={{fontSize:11,lineHeight:1.45,marginTop:10}}>Padrão do catálogo: <strong>1200 × 1200 px</strong>. JPG, PNG ou WebP, até 8 MB. A imagem é centralizada e ajustada sem cortar o produto.</div></div>
        <div><div className="field"><label>Produto</label><input value={edit.name||''} onChange={e=>setEdit({...edit,name:e.target.value})}/></div><div className="product-edit"><div className="field"><label>SKU</label><input value={edit.sku||''} onChange={e=>setEdit({...edit,sku:e.target.value})}/></div><div className="field"><label>Categoria</label><input value={edit.category||''} onChange={e=>setEdit({...edit,category:e.target.value})}/></div></div><div className="product-edit"><div className="field"><label>Unidade</label><input value={edit.unit||''} onChange={e=>setEdit({...edit,unit:e.target.value})}/></div><div className="field"><label>Marca</label><input value={edit.brand||''} onChange={e=>setEdit({...edit,brand:e.target.value})}/></div></div><div className="product-edit"><div className="field"><label>Preço de referência</label><input type="number" step="0.01" min="0" value={edit.base_price??''} onChange={e=>setEdit({...edit,base_price:e.target.value})}/></div><div className="field"><label>Estoque</label><input type="number" min="0" value={edit.stock_quantity??0} onChange={e=>setEdit({...edit,stock_quantity:e.target.value})}/></div></div></div>
      </div>
      <div style={{display:'grid',gap:11,marginTop:18}}><label className="switch"><input type="checkbox" checked={edit.active!==false} onChange={e=>setEdit({...edit,active:e.target.checked})}/> Produto ativo</label><label className="switch"><input type="checkbox" checked={edit.catalog_visible!==false} onChange={e=>setEdit({...edit,catalog_visible:e.target.checked})}/> Exibir no catálogo</label><label className="switch"><input type="checkbox" checked={edit.catalog_show_stock!==false} onChange={e=>setEdit({...edit,catalog_show_stock:e.target.checked})}/> Exibir estoque</label><label className="switch"><input type="checkbox" checked={edit.catalog_allow_backorder!==false} onChange={e=>setEdit({...edit,catalog_allow_backorder:e.target.checked})}/> Permitir sob encomenda</label><label className="switch"><input type="checkbox" checked={Boolean(edit.featured)} onChange={e=>setEdit({...edit,featured:e.target.checked})}/> Produto em destaque / sugerido</label><label className="switch"><input type="checkbox" checked={Boolean(edit.on_sale)} onChange={e=>setEdit({...edit,on_sale:e.target.checked})}/> Produto em promoção</label></div>
    </div><div className="modal-foot"><button className="btn btn-white" onClick={()=>setEdit(null)}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={saving}><Save size={16}/>{saving?'Salvando...':'Salvar produto'}</button></div></div></div>}
  </div>;
}
