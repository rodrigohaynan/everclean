import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import AdminProductsPageV2 from './pages/AdminProductsPageV2.jsx';
import PublicOrderPage from './pages/PublicOrderPageV4.jsx';

// Public catalog V4: checkout, repeat order and horizontal suggestions.
function HomeRedirect() {
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route path="/pedido/:token" element={<PublicOrderPage />} />
      <Route path="/admin" element={<AdminPage section="dashboard" />} />
      <Route path="/admin/clientes" element={<AdminPage section="clients" />} />
      <Route path="/admin/produtos" element={<AdminProductsPageV2 />} />
      <Route path="/admin/pedidos" element={<AdminPage section="orders" />} />
      <Route path="/admin/links-pedido" element={<AdminPage section="links" />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
