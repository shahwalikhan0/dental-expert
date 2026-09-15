-- Goods receipt.
--
-- `PurchaseOrder`, `PurchaseOrderItem`, `InventoryBatch` and `SupplierItem`
-- have been in the schema since the fork with nothing writing to any of them.
-- This migration prepares them for the routes that now do.
--
-- Three changes, all structural. No table is created and no column is dropped.

-- 1. An order line could name an inventory item that does not exist.
--
-- `PurchaseOrderItem.itemId` was a bare string: no foreign key, no relation, no
-- index. That is why the model had no `item` field to include, and why a line
-- had to be joined by hand.
--
-- The UPDATE is a safety net rather than a fix: nothing has ever written this
-- table, so it should match nothing. If it does match something, deleting the
-- orphan is the only way the constraint can be added, and an order line
-- pointing at a deleted item is not information anybody can use.
DELETE FROM "PurchaseOrderItem" poi
WHERE NOT EXISTS (SELECT 1 FROM "InventoryItem" i WHERE i.id = poi."itemId");

CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");
CREATE INDEX "PurchaseOrderItem_itemId_idx" ON "PurchaseOrderItem"("itemId");

ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. A batch number identifies one delivery of one item.
--
-- Receiving is idempotent-adjacent: the same delivery note gets entered twice
-- often enough that it needs to be an error rather than a second batch with the
-- same number and its own expiry date. Scoped to the clinic as well as the item
-- because two clinics buying from the same supplier receive the same batch
-- number, and that is not a conflict.
CREATE UNIQUE INDEX "InventoryBatch_hospitalId_itemId_batchNumber_key"
  ON "InventoryBatch"("hospitalId", "itemId", "batchNumber");

-- 3. `PurchaseOrderStatus` loses SUBMITTED and APPROVED.
--
-- They described an internal approval chain that was never built: no approver
-- capability, no queue to approve from, no notification. Recreating the type is
-- the only way Postgres removes a value.
--
-- The UPDATE runs first because the cast below fails on any row still holding a
-- value the new type does not have. Both collapse to ORDERED: an order that had
-- been submitted or approved was, in either case, placed and not yet received.
BEGIN;

UPDATE "PurchaseOrder"
SET "status" = 'ORDERED'
WHERE "status" IN ('SUBMITTED', 'APPROVED');

CREATE TYPE "PurchaseOrderStatus_new" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" TYPE "PurchaseOrderStatus_new" USING ("status"::text::"PurchaseOrderStatus_new");
ALTER TYPE "PurchaseOrderStatus" RENAME TO "PurchaseOrderStatus_old";
ALTER TYPE "PurchaseOrderStatus_new" RENAME TO "PurchaseOrderStatus";
DROP TYPE "PurchaseOrderStatus_old";
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

COMMIT;
