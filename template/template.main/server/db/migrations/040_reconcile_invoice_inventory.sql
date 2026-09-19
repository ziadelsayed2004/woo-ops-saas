-- Reconcile historical invoice inventory movements with the final invoice state.
-- This repairs edits where a product id arrived as text and the old numeric item
-- was treated as a different product, leaving the edit with no net stock effect.

CREATE TEMP TABLE invoice_inventory_reconciliation AS
WITH invoice_products AS (
  SELECT invoice_id, product_id FROM invoice_items
  UNION
  SELECT reference_id AS invoice_id, product_id
  FROM inventory_transactions
  WHERE reference_type = 'invoice'
), expected AS (
  SELECT
    ip.invoice_id,
    ip.product_id,
    CASE
      WHEN i.payment_status = 'cancelled' THEN 0
      ELSE
        -COALESCE((
          SELECT SUM(ii.quantity)
          FROM invoice_items ii
          WHERE ii.invoice_id = ip.invoice_id AND ii.product_id = ip.product_id
        ), 0)
        + COALESCE((
          SELECT SUM(ri.quantity)
          FROM return_items ri
          JOIN returns r ON r.id = ri.return_id
          WHERE r.invoice_id = ip.invoice_id
            AND ri.product_id = ip.product_id
            AND r.status != 'cancelled'
        ), 0)
    END AS expected_quantity,
    COALESCE((
      SELECT SUM(it.quantity)
      FROM inventory_transactions it
      WHERE it.reference_type = 'invoice'
        AND it.reference_id = ip.invoice_id
        AND it.product_id = ip.product_id
    ), 0) AS recorded_quantity
  FROM invoice_products ip
  JOIN invoices i ON i.id = ip.invoice_id
)
SELECT
  invoice_id,
  product_id,
  expected_quantity - recorded_quantity AS correction_quantity
FROM expected
WHERE expected_quantity != recorded_quantity;

INSERT INTO inventory_transactions (
  product_id, transaction_type, quantity, reference_type, reference_id, created_by
)
SELECT
  product_id,
  CASE WHEN correction_quantity > 0 THEN 'return' ELSE 'sale' END,
  correction_quantity,
  'invoice',
  invoice_id,
  NULL
FROM invoice_inventory_reconciliation;

DROP TABLE invoice_inventory_reconciliation;
