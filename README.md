# Ever Clean — Catálogo e Pedidos Online

Plataforma comercial B2B da Ever Clean Higiene Profissional.

## Produção

Este repositório contém o pacote-fonte completo da aplicação (`everclean-source.tar.gz.b64`) e um bootstrap automático para o Netlify. O deploy não depende do VS Code ou de upload manual.

### Fluxo

GitHub `main` → Netlify → bootstrap → Vite build → `dist`

### Supabase

O frontend utiliza as variáveis de ambiente:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

As chaves privadas não são versionadas no GitHub.

### Funcionalidades principais

- catálogo público;
- links únicos de pedido por cliente;
- pedido sem login do cliente;
- produtos com estoque, preço opcional e sob encomenda;
- painel administrativo;
- clientes, produtos, pedidos, financeiro, logística e central comercial;
- acompanhamento dos links enviados e pedidos recebidos.
