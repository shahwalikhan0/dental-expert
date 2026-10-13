-- SKUs saved before they were normalised (bug report 12 Oct, finding 57).
--
-- New and edited items are stored trimmed and upper-cased (normaliseSku in
-- lib/inventory-items.ts), so `cmp-a2` can no longer be saved beside
-- `CMP-A2`. Rows saved before that keep whatever case they were typed in. This
-- brings them to the same spelling.
--
-- Two rows in one clinic can normalise to the same SKU — the very duplicate
-- the finding describes. Neither is merged: they may hold different stock,
-- batches and history, and deciding which is right is a stock-take, not a
-- migration. The row that keeps the plain SKU is, in order: one already
-- spelled that way, a live one over a deleted one, the oldest. Every other row
-- gets `-DUP2`, `-DUP3`, ... so the duplicates are visible on the item list
-- and can be merged or renamed by hand.

DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT
      id,
      "hospitalId",
      UPPER(BTRIM(sku)) AS norm,
      sku = UPPER(BTRIM(sku)) AS already,
      ROW_NUMBER() OVER (
        PARTITION BY "hospitalId", UPPER(BTRIM(sku))
        ORDER BY (sku = UPPER(BTRIM(sku))) DESC, ("deletedAt" IS NULL) DESC, "createdAt", id
      ) AS rn
    FROM "InventoryItem"
    WHERE BTRIM(sku) <> ''
  LOOP
    CONTINUE WHEN r.already AND r.rn = 1;

    IF r.rn = 1 THEN
      candidate := r.norm;
    ELSE
      n := r.rn;
      LOOP
        candidate := r.norm || '-DUP' || n;
        -- Free now, and not what a row still waiting in this loop will
        -- normalise to.
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM "InventoryItem"
          WHERE "hospitalId" = r."hospitalId"
            AND (sku = candidate OR UPPER(BTRIM(sku)) = candidate)
        );
        n := n + 1;
      END LOOP;
    END IF;

    UPDATE "InventoryItem" SET sku = candidate WHERE id = r.id;
  END LOOP;
END $$;
