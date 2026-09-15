-- Four tables nothing has ever written to.
--
-- Each was found the same way: grep every Prisma call across app/, lib/,
-- tests/ and the seed, then look at what reads them. All four are empty in a
-- freshly seeded database, which is the whole story.
--
--   SupplierItem         Read once, through a relation on the inventory list,
--                        to fill a "Supplier" column — from a table nothing
--                        populates, so the column was always blank. The list
--                        now reads InventoryItem.preferredSupplier, which the
--                        item form does write, so the column works for the
--                        first time.
--
--   SubscriptionInvoice  Nothing issues one. Platform billing has no payment
--                        processor (see docs/DEFERRED.md), and the tenant
--                        console included an invoice list that was always
--                        empty. Reinstate it with the processor.
--
--   BulkCommunication    Read by one analytics query, written by nothing. The
--                        bulk-SMS route sends the messages and records no
--                        campaign, so "Recent Campaigns" never had a row.
--
--   Notification         Listed and marked-as-read by /api/notifications, and
--                        created by nothing. The bell in the header has shown
--                        zero since the fork. A bell that never rings is a
--                        promise the product does not keep; the route, the
--                        tray and the table all go together.
--
-- If in-app notifications are wanted later, the discount approval in §7 is the
-- obvious first one to raise — it already has an approver waiting on it.

ALTER TABLE "BulkCommunication" DROP CONSTRAINT "BulkCommunication_hospitalId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_hospitalId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";
ALTER TABLE "SubscriptionInvoice" DROP CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey";
ALTER TABLE "SupplierItem" DROP CONSTRAINT "SupplierItem_itemId_fkey";
ALTER TABLE "SupplierItem" DROP CONSTRAINT "SupplierItem_supplierId_fkey";

DROP TABLE "BulkCommunication";
DROP TABLE "Notification";
DROP TABLE "SubscriptionInvoice";
DROP TABLE "SupplierItem";

DROP TYPE "BulkCommStatus";
DROP TYPE "NotificationType";
DROP TYPE "SubscriptionInvoiceStatus";
