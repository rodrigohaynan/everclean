# Ever Clean — Catálogo e Pedidos Online

Plataforma B2B da **Ever Clean Higiene Profissional** para agilizar reposição, orçamento e pedidos de produtos de higiene e limpeza.

## Fluxo

1. Administrador acessa o painel interno.
2. Em **Clientes**, gera um link exclusivo válido por 7 dias.
3. O cliente abre `/pedido/:token` sem login.
4. Seleciona produtos e quantidades.
5. Produtos podem exibir estoque e preço ou ficar **sob consulta**.
6. O envio grava os itens no Supabase e bloqueia o link contra novo envio.
7. A Ever Clean acompanha tudo em **Links de Pedido**.

## Rotas principais

- `/login` — acesso interno
- `/admin` — painel geral
- `/admin/clientes` — clientes e geração de link
- `/admin/produtos` — catálogo, estoque e visibilidade de preços
- `/admin/pedidos` — histórico de pedidos
- `/admin/links-pedido` — pedidos recebidos por link
- `/pedido/:token` — catálogo exclusivo do cliente, sem login

## Deploy

Projeto Vite + React conectado ao Netlify.

Build: `npm run build`  
Publicação: `dist`

O Netlify deve possuir as variáveis:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Nenhuma chave privada deve ser versionada no GitHub.

## Supabase

Antes do primeiro uso, execute `supabase/everclean_catalogo.sql` no SQL Editor do projeto Supabase da Ever Clean. O script é idempotente e cria/ajusta as estruturas do catálogo e os RPCs públicos protegidos por token.
