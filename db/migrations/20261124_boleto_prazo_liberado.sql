-- Ever Clean | Pedido liberado no boleto a prazo
--
-- Cliente autorizado a boleto (ex.: 30 dias) que escolhe boleto tem o pedido
-- confirmado na hora: acompanhamento, documentos, envio ao Bling e nota
-- fiscal seguem como se estivesse pago. O financeiro não muda: o pedido
-- continua "payment_pending" até o Asaas confirmar o pagamento.
-- Liberado = state 'paid' OU (state 'payment_pending' E released_at preenchido).
-- Boleto cancelado/estornado (outro state) deixa de valer como liberado.

BEGIN;

ALTER TABLE everclean_private.checkout_orders
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_reason varchar(30);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='checkout_orders_released_reason_check') THEN
    ALTER TABLE everclean_private.checkout_orders ADD CONSTRAINT checkout_orders_released_reason_check
      CHECK (released_reason IS NULL OR released_reason IN ('boleto_prazo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS checkout_orders_released_idx
  ON everclean_private.checkout_orders (released_at) WHERE released_at IS NOT NULL;

COMMIT;
