-- Ever Clean | Checkout de produção | estrutura transacional privada
-- Aplicar SOMENTE em banco PostgreSQL dedicado, após configurar backup e permissões.
-- Não há alterações nos dados da integração Bling/Asaas Sandbox.
CREATE SCHEMA IF NOT EXISTS everclean_private;
REVOKE ALL ON SCHEMA everclean_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS everclean_private.checkout_orders (
  id uuid PRIMARY KEY,
  link_digest char(64) NOT NULL UNIQUE,
  checkout_reference varchar(80) NOT NULL UNIQUE,
  request_number varchar(40) NOT NULL,
  customer_id varchar(150) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency='BRL'),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  items jsonb NOT NULL CHECK (jsonb_typeof(items)='array'),
  requires_stock_review boolean NOT NULL DEFAULT false,
  payment_id varchar(100) UNIQUE,
  state varchar(32) NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved','creating_payment','payment_pending','paid',
                     'refunded','chargeback','canceled','manual_review')),
  payment_state varchar(32) NOT NULL DEFAULT 'NOT_CREATED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  last_event_id varchar(255)
);
CREATE INDEX IF NOT EXISTS everclean_checkout_orders_state_idx
 ON everclean_private.checkout_orders(state,created_at);
CREATE TABLE IF NOT EXISTS everclean_private.payment_events (
  event_id varchar(255) PRIMARY KEY,
  checkout_order_id uuid NOT NULL REFERENCES everclean_private.checkout_orders(id),
  event_name varchar(90) NOT NULL,
  payment_id varchar(100) NOT NULL,
  result_state varchar(32) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS everclean_payment_events_order_idx
 ON everclean_private.payment_events(checkout_order_id,received_at DESC);

-- Defesa em profundidade: schema não exposto a clientes públicos.
ALTER TABLE everclean_private.checkout_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE everclean_private.payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA everclean_private FROM PUBLIC;
-- Credencial do servidor deve ter acesso somente ao schema privado.
-- Nunca expor a URL do banco em VITE_* nem no navegador.
