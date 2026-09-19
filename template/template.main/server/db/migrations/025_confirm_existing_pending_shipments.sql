-- Older shipment creation treated confirmed item quantities as pending drafts.
-- Confirm those item-bearing records and derive invoice state from actual quantities.
INSERT INTO shipment_status_history (shipment_id, old_status, new_status, changed_by, notes)
SELECT s.id, 'pending', 'shipped', s.created_by,
       'Existing confirmed shipment normalized to shipped during status repair.'
FROM shipments s
WHERE s.status = 'pending'
  AND EXISTS (SELECT 1 FROM shipment_items si WHERE si.shipment_id = s.id);

UPDATE shipments
SET status = 'shipped',
    shipped_at = COALESCE(shipped_at, created_at),
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'pending'
  AND EXISTS (SELECT 1 FROM shipment_items si WHERE si.shipment_id = shipments.id);

UPDATE invoices
SET shipping_status = CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM invoice_items ii
        WHERE ii.invoice_id = invoices.id
          AND COALESCE((
            SELECT SUM(si.quantity)
            FROM shipment_items si
            JOIN shipments s ON s.id = si.shipment_id
            WHERE si.invoice_item_id = ii.id AND s.status = 'shipped'
          ), 0) > 0
      ) THEN 'pending'
      WHEN NOT EXISTS (
        SELECT 1
        FROM invoice_items ii
        WHERE ii.invoice_id = invoices.id
          AND COALESCE((
            SELECT SUM(si.quantity)
            FROM shipment_items si
            JOIN shipments s ON s.id = si.shipment_id
            WHERE si.invoice_item_id = ii.id AND s.status = 'shipped'
          ), 0) < ii.quantity
      ) THEN 'shipped'
      ELSE 'partially_shipped'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE payment_status != 'cancelled';
