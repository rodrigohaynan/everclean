import React from 'react';
import { useParams } from 'react-router-dom';
import { Check, Minus, Plus, Search, Send, ShoppingCart, PackageCheck, Clock3, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const dateTime = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

function Loading() {
  return <div className="loading"><div><div className="spinner" />Carregando catálogo...</div></div>;
}

export default function PublicOrderPage() {
  const { token } = useParams();
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('Todos');
  const [qty, setQty] = React.useState({});
  const [notes, setNotes] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [done, setDone] = React.useState(null);

  React.useEffect(() => {
    let active = true;
    async function load() {
      const { data: payload, error: rpcError } = await supabase.rpc('ec_public_order_catalog', { p_token: token });
      if (!active) return;
      if (rpcError) {
        setError(rpcError.message || 'Não foi possível abrir este catálogo.');
        return;
      }
      if (!payload?.ok) {
        setError(payload?.message || 'Link inválido, expirado ou já utilizado.');
        return;
      }
      if (payload.link?.status === 'enviado') {
        setDone({ request_number: payload.link.request_number, already: true });
        return;
      }
      setData(payload);
    }
    load();
    return () => { active = false; };
  }, [token]);

  const products = data?.products || [];
  const categories = React.useMemo(() => ['Todos', ...new Set(products.map((p) => p.category).filter(Boolean))], [products]);
  const filtered = products.filter((p) => {
    const text = `${p.name || ''} ${p.sku || ''} ${p.brand || ''}`.toLowerCase();
    const matchSearch = text.includes(search.toLowerCase());
    const matchCategory = category === 'Todos' || p.category === category;
    return matchSearch && matchCategory;
  });

  const selected = products.filter((p) => Number(qty[p.id] || 0) > 0);
  const units = selected.reduce((sum, p) => sum + Number(qty[p.id] || 0), 0);
  const knownTotal = selected.reduce((sum, p) => {
    if (!p.catalog_show_price || p.base_price == null) return sum;
    return sum + Number(qty[p.id] || 0) * Number(p.base_price || 0);
  }, 0);
  const hasConsult = selected.some((p) => !p.catalog_show_price || p.base_price == null);

  function setProductQty(product, next) {
    const amount = Math.max(0, Number(next || 0));
    setQty((current) => ({ ...current, [product.id]: amount }));
  }

  async function submit() {
    if (!selected.length || sending) return;
    setSending(true);
    setError('');
    const items = selected.map((p) => ({ product_id: p.id, quantity: Number(qty[p.id]) }));
    const { data: response, error: rpcError } = await supabase.rpc('ec_submit_order_link', {
      p_token: token,
      p_items: items,
      p_notes: notes || null,
    });
    setSending(false);
    if (rpcError || !response?.ok) {
      setError(rpcError?.message || response?.message || 'Não foi possível enviar o pedido.');
      return;
    }
    setDone(response);
  }

  if (done) {
    const code = `EC-${String(done.request_number || 0).padStart(6, '0')}`;
    return (
      <div className="success">
        <div className="success-card">
          <div className="success-icon"><Check size={34} /></div>
          <h1>{done.already ? 'Pedido já enviado' : 'Pedido enviado!'}</h1>
          <p className="muted">Solicitação <strong>{code}</strong></p>
          <p>{done.already ? 'Este link já foi utilizado e está bloqueado para um novo envio.' : 'A Ever Clean recebeu sua seleção. Nossa equipe fará a conferência de disponibilidade e dos preços sob consulta.'}</p>
          <div style={{ marginTop: 20, padding: 14, background: '#f3f8f7', borderRadius: 14, fontSize: 13 }}>
            Você não precisa enviar a lista novamente pelo WhatsApp. Os produtos e quantidades já estão registrados.
          </div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return <div className="success"><div className="success-card"><AlertTriangle size={42} color="#a15c00" /><h2>Catálogo indisponível</h2><p className="muted">{error}</p></div></div>;
  }
  if (!data) return <Loading />;

  const requestCode = `EC-${String(data.link?.request_number || 0).padStart(6, '0')}`;

  return (
    <div className="public-page">
      <header className="public-header">
        <div className="public-header-inner">
          <div className="brand"><div className="brand-mark">EC</div><div className="brand-copy">Ever Clean<small>HIGIENE PROFISSIONAL</small></div></div>
          <div style={{ textAlign: 'right', fontSize: 11, color: '#6b7780' }}><strong style={{ color: '#17443e' }}>{requestCode}</strong><br />Pedido exclusivo</div>
        </div>
      </header>

      <main className="public-main">
        <section className="order-intro">
          <span className="eyebrow"><ShoppingCart size={13} /> Catálogo para reposição</span>
          <h1>{data.link?.customer_name || 'Cliente Ever Clean'}</h1>
          <p>Escolha os produtos e informe as quantidades. Não é necessário login.</p>
          <p><Clock3 size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Válido até {dateTime(data.link?.expires_at)}</p>
        </section>

        <div className="toolbar" style={{ marginBottom: 9 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={17} style={{ position: 'absolute', left: 12, top: 12, color: '#849097' }} />
            <input className="search" style={{ width: '100%', paddingLeft: 38 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto, marca ou código..." />
          </div>
        </div>

        <div className="filter-row">
          {categories.map((item) => <button key={item} className={`chip ${category === item ? 'active' : ''}`} onClick={() => setCategory(item)}>{item}</button>)}
        </div>

        <section className="products">
          {filtered.map((product) => {
            const stock = Number(product.stock_quantity || 0);
            const amount = Number(qty[product.id] || 0);
            const ready = stock > 0;
            return (
              <article className="product-card" key={product.id}>
                <div className="product-image">
                  {product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy" /> : <PackageCheck size={42} color="#8ab7af" />}
                </div>
                <div className="product-name">{product.name}</div>
                <div className="product-meta">{[product.sku, product.brand, product.unit].filter(Boolean).join(' • ')}</div>
                <div className="stock-line">
                  <span className={`badge ${ready ? 'green' : product.catalog_allow_backorder ? 'orange' : 'red'}`}>
                    {ready ? (product.catalog_show_stock ? `${stock} em estoque` : 'Pronta entrega') : product.catalog_allow_backorder ? 'Sob encomenda' : 'Indisponível'}
                  </span>
                </div>
                <div className={product.catalog_show_price && product.base_price != null ? 'price' : 'price consult'}>
                  {product.catalog_show_price && product.base_price != null ? money(product.base_price) : 'Preço sob consulta'}
                </div>
                <div className="qty" style={{ marginTop: 12 }}>
                  <button onClick={() => setProductQty(product, amount - 1)} disabled={!amount}><Minus size={16} /></button>
                  <input inputMode="numeric" min="0" value={amount || ''} placeholder="0" onChange={(e) => setProductQty(product, e.target.value)} />
                  <button onClick={() => setProductQty(product, amount + 1)} disabled={!ready && !product.catalog_allow_backorder}><Plus size={16} /></button>
                </div>
              </article>
            );
          })}
        </section>
        {!filtered.length && <div className="empty">Nenhum produto encontrado.</div>}

        {selected.length > 0 && (
          <div className="panel" style={{ marginTop: 20 }}>
            <div className="panel-head"><h2>Observações do pedido</h2></div>
            <div style={{ padding: 16 }}><textarea className="search" style={{ width: '100%', minHeight: 80, padding: 12 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: urgência, preferência de embalagem, observações para orçamento..." /></div>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
      </main>

      <footer className="cartbar">
        <div className="cartbar-inner">
          <div className="cart-summary"><strong>{selected.length} produto(s) • {units} unidade(s)</strong><small>{knownTotal > 0 ? `${hasConsult ? 'Valor parcial' : 'Total'}: ${money(knownTotal)}` : 'Valores serão confirmados pela Ever Clean'}</small></div>
          <button className="btn btn-primary" disabled={!selected.length || sending} onClick={submit}><Send size={17} /> {sending ? 'Enviando...' : 'Enviar pedido'}</button>
        </div>
      </footer>
    </div>
  );
}
