import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

// Depois de um novo deploy, os arquivos da versão anterior deixam de existir.
// Se a página aberta tentar carregar um deles, recarrega uma vez para pegar a
// versão nova em vez de mostrar tela branca.
function lazyPage(loader) {
  return lazy(() => loader().catch(error => {
    const key = 'everclean-chunk-reload';
    let reloaded = false;
    try { reloaded = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch {}
    if (!reloaded) { window.location.reload(); return new Promise(() => {}); }
    throw error;
  }).then(module => {
    try { sessionStorage.removeItem('everclean-chunk-reload'); } catch {}
    return module;
  }));
}

// Cada área carrega só o próprio código: o cliente que abre o catálogo não
// baixa o painel administrativo (AdminPage tem mais de 3 mil linhas).
const LoginPage = lazyPage(() => import('./pages/LoginPage.jsx'));
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage.jsx'));
const SignupPage = lazyPage(() => import('./pages/SignupPage.jsx'));
const AdminPage = lazyPage(() => import('./pages/AdminPage.jsx'));
const AdminProductsPageV3 = lazyPage(() => import('./pages/AdminProductsPageV3.jsx'));
const AdminImportPage = lazyPage(() => import('./pages/AdminImportPage.jsx'));
const PublicOrderPage = lazyPage(() => import('./pages/PublicOrderPageV4.jsx'));
const PublicProductionCheckoutPage = lazyPage(() => import('./pages/PublicProductionCheckoutPage.jsx'));
const CustomerPortalPage = lazyPage(() => import('./pages/CustomerPortalPage.jsx'));

function PageLoading() {
  return <div className="loading"><div><div className="spinner" />Carregando...</div></div>;
}

function HomeRedirect() {
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
        <Route path="/cadastro" element={<SignupPage />} />
        <Route path="/pedido/:token" element={<PublicOrderPage />} />
        <Route path="/pedido-producao/:token" element={<PublicProductionCheckoutPage />} />
        <Route path="/cliente" element={<CustomerPortalPage />} />
        <Route path="/cliente/ativar/:token" element={<CustomerPortalPage />} />
        <Route path="/cliente/acesso/:kind/:token" element={<CustomerPortalPage />} />
        <Route path="/admin" element={<AdminPage section="dashboard" />} />
        <Route path="/admin/asaas" element={<AdminPage section="asaas" />} />
        <Route path="/admin/bling" element={<AdminPage section="bling" />} />
        <Route path="/admin/clientes" element={<AdminPage section="clients" />} />
        <Route path="/admin/produtos" element={<AdminProductsPageV3 />} />
        <Route path="/admin/pedidos" element={<AdminPage section="orders" />} />
        <Route path="/admin/historico-pedidos" element={<AdminPage section="ordersHistory" />} />
        <Route path="/admin/links-pedido" element={<AdminPage section="links" />} />
        <Route path="/admin/importar" element={<AdminImportPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
