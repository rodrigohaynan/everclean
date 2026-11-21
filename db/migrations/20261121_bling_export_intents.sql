-- Preparação da exportação automática Ever Clean: nenhuma venda é criada por esta migração.
-- Um pedido Neon tem no máximo UM registro de tentativa de envio ao Bling.
CREATE TABLE IF NOT EXISTS everclean_private.bling_export_intents (
  checkout_order_id UUID PRIMARY KEY REFERENCES everclean_private.checkout_orders(id) ON DELETE RESTRICT,
  origin_reference VARCHAR(80) NOT NULL UNIQUE,
  state VARCHAR(24) NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved','sending','sent','inconclusive','already_exists','blocked')),
  bling_order_id VARCHAR(40),
  bling_order_number VARCHAR(40),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 1),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  CHECK ((state NOT IN ('sent','already_exists')) OR bling_order_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS bling_export_intents_state_idx
  ON everclean_private.bling_export_intents (state, created_at);

COMMENT ON TABLE everclean_private.bling_export_intents IS
  'Registro transacional único por pedido para impedir reenvio ao Bling após timeout/429. Nunca repetir POST automaticamente.';

-- A preparação não cria gatilho, cron, integração financeira, NF-e ou estoque.
