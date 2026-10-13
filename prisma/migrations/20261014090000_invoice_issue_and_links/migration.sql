-- Invoices: when they were issued, which visit they bill, and products sold
-- over the counter (invoice review, 14 Oct).
--
-- issuedAt dates billed figures. createdAt is when the draft was started, so a
-- draft from last month issued today was being counted in last month.
--
-- A "Due on receipt" invoice used to be stored with no due date, and each
-- screen guessed differently what that meant (bug report item 5). It now means
-- due on the day it was issued; issued invoices without one get their issue day.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "appointmentId" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "inventoryItemId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_appointmentId_idx" ON "Invoice"("appointmentId");

-- CreateIndex
CREATE INDEX "InvoiceItem_inventoryItemId_idx" ON "InvoiceItem"("inventoryItemId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: anything already past DRAFT was issued when it was created.
UPDATE "Invoice" SET "issuedAt" = "createdAt" WHERE status <> 'DRAFT' AND "issuedAt" IS NULL;
UPDATE "Invoice" SET "dueDate" = "issuedAt" WHERE status <> 'DRAFT' AND "dueDate" IS NULL;
