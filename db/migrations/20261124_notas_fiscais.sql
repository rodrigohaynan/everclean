-- Ever Clean | Nota fiscal (NF-e) emitida no Bling e entregue pelo catálogo
--
-- A nota é gerada e enviada à SEFAZ no Bling, a partir do pedido de venda
-- que o catálogo registrou. A rotina bling-invoice-sync consulta o Bling,
-- guarda aqui o número, a série e a chave de acesso, e o cliente baixa o
-- PDF (DANFE) e o XML pelo link do pedido ou pelo portal.
--
-- Um registro por pedido. status:
--   none        pedido no Bling ainda sem nota
--   pending     nota criada, ainda não autorizada pela SEFAZ
--   authorized  nota autorizada (situação Bling 5 ou 6): visível ao cliente
--   problem     rejeitada, denegada ou bloqueada (situação 4, 9 ou 11)
--   cancelled   nota cancelada (situação 2): some para o cliente

BEGIN;

CREATE TABLE IF NOT EXISTS everclean_private.order_invoices (
  checkout_order_id uuid PRIMARY KEY
    REFERENCES everclean_private.checkout_orders(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'none'
    CHECK (status IN ('none','pending','authorized','problem','cancelled')),
  bling_invoice_id varchar(20) CHECK (bling_invoice_id IS NULL OR bling_invoice_id ~ '^[0-9]{1,20}$'),
  bling_status smallint,
  number varchar(20),
  series varchar(10),
  access_key varchar(44) CHECK (access_key IS NULL OR access_key ~ '^[0-9]{44}$'),
  issued_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'authorized' OR (bling_invoice_id IS NOT NULL AND access_key IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS order_invoices_status_checked_idx
  ON everclean_private.order_invoices (status, checked_at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'everclean_catalog_app') THEN
    GRANT SELECT, INSERT, UPDATE ON everclean_private.order_invoices TO everclean_catalog_app;
  END IF;
END $$;

COMMIT;
