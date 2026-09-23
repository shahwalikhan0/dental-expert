-- Join the drug catalogue to the shelf.
--
-- Medication said what could be prescribed; InventoryItem said what was in
-- stock; nothing connected them, so "is this drug actually available?" was a
-- question the schema could not answer. This adds the one column that joins
-- them.
--
-- Additive and nullable, with no backfill: existing stock stays unlinked until
-- somebody links it, and nothing reads the column in a way that treats null as
-- an error. Matching on name was considered and rejected -- "Amoxicillin 500mg"
-- and "Amoxicillin 500 mg Caps (10x10)" are the same drug to a person and not
-- to a string comparison, and a wrong automatic link is harder to notice than
-- no link at all.
--
-- ON DELETE SET NULL: retiring a catalogue entry must not delete the stock
-- record, its batches or its purchase history.

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "medicationId" TEXT;

-- CreateIndex
CREATE INDEX "InventoryItem_medicationId_idx" ON "InventoryItem"("medicationId");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
