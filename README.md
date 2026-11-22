# Ever Clean — Catálogo e Pedidos Online

Plataforma B2B da **Ever Clean Higiene Profissional** para reposição, orçamento e pedidos de produtos de higiene e limpeza, com pagamento pelo Asaas e envio dos pedidos ao Bling.

## Arquitetura

- **Frontend:** React 18 + Vite + React Router (SPA em `src/`).
- **Backend:** Netlify Functions em `netlify/functions/` (Node 20). Código compartilhado em `netlify/shared/`.
- **Dados:**
  - **Netlify Blobs** (store `everclean-test`): clientes (`data/clients`), produtos (`data/products`), links e pedidos legados do Sandbox, sessão do admin e tokens do Bling (cifrados com AES-256-GCM).
  - **PostgreSQL / Neon** (schema `everclean_private`): links de produção, pedidos e pagamentos, eventos de webhook, envio ao Bling, expedição e portal do cliente.
- **Integrações:** Asaas (PIX e boleto), Bling API v3 (OAuth, estoque, pedidos de venda).

## Fluxo de produção

1. O administrador gera um link de produção para o cliente (`production-general-links`).
2. O cliente abre `/pedido-producao/:token`, monta o carrinho e escolhe PIX ou boleto (`asaas-catalog-production`).
3. O pedido é reservado no Postgres e a cobrança é criada **uma única vez** no Asaas.
4. O webhook `asaas-webhook-production` concilia o pagamento (ID e valor precisam coincidir).
5. A função agendada `bling-production-auto-runner` (a cada 5 min) envia pedidos pagos ao Bling, sem reenvio automático em caso de falha.
6. O cliente baixa o resumo do pedido (`bling-customer-order-pdf`) e acompanha tudo no portal `/cliente`.

`bling-stock-scheduled` sincroniza o estoque do Bling a cada 30 minutos.

## Rotas

- `/login`, `/redefinir-senha` — acesso interno
- `/admin/*` — painel (dashboard, clientes, produtos, pedidos, links, Asaas, Bling, importação)
- `/pedido-producao/:token` — checkout de produção do cliente
- `/pedido/:token` — links antigos (Sandbox, somente consulta)
- `/cliente` — portal do cliente

## API administrativa

`/.netlify/functions/admin-api` concentra login, sessão e cadastros. As versões internas ficam em `netlify/shared/admin-api/` (v1 → v7, cada uma estendendo a anterior). `test-api-v7` é um alias temporário da mesma API.

## Variáveis de ambiente (Netlify, somente Functions)

| Variável | Uso |
| --- | --- |
| `EVERCLEAN_ADMIN_SETUP_KEY` | Código de recuperação da senha do admin (≥ 32 caracteres) |
| `EVERCLEAN_DATABASE_URL` | Conexão PostgreSQL/Neon |
| `ASAAS_PROD_API_KEY`, `ASAAS_PROD_WEBHOOK_TOKEN` | Asaas produção |
| `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN` | Asaas Sandbox (histórico, somente leitura) |
| `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI` | Aplicativo Bling |
| `EVERCLEAN_GENERAL_PRODUCTION_CHECKOUT_ENABLE`, `EVERCLEAN_GENERAL_PRODUCTION_START_AT`, `EVERCLEAN_GENERAL_PRODUCTION_MAX_CENTS`, `EVERCLEAN_PUBLIC_CHECKOUT_PIX_ENABLE` | Liberação do checkout de produção |
| `EVERCLEAN_BLING_DISPATCH_ENABLE`, `EVERCLEAN_BLING_AUTO_EXPORT_ENABLE`, `EVERCLEAN_BLING_AUTO_START_AT` | Envio automático ao Bling |

Nenhuma chave privada deve ser versionada nem exposta em variáveis `VITE_*`.

## Banco de dados

As migrações em `db/migrations/` cobrem `checkout_orders`, `payment_events` e `bling_export_intents`. As tabelas `production_catalog_links`, `order_fulfillment` e `customer_portal_*` e algumas colunas de `checkout_orders` (`payment_method`, `customer_notes`, `invoice_*`, `payment_due_date`) existem no banco, mas ainda não têm migração versionada. Exporte o schema atual (`pg_dump --schema-only -n everclean_private`) para completar.

## Desenvolvimento

```bash
npm install
npm run dev      # frontend em http://localhost:3000
netlify dev      # frontend + functions
npm run build
```

Deploy automático: GitHub `main` → Netlify `evercleancatalogo`.
