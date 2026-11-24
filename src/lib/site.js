// Endereço público do catálogo (domínio próprio desde 24/11/2026).
// O endereço antigo da Netlify continua servindo o mesmo site: webhook do
// Asaas, login do Bling e retorno do pagamento seguem nele por estarem
// cadastrados nesses serviços.
export const SITE_URL = 'https://everclean.com.br';
export const LEGACY_SITE_URL = 'https://evercleancatalogo.netlify.app';

// Link de pedido válido em qualquer um dos dois endereços.
export const isOrderPageUrl = url =>
  /^https:\/\/(everclean\.com\.br|evercleancatalogo\.netlify\.app)\/pedido-producao\/[a-f0-9]{64}$/.test(String(url || ''));
