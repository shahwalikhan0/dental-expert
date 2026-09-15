-- Expiry alerts (FR-016), which have never been raised.
--
-- `StockAlertType` has had EXPIRING_SOON and EXPIRED since the fork with no
-- code that creates either, so both counts were structurally zero. Until goods
-- receipt existed there were also no expiry dates to raise them from: batches
-- were created only by the seed.
--
-- An expiry alert is about one batch, not the item. Two batches of the same
-- composite expire on different days, and acknowledging the one going out of
-- date next must not silence the one behind it — so the alert carries the
-- batch it is about. Shortage alerts are about the item as a whole and leave
-- it null.
--
-- ON DELETE CASCADE: an alert about a batch that no longer exists is not
-- information, and the daily sweep would delete it on its next run anyway.
ALTER TABLE "StockAlert" ADD COLUMN "batchId" TEXT;

ALTER TABLE "StockAlert"
  ADD CONSTRAINT "StockAlert_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "StockAlert_batchId_alertType_isAcknowledged_idx"
  ON "StockAlert"("batchId", "alertType", "isAcknowledged");
