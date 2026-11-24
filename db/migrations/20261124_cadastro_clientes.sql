-- Ever Clean | Cadastro feito pelo próprio cliente, com aprovação no admin
--
-- O cliente preenche o cadastro em /cadastro. Os dados ficam aqui como
-- "pending" até a Ever Clean aprovar no admin (Clientes). Só na aprovação o
-- cliente entra no cadastro de clientes e ganha a conta do portal (mesma
-- senha que escolheu). Recusado não vira cliente nem conta.

BEGIN;

CREATE TABLE IF NOT EXISTS everclean_private.customer_signups (
  id uuid PRIMARY KEY,
  status varchar(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  email varchar(254) NOT NULL,
  document varchar(14) NOT NULL CHECK (document ~ '^([0-9]{11}|[0-9]{14})$'),
  data jsonb NOT NULL,
  password_hash varchar(200) NOT NULL,
  ip_digest varchar(64),
  customer_id varchar(80),
  review_note varchar(240),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK (status <> 'approved' OR customer_id IS NOT NULL)
);

-- No máximo um cadastro em análise por e-mail e por CPF/CNPJ.
CREATE UNIQUE INDEX IF NOT EXISTS customer_signups_pending_email_idx
  ON everclean_private.customer_signups (lower(email)) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS customer_signups_pending_document_idx
  ON everclean_private.customer_signups (document) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS customer_signups_status_created_idx
  ON everclean_private.customer_signups (status, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'everclean_catalog_app') THEN
    GRANT SELECT, INSERT, UPDATE ON everclean_private.customer_signups TO everclean_catalog_app;
  END IF;
END $$;

COMMIT;
