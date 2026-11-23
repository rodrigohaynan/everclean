-- Ever Clean | Acompanhamento do pedido: etapa "Pedido recebido"
--
-- Permite registrar a etapa inicial "received" (Pedido recebido) e
-- comentários nessa etapa. As etapas existentes continuam válidas; nenhum
-- dado é alterado. Cada movimentação (mudança de etapa ou comentário) vira
-- uma linha em order_fulfillment_events, que o cliente vê como histórico.

BEGIN;

ALTER TABLE everclean_private.order_fulfillment
  DROP CONSTRAINT IF EXISTS order_fulfillment_stage_check;
ALTER TABLE everclean_private.order_fulfillment
  ADD CONSTRAINT order_fulfillment_stage_check CHECK (stage IN
    ('received','preparing','ready_for_delivery','out_for_delivery','delivered','on_hold'));

ALTER TABLE everclean_private.order_fulfillment_events
  DROP CONSTRAINT IF EXISTS order_fulfillment_events_new_stage_check;
ALTER TABLE everclean_private.order_fulfillment_events
  ADD CONSTRAINT order_fulfillment_events_new_stage_check CHECK (new_stage IN
    ('received','preparing','ready_for_delivery','out_for_delivery','delivered','on_hold'));

COMMIT;
