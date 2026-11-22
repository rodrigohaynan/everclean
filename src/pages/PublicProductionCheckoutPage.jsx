import React from 'react';
import {useParams} from 'react-router-dom';
import {ShieldCheck,LockKeyhole,ShoppingCart,RefreshCw} from 'lucide-react';

const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
async function productionApi(action,token,extra={}){
  const response=await fetch('/.netlify/functions/asaas-catalog-production',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,token,...extra})
  });
  const body=await response.json().catch(()=>({ok:false,message:'Resposta inválida.'}));
  if(!response.ok||!body?.ok)throw Error(body.message||'Não foi possível consultar este pedido.');
  return body;
}
export default function PublicProductionCheckoutPage(){
  const {token}=useParams();
  const [catalog,setCatalog]=React.useState(null);
  const [quantities,setQuantities]=React.useState({});
  const [search,setSearch]=React.useState('');
  const [category,setCategory]=React.useState('Todas');
  const [quote,setQuote]=React.useState(null);
  const [validation,setValidation]=React.useState(null);
  const [payment,setPayment]=React.useState(null);
  const [pix,setPix]=React.useState(null);
  const [pixLoading,setPixLoading]=React.useState(false);
  const [pixError,setPixError]=React.useState('');
  const [pixCopied,setPixCopied]=React.useState(false);
  const [status,setStatus]=React.useState(null);
  const [statusReady,setStatusReady]=React.useState(false);
  const [loading,setLoading]=React.useState('');
  const [error,setError]=React.useState('');
  const [confirmed,setConfirmed]=React.useState(false);
  const [submitLocked,setSubmitLocked]=React.useState(false);

  React.useEffect(()=>{
    let live=true;
    // Verificar sempre o registro transacional antes de oferecer nova cobrança.
    Promise.all([productionApi('catalog',token),productionApi('status',token)])
      .then(([data,lookup])=>{
        if(!live)return;
        setCatalog(data);
        if(data?.mode==='general'&&data?.enabled&&Array.isArray(data.approved_items)){
          const bySku=new Map((data.products||[]).map(p=>[String(p.sku),String(p.id)]));
          const initial={};
          for(const approved of data.approved_items){
            const id=bySku.get(String(approved.sku));
            if(id)initial[id]=Number(approved.quantity)||0;
          }
          setQuantities(initial);
        }
        setStatus(lookup.order||null);
        setStatusReady(true);
        if(lookup.order)setSubmitLocked(true);
        // Retoma a MESMA cobrança após atualização de página, sem POST financeiro.
        if(data?.mode==='general'&&lookup.order?.status==='payment_pending'){
          setPixLoading(true);
          productionApi('pix_details',token).then(details=>{
            if(live)setPix(details);
          }).catch(e=>{if(live)setPixError(e.message)}).finally(()=>{
            if(live)setPixLoading(false);
          });
        }
      }).catch(e=>{
        if(live)setError(e.message+' Não é possível iniciar outra cobrança sem consultar o pedido.');
      });
    return()=>{live=false};
  },[token]);
  const items=Object.entries(quantities).filter(([,qty])=>Number(qty)>0)
    .map(([product_id,quantity])=>({product_id,quantity:Number(quantity)}));
  const approvedCart=(catalog?.mode==='general'&&catalog?.enabled&&
    Array.isArray(catalog?.approved_items))?catalog.approved_items:[];
  const approvedAmountCents=Math.round(Number(catalog?.approved_amount||0)*100);
  const approvedQuantityBySku=new Map(approvedCart.map(x=>[
    String(x.sku),Number(x.quantity)
  ]));
  const exactApprovedCart=approvedCart.length>0&&
    items.length===approvedCart.length&&
    approvedCart.every(approved=>{
      const product=(catalog?.products||[]).find(p=>String(p.sku)===String(approved.sku));
      return !!product&&Number(quantities[product.id]||0)===Number(approved.quantity)&&
        Math.round(Number(product.price)*100)===Number(approved.unit_price_cents);
    })&&items.every(item=>{
      const product=(catalog?.products||[]).find(p=>String(p.id)===String(item.product_id));
      return !!product&&approvedQuantityBySku.has(String(product.sku));
    });
  const approvedQuoteReady=exactApprovedCart&&
    Math.round(Number(quote?.amount||0)*100)===approvedAmountCents&&
    Number(quote?.item_count)===approvedCart.length;
  function restoreApprovedCart(){
    if(!catalog?.enabled||catalog?.mode!=='general')return;
    const initial={};
    for(const approved of approvedCart){
      const product=(catalog.products||[]).find(p=>String(p.sku)===String(approved.sku));
      if(product)initial[product.id]=Number(approved.quantity);
    }
    setQuantities(initial);setQuote(null);setValidation(null);setConfirmed(false);
    setSearch('');setCategory('Todas');
  }
  const categories=['Todas',...new Set((catalog?.products||[]).map(p=>p.category).filter(Boolean))];
  const shown=(catalog?.products||[]).filter(p=>
    (!search||`${p.name||''} ${p.sku||''}`.toLowerCase().includes(search.toLowerCase()))&&
    (category==='Todas'||p.category===category));
  async function runQuote(){
    setLoading('quote');setError('');setValidation(null);
    try{setQuote(await productionApi('quote',token,{items}))}
    catch(e){setError(e.message)}
    finally{setLoading('')}
  }
  async function validateWithoutPix(){
    if(!quote||catalog?.mode!=='general'||!items.length)return;
    setLoading('validation');setError('');setValidation(null);
    try{setValidation(await productionApi('validate_checkout',token,{items}))}
    catch(e){setError(e.message)}
    finally{setLoading('')}
  }
  async function loadPix(){
    if(catalog?.mode!=='general')return;
    setPixLoading(true);setPixError('');setPixCopied(false);
    try{setPix(await productionApi('pix_details',token));}
    catch(e){setPix(null);setPixError(e.message||'QR Code indisponível no momento.');}
    finally{setPixLoading(false);}
  }
  async function copyPix(){
    if(!pix?.available||!pix?.copy_paste)return;
    try{
      await navigator.clipboard.writeText(pix.copy_paste);
      setPixCopied(true);setPixError('');
    }catch{
      setPixCopied(false);
      setPixError('Selecione e copie o código PIX abaixo manualmente.');
    }
  }
  async function createPayment(){
    if(!catalog?.enabled||!quote||!confirmed||submitLocked||!statusReady||status||
      (catalog.mode==='general'&&!approvedQuoteReady))return;
    if(!window.confirm('Confirmar criação de cobrança PIX REAL para este pedido?'))return;
    setSubmitLocked(true);setLoading('payment');setError('');
    try{
      const result=await productionApi('create_pix',token,{items});
      setPayment(result);
      // O vínculo financeiro é criado antes do retorno, bloqueando nova emissão.
      const order=(await productionApi('status',token)).order||{
        status:'payment_pending',amount:result.amount
      };
      setStatus(order);
      if(order.status==='payment_pending'&&catalog.mode==='general')await loadPix();
    }
    catch(e){setError(e.message+' Não clique novamente para evitar cobranças duplicadas.')}
    finally{setLoading('')}
  }
  async function refresh(){
    setLoading('status');setError('');
    try{
      const order=(await productionApi('status',token)).order;
      setStatus(order||null);setStatusReady(true);
      if(order)setSubmitLocked(true);
      if(order?.status==='paid'){
        setPix(null);setPixError('');setPayment(null);
      }else if(order?.status==='payment_pending'&&catalog?.mode==='general'){
        await loadPix();
      }
    }
    catch(e){setError(e.message)}
    finally{setLoading('')}
  }
  return <div className="public-page" style={{minHeight:'100vh',paddingBottom:30}}>
    <header className="public-header"><div className="public-header-inner">
      <div className="brand"><div className="brand-copy">EVER CLEAN<small>HIGIENE PROFISSIONAL</small></div></div>
      <strong style={{fontSize:12}}>Checkout Produção</strong>
    </div></header>
    <main className="public-main" style={{maxWidth:820,margin:'0 auto',padding:'20px 12px'}}>
      <section className="panel" style={{padding:18}}>
        <h1 style={{fontSize:22,marginBottom:8}}>Pedido de produtos</h1>
        <p style={{fontSize:13,color:'#586a69'}}>
          {catalog?('Solicitação EC-'+String(catalog.request_number||'').padStart(6,'0')+
          ' · '+catalog.customer_name):'Verificando link de pedido...'}
        </p>
        {status?.status==='paid'&&<div style={{marginTop:14,borderRadius:12,padding:16,
          background:'#eaf8ef',border:'1px solid #b9dec6',color:'#17654e'}}>
          <strong>Pagamento confirmado!</strong>
          <p style={{fontSize:13,marginTop:6}}>O PIX de {money(status.amount||7)} foi recebido.
          Pedido registrado para atendimento, com revisão manual de estoque.</p>
        </div>}
        {catalog?.mode==='general'&&catalog.enabled&&!status&&
          <div style={{border:'1px solid #c2decf',padding:13,background:'#f0fbf5',
            borderRadius:12,marginTop:14}}>
            <strong>PIX piloto autorizado exclusivamente para {money(catalog.approved_amount)}</strong>
            <p style={{fontSize:13,marginTop:6}}>
              Confira os {approvedCart.length} produtos e quantidades autorizados.
              Apenas o carrinho exato pode gerar uma cobrança real.
              A confirmação do pagamento será realizada pelo Asaas.
            </p>
          </div>}
        {!catalog?.enabled&&!status&&<div style={{border:'1px solid #e6d9bf',padding:13,
          background:'#fff9e9',borderRadius:12,marginTop:14}}>
          <LockKeyhole size={18} style={{verticalAlign:'middle',marginRight:7}}/>
          <strong>Pagamentos reais ainda não liberados.</strong>
          <p style={{fontSize:13,marginTop:6}}>Esta página permite apenas visualizar a preparação do catálogo.
          Não é possível criar cobranças neste momento.</p>
        </div>}
        {error&&<p role="alert" style={{color:'#a33a27',marginTop:14,fontSize:13}}>{error}</p>}
      </section>
      {catalog&&!status&&<section className="panel" style={{padding:18,marginTop:16}}>
        <h2 style={{fontSize:18,marginBottom:13}}><ShoppingCart size={19} style={{verticalAlign:-3,marginRight:8}}/>Produtos</h2>
        {catalog.mode==='general'&&<div style={{display:'grid',gap:9,marginBottom:14}}>
          <input type="search" placeholder="Buscar produto ou código (SKU)"
            value={search} onChange={e=>setSearch(e.target.value)}
            style={{padding:12,borderRadius:10,border:'1px solid #d5e1de',width:'100%'}}/>
          {categories.length>2&&<select value={category} onChange={e=>setCategory(e.target.value)}
            style={{padding:10,borderRadius:10,border:'1px solid #d5e1de'}}>
            {categories.map(x=><option key={x} value={x}>{x}</option>)}
          </select>}
          <small style={{color:'#61736d'}}>{shown.length} produtos encontrados ·
            até {catalog.max_items||100} produtos por pedido</small>
        </div>}
        {catalog.mode==='general'&&catalog.enabled&&<div style={{padding:12,
          border:'1px solid #c4e0d2',borderRadius:10,marginBottom:14,
          background:'#f0faf5'}}>
          <strong style={{fontSize:13}}>Carrinho piloto autorizado: {money(catalog.approved_amount)}</strong>
          <p style={{fontSize:12,marginTop:6}}>
            {(approvedCart||[]).map(x=>x.quantity+'× SKU '+x.sku).join(' · ')}
          </p>
          {!exactApprovedCart&&<p style={{fontSize:12,color:'#975321',marginTop:8}}>
            Os produtos ou quantidades selecionados não correspondem à autorização.
            Não é possível gerar PIX neste valor.
          </p>}
          <button className="btn btn-white" type="button" style={{width:'100%',
            maxWidth:'100%',marginTop:10,whiteSpace:'normal',justifyContent:'center'}}
            onClick={restoreApprovedCart} disabled={!!loading||submitLocked}>
            Restaurar os {approvedCart.length} itens autorizados
          </button>
        </div>}
        <div style={{display:'grid',gap:10}}>
          {shown.map(p=><div key={p.id}
            style={{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',
              padding:'12px 0',borderBottom:'1px solid #e7ecea'}}>
            <div style={{minWidth:0,flex:1}}>
              <strong style={{fontSize:13}}>{p.name}</strong>
              <div style={{fontSize:12,color:'#536865',marginTop:4}}>{p.sku} · {money(p.price)} / {p.unit}</div>
              {p.availability==='sob_encomenda'&&<div style={{fontSize:11,color:'#976216',marginTop:4}}>
                Sob encomenda — sujeito a confirmação de prazo
              </div>}
            </div>
            <input type="number" inputMode="numeric" min="0" max={p.max_quantity||10000}
              disabled={!p.can_order||!!payment||submitLocked}
              value={quantities[p.id]||''} placeholder="0" aria-label={'Quantidade de '+p.name}
              onChange={e=>{
                const n=Math.max(0,Math.min(p.max_quantity||10000,Math.trunc(Number(e.target.value)||0)));
                setQuantities(q=>({...q,[p.id]:n}));setQuote(null);
                setValidation(null);setConfirmed(false);
              }} style={{width:70,padding:9,border:'1px solid #d2dedb',borderRadius:9}}/>
          </div>)}
        </div>
        <button className="btn btn-primary" disabled={!items.length||!!loading||submitLocked}
          onClick={runQuote} style={{marginTop:14}}>
          {loading==='quote'?'Conferindo...':'Conferir valores do pedido'}
        </button>
        {quote&&<div style={{marginTop:14,padding:13,border:'1px solid #cbe5d9',borderRadius:12}}>
          <strong style={{fontSize:19}}>Total: {money(quote.amount)}</strong>
          {catalog.mode==='general'&&<div style={{marginTop:12,display:'grid',gap:8}}>
            <strong style={{fontSize:13}}>Confira os produtos selecionados</strong>
            {(quote.items||[]).map((item,i)=><div key={item.product_sku||i}
              style={{fontSize:12,padding:'8px 0',borderBottom:'1px solid #e7ecea'}}>
              <strong>{item.product_name}</strong>
              <div style={{color:'#546861',marginTop:3}}>
                SKU {item.product_sku} · {item.quantity} × {money(item.unit_price_cents/100)}
                {' = '}<strong>{money(item.subtotal_cents/100)}</strong>
              </div>
              {item.fulfillment_status==='sob_encomenda'&&
                <div style={{color:'#98611d',marginTop:3}}>Sob encomenda</div>}
            </div>)}
            <p style={{fontSize:12,color:'#536b65'}}>
              {quote.item_count||0} produto(s) diferente(s), {quote.units||0} unidade(s)
            </p>
          </div>}
          {quote.requires_stock_review&&<p style={{fontSize:12,marginTop:8}}>
            Existem itens sob encomenda. A disponibilidade será revisada antes da entrega.
          </p>}
          {catalog.enabled&&catalog.mode==='general'&&!approvedQuoteReady&&
            <p style={{marginTop:12,fontSize:13,color:'#a14b26',fontWeight:600}}>
              PIX bloqueado neste carrinho. Restaure os itens autorizados
              e confira novamente o total de {money(catalog.approved_amount)}.
            </p>}
          {!catalog.enabled?<>
            <p style={{marginTop:10,fontSize:13}}>Prévia concluída sem cobrança.</p>
            {catalog.mode==='general'&&<>
              <button className="btn btn-white" type="button" style={{marginTop:12,
                width:'100%',whiteSpace:'normal',justifyContent:'center',lineHeight:1.35}}
                onClick={validateWithoutPix} disabled={!!loading||!items.length}>
                <ShieldCheck size={16}/>
                {loading==='validation'?'Validando...':'Validar finalização (sem PIX)'}
              </button>
              {validation&&<div style={{border:'1px solid #cee3da',padding:12,
                borderRadius:10,marginTop:11}}>
                <strong style={{fontSize:14,color:validation.eligible_for_future_payment?
                  '#17654e':'#9a5624'}}>
                  {validation.eligible_for_future_payment?
                    'Finalização validada, sem cobrança':'Pedido já registrado para esta referência'}
                </strong>
                <p style={{fontSize:12,marginTop:8}}>
                  {validation.item_count} produtos · {validation.quantity_total} unidades ·
                  Total {money(validation.amount)}.
                </p>
                <p style={{fontSize:12,marginTop:6}}>
                  {validation.requires_stock_review?
                    'Existem itens sob encomenda: revisar antes da entrega.':
                    'Disponibilidade sujeita à confirmação.'}
                </p>
                <p style={{fontSize:12,marginTop:8}}>
                  {validation.message}
                </p>
              </div>}
            </>}
          </>:<>
            <label style={{display:'flex',alignItems:'flex-start',gap:8,marginTop:12,fontSize:13}}>
              <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
              Autorizo gerar uma cobrança PIX real neste valor.
            </label>
            <button className="btn btn-primary" style={{marginTop:12}}
              disabled={!confirmed||submitLocked||!!loading||
                (catalog.mode==='general'&&!approvedQuoteReady)}
              onClick={createPayment}>
              Gerar PIX real
            </button>
          </>}
        </div>}
      </section>}
      {catalog?.mode==='general'&&status?.status==='paid'&&
        <section className="panel" style={{padding:18,marginTop:16}}>
          <h2 style={{fontSize:18,marginBottom:10}}>Seu pedido de venda</h2>
          {status.bling_exported?<>
            <p style={{fontSize:13,color:'#506762',marginBottom:12}}>
              Seu pedido já foi registrado no Bling. Você pode guardar o PDF
              comercial com os produtos e valores confirmados.
            </p>
            <a className="btn btn-primary" style={{
              display:'inline-flex',width:'100%',maxWidth:'100%',
              boxSizing:'border-box',justifyContent:'center',
              whiteSpace:'normal',textAlign:'center',lineHeight:1.4}}
              href={'/.netlify/functions/bling-customer-order-pdf?token='+encodeURIComponent(token)}>
              Baixar pedido em PDF (dados do Bling)
            </a>
            <p style={{fontSize:11,color:'#647973',marginTop:10}}>
              Documento comercial gerado pela Ever Clean a partir do pedido
              consultado no Bling. Não é uma nota fiscal.
            </p>
          </>:<>
            <p style={{fontSize:13,color:'#506762'}}>
              Pagamento recebido! Estamos registrando a venda no Bling.
              Após a integração, o PDF ficará disponível nesta página.
              Use “Consultar situação do pagamento” para atualizar.
            </p>
          </>}
        </section>}
      {(payment||status?.status==='payment_pending')&&status?.status!=='paid'&&
        <section className="panel" style={{padding:18,marginTop:16}}>
          <h2 style={{fontSize:18,marginBottom:8}}>
            Pagar com PIX · {money(payment?.amount??status?.amount)}
          </h2>
          <p style={{fontSize:13,color:'#526a64',lineHeight:1.5}}>
            Utilize o QR Code ou o PIX Copia e Cola da cobrança já criada.
            Não é necessário abrir outra página ou gerar uma nova cobrança.
          </p>
          {pix?.available&&<>
            <div style={{display:'flex',justifyContent:'center',marginTop:16}}>
              <img src={'data:image/png;base64,'+pix.image_base64}
                width="230" height="230" alt="QR Code PIX desta cobrança no Asaas"
                style={{maxWidth:'100%',height:'auto',aspectRatio:'1',objectFit:'contain',
                  borderRadius:12,border:'1px solid #d6e3db',padding:10,
                  boxSizing:'border-box',background:'#fff'}}/>
            </div>
            <label htmlFor="everclean-pix-payload" style={{display:'block',marginTop:16,
              fontSize:13,fontWeight:700}}>PIX Copia e Cola</label>
            <textarea id="everclean-pix-payload" value={pix.copy_paste} readOnly rows={3}
              onFocus={e=>e.target.select()}
              style={{width:'100%',marginTop:8,padding:11,borderRadius:10,
                boxSizing:'border-box',border:'1px solid #cddbd5',fontSize:12,
                resize:'none',overflowWrap:'anywhere'}}/>
            <button className="btn btn-primary" type="button" onClick={copyPix}
              style={{marginTop:10,width:'100%',justifyContent:'center',
                whiteSpace:'normal',textAlign:'center'}}>
              {pixCopied?'Código PIX copiado!':'Copiar código PIX'}
            </button>
            {pix.expiration_date&&<p style={{fontSize:12,color:'#5a706a',marginTop:10}}>
              Validade do QR Code: {pix.expiration_date}
            </p>}
            <p style={{fontSize:12,color:'#526a64',marginTop:10}}>
              Após pagar pelo aplicativo do seu banco, consulte a situação abaixo.
              A confirmação depende do webhook autenticado do Asaas.
            </p>
          </>}
          {pixLoading&&<p style={{fontSize:13,marginTop:12}}>
            Consultando QR Code da cobrança existente...
          </p>}
          {pix&&!pix.available&&<p style={{fontSize:13,marginTop:12,color:'#85551e'}}>
            {pix.message||'QR Code ainda não disponível. Verifique o status.'}
          </p>}
          {pixError&&<p role="alert" style={{fontSize:12,marginTop:12,color:'#9a4b30'}}>
            {pixError} Nenhuma nova cobrança foi criada.
          </p>}
          {catalog?.mode==='general'&&<button className="btn btn-white" type="button"
            disabled={pixLoading||!!loading} onClick={loadPix}
            style={{marginTop:12,width:'100%',justifyContent:'center',
              whiteSpace:'normal'}}>
            <RefreshCw size={16}/>{pixLoading?'Consultando...':'Atualizar QR Code e Copia e Cola'}
          </button>}
          {(pix?.invoice_url||payment?.invoice_url)&&
            <a className="btn btn-white" style={{marginTop:10,display:'inline-flex',
              width:'100%',justifyContent:'center',boxSizing:'border-box',
              whiteSpace:'normal',textAlign:'center'}}
              target="_blank" rel="noopener noreferrer"
              href={pix?.invoice_url||payment?.invoice_url}>
              Abrir pagamento seguro no Asaas (alternativa)
            </a>}
        </section>}
      {(payment||status)&&<section className="panel" style={{padding:18,marginTop:16}}>
        <button className="btn btn-white" onClick={refresh} disabled={!!loading}>
          <RefreshCw size={16}/> Consultar situação do pagamento
        </button>
        {status&&<p style={{fontSize:13,marginTop:10}}>Situação registrada: <strong>{status.status==='paid'?'Pagamento confirmado':status.status}</strong></p>}
      </section>}
      <p style={{fontSize:12,color:'#527066',marginTop:16}}>
        <ShieldCheck size={16} style={{verticalAlign:-3,marginRight:6}}/>
        {catalog?.mode==='general'?
          (catalog.enabled?
            'PIX piloto único habilitado apenas para os itens autorizados. Após a confirmação no Asaas, o pedido poderá ser enviado ao Bling. Estoque, financeiro e NF-e permanecem manuais.':
            'Prévia do catálogo de produção: PIX real bloqueado para este link. Nenhum pedido será enviado ao Bling antes do pagamento confirmado. Baixa de estoque, financeiro e NF-e permanecem manuais.'):
          'Homologação piloto: baixa de estoque, financeiro e emissão automática de NF-e permanecem desligados.'}
      </p>
    </main>
  </div>;
}
