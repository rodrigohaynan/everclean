-- Ever Clean | Produtos e clientes no PostgreSQL
--
-- Até aqui produtos e clientes eram um único documento JSON cada no Netlify
-- Blobs (data/products, data/clients). Agora cada registro é uma linha, com
-- gravação transacional. O conteúdo de cada registro continua em JSONB com o
-- mesmo formato usado pelo código, para a troca não mudar nenhuma regra.
--
-- A carga inicial é feita pela aplicação no primeiro acesso (copia o Blobs
-- uma única vez, registrada em catalog_meta). O Blobs continua recebendo uma
-- cópia de cada gravação, para permitir voltar à versão anterior do site.
--
-- Somente cria objetos novos; não altera nem apaga nada existente.

BEGIN;

CREATE TABLE IF NOT EXISTS everclean_private.catalog_products (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 300),
  position integer NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data->>'id' = id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_products_position_idx
  ON everclean_private.catalog_products (position);

CREATE TABLE IF NOT EXISTS everclean_private.catalog_clients (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 300),
  position integer NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data->>'id' = id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_clients_position_idx
  ON everclean_private.catalog_clients (position);

-- Uma linha por coleção depois da carga inicial a partir do Blobs.
CREATE TABLE IF NOT EXISTS everclean_private.catalog_meta (
  collection varchar(20) PRIMARY KEY CHECK (collection IN ('products','clients')),
  seeded_at timestamptz NOT NULL DEFAULT now(),
  seeded_from varchar(40) NOT NULL,
  seeded_count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'everclean_catalog_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      everclean_private.catalog_products,
      everclean_private.catalog_clients,
      everclean_private.catalog_meta
    TO everclean_catalog_app;
  END IF;
END $$;

COMMIT;
