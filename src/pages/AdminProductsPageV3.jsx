import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowDownUp, BarChart3, Camera, ImagePlus, Link2, LogOut, Package, Pencil, Plus, RefreshCw, Save, ShoppingCart, Trash2, Upload, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getTestToken, logoutTest, testApi } from '../lib/testApi.js';
import './product-admin.css';
import {CatalogSearchFilters} from '../components/UnifiedCatalog.jsx';

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
function MobileNav(){return <nav className="mobile-bottom-nav">{nav.map(item=>{const Icon=item.icon;return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={20}/><span>{item.label}</span></NavLink>})}</nav>}
function Loading(){return <div className="loading"><div><div className="spinner"/>Carregando produtos...</div></div>}
const readFile=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});
const loadImage=src=>new Promise((resolve,reject)=>{const img=new Image();if(/^https?:\/\//i.test(src))img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=reject;img.src=src});

// A prévia e a imagem salva compartilham EXATAMENTE o mesmo cálculo.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
function paintProductImage(canvas,image,{zoom=1,x=50,y=50,mode='contain'}){
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas indisponível neste dispositivo.');
  const size=800,margin=52,usable=size-2*margin;
  if(canvas.width!==size)canvas.width=size;
  if(canvas.height!==size)canvas.height=size;
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,size,size);
  const originalWidth=image.naturalWidth||image.width;
  const originalHeight=image.naturalHeight||image.height;
  if(!originalWidth||!originalHeight)throw new Error('Imagem inválida.');
  const fit=Math.min(usable/originalWidth,usable/originalHeight);
  const fill=Math.max(size/originalWidth,size/originalHeight);
  const scale=(mode==='cover'?fill:fit)*clamp(zoom,.85,2);
  const drawnWidth=originalWidth*scale,drawnHeight=originalHeight*scale;
  const offsetX=(size-drawnWidth)*clamp(x,0,100)/100;
  const offsetY=(size-drawnHeight)*clamp(y,0,100)/100;
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,offsetX,offsetY,drawnWidth,drawnHeight);
}
async function processImage(src,options){
  const img=await loadImage(src);
  const canvas=document.createElement('canvas');
  paintProductImage(canvas,img,options);
  return canvas.toDataURL('image/webp',0.86);
}

export default function AdminProductsPageV3(){
  const navigate=useNavigate();
  const [session,setSession]=React.useState(null);
  const [products,setProducts]=React.useState([]);
  const [loading,setLoading]=React.useState(true);
  const [search,setSearch]=React.useState('');
  const [category,setCategory]=React.useState('Todos');
  const [sortBy,setSortBy]=React.useState('best_sellers');
  const [importMeta,setImportMeta]=React.useState(null);
  const [edit,setEdit]=React.useState(null);
  const [saving,setSaving]=React.useState(false);
  const [deleting,setDeleting]=React.useState('');

  const reload=React.useCallback(async()=>{
    const r=await testApi('bootstrap');
    if(!r?.ok){toast.error(r?.message||'Não foi possível carregar os produtos.');return;}
    setProducts(Array.isArray(r.products)?r.products:[]);
    setImportMeta(r.import_meta||null);
  },[]);
  React.useEffect(()=>{let active=true;(async()=>{if(!getTestToken()){navigate('/login',{replace:true});return;}const auth=await testApi('session');if(!active)return;if(!auth?.ok){logoutTest();navigate('/login',{replace:true});return;}setSession(auth.user);await reload();if(active)setLoading(false)})();return()=>{active=false}},[navigate,reload]);
  function logout(){logoutTest();navigate('/login',{replace:true})}
  async function save(){if(!String(edit?.name||'').trim()){toast.error('Informe o nome do produto.');return;}setSaving(true);const r=await testApi('save_product',{product:edit});setSaving(false);if(!r?.ok){toast.error(r?.message||'Erro ao salvar produto.');return;}toast.success(edit?.id?'Produto atualizado':'Produto cadastrado');setEdit(null);await reload()}
  async function remove(product){if(!window.confirm(`Excluir o produto “${product.name}”?`))return;setDeleting(product.id);const r=await testApi('delete_product',{id:product.id});setDeleting('');if(!r?.ok){toast.error(r?.message||'Não foi possível excluir o produto.');return;}toast.success('Produto excluído');await reload()}
  // O mesmo ranking do catálogo do cliente: vendas históricas por SKU
  // importadas do backup do Bling. Não conta cliques nem carrinhos abandonados.
  const numeric=value=>{
    const n=Number(value);
    return Number.isFinite(n)&&n>0?n:0;
  };
  const productCategory=p=>String(p.category||'').trim()||'Outros';
  const categories=React.useMemo(()=>['Todos',...new Set(products.map(productCategory))]
    .sort((a,b)=>a==='Todos'?-1:b==='Todos'?1:a.localeCompare(b,'pt-BR')),
    [products]);
  const hasSalesHistory=products.some(p=>p.sales_orders_count!=null||
    p.sales_quantity!=null||p.sales_revenue!=null);
  const rows=React.useMemo(()=>{
    const query=search.trim().toLocaleLowerCase('pt-BR');
    const filtered=products.filter(p=>
      (category==='Todos'||productCategory(p)===category)&&
      [p.name,p.sku,p.brand,p.category].some(v=>
        String(v||'').toLocaleLowerCase('pt-BR').includes(query)));
    const byName=(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
    return filtered.sort((a,b)=>{
      if(sortBy==='best_sellers')return numeric(b.sales_orders_count)-
        numeric(a.sales_orders_count)||numeric(b.sales_quantity)-
        numeric(a.sales_quantity)||byName(a,b);
      if(sortBy==='units')return numeric(b.sales_quantity)-
        numeric(a.sales_quantity)||numeric(b.sales_orders_count)-
        numeric(a.sales_orders_count)||byName(a,b);
      if(sortBy==='revenue')return numeric(b.sales_revenue)-
        numeric(a.sales_revenue)||byName(a,b);
      if(sortBy==='category')return productCategory(a).localeCompare(
        productCategory(b),'pt-BR')||byName(a,b);
      if(sortBy==='price_desc')return numeric(b.base_price)-
        numeric(a.base_price)||byName(a,b);
      if(sortBy==='price_asc')return numeric(a.base_price)-
        numeric(b.base_price)||byName(a,b);
      return byName(a,b);
    });
  },[products,search,category,sortBy]);
  const unitsText=n=>numeric(n).toLocaleString('pt-BR',{maximumFractionDigits:2});
  if(loading)return <Loading/>;

  return <div className="layout"><aside className="sidebar"><Brand/><nav className="nav">{nav.map(item=>{const Icon=item.icon;return <NavLink key={item.path} to={item.path} end={item.end}><Icon size={18}/>{item.label}</NavLink>})}</nav><div className="sidebar-foot"><button className="btn" style={{width:'100%'}} onClick={logout}><LogOut size={17}/>Sair</button></div></aside>
    <main className="main"><header className="topbar"><Brand/><div className="topbar-actions"><span className="hide-mobile" style={{fontSize:12,color:'#6d7a80'}}>{session?.email}</span><button className="btn btn-white btn-sm" onClick={logout}><LogOut size={15}/>Sair</button></div></header><div className="content">
      <section className="hero"><div><span className="eyebrow">CATÁLOGO • TESTE</span><h1>Produtos</h1><p>Cadastre, edite, exclua e ajuste as imagens do catálogo.</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-white" onClick={()=>setEdit({...blankProduct})}><Plus size={16}/>Novo produto</button><button className="btn btn-white" onClick={reload}><RefreshCw size={16}/>Atualizar</button></div></section>
      <div className="panel">
        <div style={{padding:'15px 16px 11px',borderBottom:'1px solid #e1e7e9'}}>
          <CatalogSearchFilters search={search} onSearchChange={setSearch}
            category={category} onCategoryChange={setCategory} categories={categories}/>
          <div style={{display:'flex',flexWrap:'wrap',gap:10,
            alignItems:'center',justifyContent:'space-between',marginTop:12}}>
            <label style={{display:'flex',alignItems:'center',gap:9,
              fontWeight:700,fontSize:13,flexWrap:'wrap'}} htmlFor="admin-products-sort">
              <ArrowDownUp size={16} color="#0b7164"/>Ordenar por
              <select id="admin-products-sort" value={sortBy}
                onChange={e=>setSortBy(e.target.value)}
                style={{minWidth:190,maxWidth:'100%',padding:'10px 12px',
                  borderRadius:10,border:'1px solid #d4dfe0',background:'#fff'}}>
                <option value="best_sellers">Mais vendidos · pedidos</option>
                <option value="units">Mais vendidos · unidades</option>
                <option value="revenue">Maior faturamento histórico</option>
                <option value="category">Categoria · A–Z</option>
                <option value="name">Nome · A–Z</option>
                <option value="price_desc">Maior preço</option>
                <option value="price_asc">Menor preço</option>
              </select>
            </label>
            <span className="muted" style={{fontSize:12}}>
              {rows.length} de {products.length} produtos
            </span>
          </div>
          <p className="muted" style={{fontSize:11,lineHeight:1.5,marginTop:10}}>
            {hasSalesHistory
              ?'Ranking calculado a partir do histórico importado do Bling. Não representa vendas em tempo real.'
              :'Sem histórico de vendas importado; a ordenação por vendas ficará disponível quando houver dados.'}
            {importMeta?.backup_date?' Base: '+String(importMeta.backup_date).slice(0,18)+'.':''}
          </p>
        </div>
      <div className="product-admin-grid">{rows.map(p=><article className="product-admin-card" key={p.id}><div className="product-admin-image">{p.image_url?<img src={p.image_url} alt={p.name} style={{objectFit:'contain',background:'#fff',padding:8}}/>:<Package size={42} color="#94a3b8"/>}</div><div className="product-admin-info"><div className="product-admin-name">{p.name}</div><div className="muted">{[p.sku,p.brand,p.unit].filter(Boolean).join(' • ')||'Sem detalhes'}</div><div className="product-admin-meta"><strong>{p.base_price!=null?money(p.base_price):'Sem preço'}</strong><span>{Number(p.stock_quantity||0)} em estoque</span></div><div className="product-admin-badges">
            <span className={`badge ${p.catalog_visible!==false?'green':'red'}`}>
              {p.catalog_visible!==false?'Visível':'Oculto'}
            </span>
            {p.featured&&<span className="badge orange">Destaque</span>}
            {p.on_sale&&<span className="badge orange">Promoção</span>}
          </div>
          {hasSalesHistory&&<div className="muted" style={{fontSize:12,
            marginTop:9,display:'flex',flexWrap:'wrap',gap:9}}>
            <span><strong style={{color:'#0b5d51'}}>
              {unitsText(p.sales_orders_count)}</strong> pedidos no histórico</span>
            <span><strong style={{color:'#0b5d51'}}>
              {unitsText(p.sales_quantity)}</strong> un. vendidas</span>
          </div>}</div><div className="product-admin-actions"><button className="btn btn-white btn-sm" onClick={()=>setEdit({...p})}><Pencil size={15}/>Editar</button><button className="btn btn-white btn-sm product-delete-btn" disabled={deleting===p.id} onClick={()=>remove(p)}><Trash2 size={15}/>{deleting===p.id?'Excluindo...':'Excluir'}</button></div></article>)}</div>{!rows.length&&<div className="empty">Nenhum produto encontrado.</div>}</div>
    </div></main><MobileNav/>{edit&&<ProductModal value={edit} setValue={setEdit} onClose={()=>setEdit(null)} onSave={save} saving={saving}/>}</div>
}

function ProductModal({value,setValue,onClose,onSave,saving}){
  const [sourceFile,setSourceFile]=React.useState(null);
  const [sourcePreview,setSourcePreview]=React.useState('');
  const [editingSavedImage,setEditingSavedImage]=React.useState(false);
  const editingImage=Boolean(sourceFile)||editingSavedImage;
  const [zoom,setZoom]=React.useState(1);
  const [posX,setPosX]=React.useState(50);
  const [posY,setPosY]=React.useState(50);
  const [mode,setMode]=React.useState('contain');
  const [processing,setProcessing]=React.useState(false);
  const previewCanvas=React.useRef(null);
  const [previewError,setPreviewError]=React.useState('');
  React.useEffect(()=>{
    if(!editingImage||!sourcePreview)return;
    let active=true;
    loadImage(sourcePreview).then(image=>{
      if(!active||!previewCanvas.current)return;
      paintProductImage(previewCanvas.current,image,{zoom,x:posX,y:posY,mode});
      setPreviewError('');
    }).catch(()=>{
      if(active)setPreviewError('Não foi possível abrir a foto para edição. Se for uma imagem externa, selecione-a novamente pela Galeria.');
    });
    return()=>{active=false};
  },[editingImage,sourcePreview,zoom,posX,posY,mode]);

  async function chooseImage(event){
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    if(!file.type.startsWith('image/')){toast.error('Selecione uma imagem válida.');return;}
    if(file.size>20*1024*1024){toast.error('A imagem deve ter no máximo 20 MB.');return;}
    try{
      const src=await readFile(file);
      await loadImage(src);
      setPreviewError('');
      setEditingSavedImage(false);
      setSourceFile(file);
      setSourcePreview(src);
      setZoom(1);setPosX(50);setPosY(50);setMode('contain');
    }catch{
      toast.error('Este formato de imagem não é compatível. Tente fotografar em JPG.');
    }
  }
  function editExistingImage(){
    if(!value.image_url)return;
    setSourceFile(null);
    setPreviewError('');
    setZoom(1);setPosX(50);setPosY(50);setMode('contain');
    setSourcePreview(value.image_url);
    setEditingSavedImage(true);
  }
  function exitImageEditor(){
    setSourceFile(null);
    setSourcePreview('');
    setEditingSavedImage(false);
    setPreviewError('');
  }
  async function applyImage(){
    if(!editingImage||!sourcePreview||previewError||processing)return;
    setProcessing(true);
    try{
      const imageUrl=await processImage(sourcePreview,{zoom,x:posX,y:posY,mode});
      setValue(current=>({...current,image_url:imageUrl}));
      exitImageEditor();
      toast.success('Imagem ajustada para 800 × 800 px. Clique em Salvar produto para confirmar.');
    }catch{
      setPreviewError('Não foi possível aplicar a imagem. Se ela vier de outro site, escolha-a pela Galeria.');
    }finally{setProcessing(false)}
  }
  const preview=editingImage?sourcePreview:value.image_url;

  return <div className="modal-backdrop"><div className="modal product-modal-v2"><div className="modal-head"><h3>{editingImage?'Ajustar imagem':value.id?'Editar produto':'Novo produto'}</h3><button className="icon-btn" onClick={onClose}><XCircle size={17}/></button></div><div className="modal-body product-modal-scroll">
    <section className="image-editor-block"><div className="image-editor-title"><div><strong>Imagem do produto</strong><div className="muted">Padrão: <strong>800 × 800 px</strong>. O modo recomendado mantém o produto inteiro.</div></div><div className="product-image-actions">
      <label className="btn btn-primary btn-sm image-upload-label"><Camera size={16}/>Tirar foto<input type="file" accept="image/*" capture="environment" onChange={chooseImage} hidden aria-label="Tirar foto do produto"/></label>
      <label className="btn btn-white btn-sm image-upload-label"><Upload size={15}/>Galeria<input type="file" accept="image/*" onChange={chooseImage} hidden aria-label="Escolher imagem da galeria"/></label>
    </div></div>
      {editingImage&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}><button className={`btn ${mode==='contain'?'btn-primary':'btn-white'}`} onClick={()=>{setMode('contain');setZoom(1)}}>Encaixar inteiro</button><button className={`btn ${mode==='cover'?'btn-primary':'btn-white'}`} onClick={()=>{setMode('cover');setZoom(1)}}>Preencher moldura</button></div>}
      <div className="image-editor-wrap"><div className="image-editor-preview" style={{background:'#fff',overflow:'hidden',aspectRatio:'1',height:'auto',width:'100%',position:'relative'}}>{editingImage?<>
          <canvas ref={previewCanvas} width={800} height={800}
            role="img" aria-label="Prévia exata do enquadramento e posição da imagem"
            style={{display:'block',width:'100%',height:'100%',aspectRatio:'1',
              objectFit:'contain',background:'#fff'}}/>
          {previewError&&<p role="alert" style={{position:'absolute',bottom:5,left:5,
            background:'#fff',color:'#963d2b',fontSize:11,padding:7}}>{previewError}</p>}
        </>:preview?<img src={preview} alt="Prévia"
          style={{display:'block',width:'100%',height:'100%',objectFit:'contain',
            background:'#fff',padding:12}}/>:
          <div className="image-empty"><ImagePlus size={38}/><span>Sem imagem</span></div>}</div><div className="image-editor-controls">{editingImage&&<><label>Zoom<input type="range" min="0.85" max="2" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label><label>Posição horizontal: {posX}%<input type="range" min="0" max="100" step="1" aria-label="Mover imagem horizontalmente" value={posX} onChange={e=>setPosX(Number(e.target.value))}/></label><label>Posição vertical: {posY}%<input type="range" min="0" max="100" step="1" aria-label="Mover imagem verticalmente" value={posY} onChange={e=>setPosY(Number(e.target.value))}/></label><p className="muted" style={{fontSize:11,margin:'8px 0'}}>A prévia mostra exatamente como a foto será salva. Se houver pouco espaço para mover, aumente o zoom.</p></>}{value.image_url&&!editingImage&&<div style={{display:'flex',gap:8,flexWrap:'wrap',width:'100%'}}>
      <button type="button" className="btn btn-primary btn-sm" onClick={editExistingImage}>
        <Pencil size={15}/>Editar imagem
      </button>
      <button type="button" className="btn btn-white btn-sm product-delete-btn"
        onClick={()=>setValue(current=>({...current,image_url:''}))}>
        <Trash2 size={14}/>Remover imagem
      </button>
    </div>}</div></div>
    </section>
    {!editingImage&&<>
    <div className="field"><label>Produto</label><input value={value.name||''} onChange={e=>setValue({...value,name:e.target.value})}/></div><div className="product-edit"><div className="field"><label>SKU</label><input value={value.sku||''} onChange={e=>setValue({...value,sku:e.target.value})}/></div><div className="field"><label>Categoria</label><input value={value.category||''} onChange={e=>setValue({...value,category:e.target.value})}/></div></div><div className="product-edit"><div className="field"><label>Unidade</label><input value={value.unit||''} onChange={e=>setValue({...value,unit:e.target.value})}/></div><div className="field"><label>Marca</label><input value={value.brand||''} onChange={e=>setValue({...value,brand:e.target.value})}/></div></div><div className="product-edit"><div className="field"><label>Preço</label><input type="number" step="0.01" min="0" value={value.base_price??''} onChange={e=>setValue({...value,base_price:e.target.value})}/></div><div className="field"><label>Estoque</label><input type="number" min="0" value={value.stock_quantity??0} onChange={e=>setValue({...value,stock_quantity:e.target.value})}/></div></div>
    <div className="product-options"><label className="switch"><input type="checkbox" checked={value.active!==false} onChange={e=>setValue({...value,active:e.target.checked})}/> Produto ativo</label><label className="switch"><input type="checkbox" checked={value.catalog_visible!==false} onChange={e=>setValue({...value,catalog_visible:e.target.checked})}/> Exibir no catálogo</label><label className="switch"><input type="checkbox" checked={value.catalog_show_stock!==false} onChange={e=>setValue({...value,catalog_show_stock:e.target.checked})}/> Exibir estoque</label><label className="switch"><input type="checkbox" checked={value.catalog_allow_backorder!==false} onChange={e=>setValue({...value,catalog_allow_backorder:e.target.checked})}/> Permitir sob encomenda</label><label className="switch"><input type="checkbox" checked={Boolean(value.featured)} onChange={e=>setValue({...value,featured:e.target.checked})}/> Destaque / sugerido</label><label className="switch"><input type="checkbox" checked={Boolean(value.on_sale)} onChange={e=>setValue({...value,on_sale:e.target.checked})}/> Em promoção</label></div>
    </>}
  </div><div className="modal-foot">
    {editingImage?<>
      <button type="button" className="btn btn-white" onClick={exitImageEditor}
        disabled={processing}>Voltar sem aplicar</button>
      <button type="button" className="btn btn-primary" onClick={applyImage}
        disabled={processing||!!previewError}>
        <Save size={16}/>{processing?'Ajustando...':'Aplicar imagem'}
      </button>
    </>:<>
      <button type="button" className="btn btn-white" onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={onSave}
        disabled={saving||processing}><Save size={16}/>{saving?'Salvando...':'Salvar produto'}</button>
    </>}
  </div></div></div>
}
