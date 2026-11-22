import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeProducts,mergeClients,remapOrders} from '../netlify/shared/backup-merge.mjs';

const NOW='2026-11-22T00:00:00.000Z';

test('produto casado por SKU mantém ID, imagem e visibilidade do painel',()=>{
  const existing=[{id:'uuid-1',sku:'EC-1',name:'Detergente',base_price:10,image_url:'img.png',catalog_visible:false,featured:true}];
  const incoming=[{id:'bling-product-555',sku:'EC-1',name:'Detergente 5L',base_price:12,image_url:'',catalog_visible:true,featured:false}];
  const {items,idMap,stats}=mergeProducts(existing,incoming,NOW);
  assert.equal(items.length,1);
  assert.equal(items[0].id,'uuid-1');
  assert.equal(items[0].bling_product_id,'555');
  assert.equal(items[0].name,'Detergente 5L');
  assert.equal(items[0].base_price,12);
  assert.equal(items[0].image_url,'img.png');
  assert.equal(items[0].catalog_visible,false);
  assert.equal(items[0].featured,true);
  assert.deepEqual(idMap,{'bling-product-555':'uuid-1'});
  assert.equal(stats.matched,1);
});

test('produto manual fora do backup é mantido; do Bling fica oculto',()=>{
  const existing=[
    {id:'manual-1',sku:'X',name:'Manual',catalog_visible:true},
    {id:'bling-product-9',sku:'OLD',name:'Antigo',catalog_visible:true},
  ];
  const {items,stats}=mergeProducts(existing,[],NOW);
  assert.equal(items.length,2);
  assert.equal(items.find(p=>p.id==='manual-1').catalog_visible,true);
  assert.equal(items.find(p=>p.id==='bling-product-9').catalog_visible,false);
  assert.equal(stats.hidden,1);
});

test('estoque sincronizado ao vivo prevalece sobre o backup',()=>{
  const existing=[{id:'a',sku:'S',stock_quantity:7,stock_source:'bling'}];
  const {items}=mergeProducts(existing,[{id:'bling-product-1',sku:'S',stock_quantity:2}],NOW);
  assert.equal(items[0].stock_quantity,7);
});

test('SKU repetido no catálogo não é usado para casar',()=>{
  const existing=[{id:'a',sku:'D',name:'Um'},{id:'b',sku:'D',name:'Dois'}];
  const {items,stats}=mergeProducts(existing,[{id:'bling-product-3',sku:'D',name:'Três'}],NOW);
  assert.equal(stats.added,1);
  assert.equal(items.length,3);
});

test('cliente casado por CNPJ mantém ID e condições de boleto',()=>{
  const existing=[{id:'c-uuid',trade_name:'Hotel X',document:'12.345.678/0001-90',allow_boleto:true,
    payment_methods:['pix','boleto'],credit_limit:5000,asaas_customer_id:'cus_123'}];
  const incoming=[{id:'client-77',trade_name:'HOTEL X LTDA',document:'12345678000190',allow_boleto:false,
    payment_methods:['pix'],credit_limit:0,order_count:9}];
  const {items,idMap}=mergeClients(existing,incoming,NOW);
  assert.equal(items.length,1);
  assert.equal(items[0].id,'c-uuid');
  assert.equal(items[0].allow_boleto,true);
  assert.deepEqual(items[0].payment_methods,['pix','boleto']);
  assert.equal(items[0].credit_limit,5000);
  assert.equal(items[0].asaas_customer_id,'cus_123');
  assert.equal(items[0].order_count,9);
  assert.deepEqual(idMap,{'client-77':'c-uuid'});
});

test('cliente cadastrado à mão e ausente do backup é mantido',()=>{
  const {items}=mergeClients([{id:'m',trade_name:'Novo'}],[{id:'client-1',trade_name:'Outro',document:''}],NOW);
  assert.deepEqual(items.map(c=>c.id).sort(),['client-1','m']);
});

test('pedidos históricos são remapeados para os IDs finais',()=>{
  const orders=[{id:'o',customer_id:'client-77',items:[{product_id:'bling-product-555',quantity:1}]}];
  const [o]=remapOrders(orders,{'bling-product-555':'uuid-1'},{'client-77':'c-uuid'});
  assert.equal(o.customer_id,'c-uuid');
  assert.equal(o.items[0].product_id,'uuid-1');
});
