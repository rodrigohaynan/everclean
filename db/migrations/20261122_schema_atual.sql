-- Ever Clean | Complemento do schema everclean_private
--
-- Registra no repositório o que já existe no banco de produção (Neon, projeto
-- "everclean", banco "everclean") e não estava nas migrações anteriores:
-- colunas extras de checkout_orders, links de produção, expedição, portal do
-- cliente, políticas RLS e permissões do papel da aplicação.
--
-- Levantado do banco em 2026-11-22. Idempotente: em produção não altera nada;
-- em um banco novo, rodar depois de 20261121064000_checkout_producao_privado.sql
-- e 20261121_bling_export_intents.sql recria a estrutura completa.
--
-- Papéis esperados: everclean_owner (dono do schema) e everclean_catalog_app
-- (login usado pelas Netlify Functions, sem BYPASSRLS). As permissões só são
-- aplicadas se o papel da aplicação existir.

BEGIN;

-- ---------------------------------------------------------------------------
-- checkout_orders: preferências do comprador gravadas junto com a reserva
-- ---------------------------------------------------------------------------
ALTER TABLE everclean_private.checkout_orders
  ADD COLUMN IF NOT EXISTS payment_method varchar(24) NOT NULL DEFAULT 'pix',
  ADD COLUMN IF NOT EXISTS customer_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invoice_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_channel varchar(20),
  ADD COLUMN IF NOT EXISTS invoice_contact varchar(254),
  ADD COLUMN IF NOT EXISTS payment_due_date date;

-- ---------------------------------------------------------------------------
-- Portal do cliente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS everclean_private.customer_portal_accounts (
  customer_id varchar(150) PRIMARY KEY,
  email varchar(254) NOT NULL,
  password_hash varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_portal_accounts_email_ci
  ON everclean_private.customer_portal_accounts (lower(email::text));

CREATE TABLE IF NOT EXISTS everclean_private.customer_portal_invitations (
  token_digest char(64) PRIMARY KEY,
  customer_id varchar(150) NOT NULL,
  email varchar(254) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_portal_invitations_customer
  ON everclean_private.customer_portal_invitations (customer_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS everclean_private.customer_portal_sessions (
  token_digest char(64) PRIMARY KEY,
  customer_id varchar(150) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  auth_method varchar(16) NOT NULL DEFAULT 'password',
  source_kind varchar(16),
  source_token_digest char(64)
);
CREATE INDEX IF NOT EXISTS idx_customer_portal_sessions_customer
  ON everclean_private.customer_portal_sessions (customer_id, expires_at DESC);

CREATE SEQUENCE IF NOT EXISTS everclean_private.customer_portal_request_seq;

CREATE TABLE IF NOT EXISTS everclean_private.customer_portal_order_requests (
  id uuid PRIMARY KEY,
  request_number varchar(28) NOT NULL UNIQUE
    DEFAULT ('SOL-' || lpad(nextval('everclean_private.customer_portal_request_seq')::text, 6, '0')),
  customer_id varchar(150) NOT NULL,
  customer_name varchar(160) NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','in_review','quoted','rejected','completed')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  items jsonb NOT NULL,
  requires_stock_review boolean NOT NULL DEFAULT false,
  notes varchar(1500) NOT NULL DEFAULT '',
  invoice_requested boolean NOT NULL DEFAULT false,
  invoice_channel varchar(20),
  invoice_contact varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  review_note varchar(240),
  reviewed_at timestamptz,
  approval_source varchar(24) NOT NULL DEFAULT 'manual'
    CHECK (approval_source IN ('manual','automatic_stock')),
  UNIQUE (customer_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ec_portal_requests_admin_date
  ON everclean_private.customer_portal_order_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ec_portal_requests_customer_date
  ON everclean_private.customer_portal_order_requests (customer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Links de pedido de produção (/pedido-producao/:token)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS everclean_private.production_catalog_links (
  id uuid PRIMARY KEY,
  token_digest char(64) NOT NULL UNIQUE,
  token varchar(160) NOT NULL UNIQUE,
  request_number varchar(10) NOT NULL UNIQUE,
  customer_id varchar(140) NOT NULL,
  customer_name varchar(160) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','canceled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  payment_authorized boolean NOT NULL DEFAULT false,
  payment_max_cents bigint NOT NULL DEFAULT 0,
  payment_authorized_at timestamptz,
  payment_approved_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_request_id uuid REFERENCES everclean_private.customer_portal_order_requests(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ec_prod_link_source_request_unique
  ON everclean_private.production_catalog_links (source_request_id);

-- ---------------------------------------------------------------------------
-- Expedição
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS everclean_private.order_fulfillment (
  checkout_order_id uuid PRIMARY KEY
    REFERENCES everclean_private.checkout_orders(id) ON DELETE RESTRICT,
  stage varchar(28) NOT NULL
    CHECK (stage IN ('preparing','ready_for_delivery','out_for_delivery','delivered','on_hold')),
  public_note varchar(240) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS everclean_private.order_fulfillment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checkout_order_id uuid NOT NULL
    REFERENCES everclean_private.checkout_orders(id) ON DELETE RESTRICT,
  previous_stage varchar(28) NOT NULL,
  new_stage varchar(28) NOT NULL
    CHECK (new_stage IN ('preparing','ready_for_delivery','out_for_delivery','delivered','on_hold')),
  public_note varchar(240) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_everclean_fulfillment_events_order_date
  ON everclean_private.order_fulfillment_events (checkout_order_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS e permissões do papel da aplicação
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'everclean_catalog_app') THEN
    RAISE NOTICE 'Papel everclean_catalog_app não existe: políticas e permissões não aplicadas.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'everclean_private'
      AND tablename = 'checkout_orders' AND policyname = 'everclean_checkout_server_write') THEN
    CREATE POLICY everclean_checkout_server_write ON everclean_private.checkout_orders
      FOR ALL TO everclean_catalog_app USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'everclean_private'
      AND tablename = 'payment_events' AND policyname = 'everclean_events_server_write') THEN
    CREATE POLICY everclean_events_server_write ON everclean_private.payment_events
      FOR ALL TO everclean_catalog_app USING (true) WITH CHECK (true);
  END IF;

  GRANT USAGE ON SCHEMA everclean_private TO everclean_catalog_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA everclean_private TO everclean_catalog_app;
  GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA everclean_private TO everclean_catalog_app;
END $$;

COMMIT;
