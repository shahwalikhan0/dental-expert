-- Supplier and LabVendor become one Vendor table.
--
-- They shared twenty-seven columns and differed in two, both of which only a
-- laboratory uses. A dental laboratory is a supplier — of crowns rather than
-- composite — and what actually differs is what the clinic sends them, which
-- lives on LabOrder.
--
-- Every id is carried across unchanged. Both tables used cuid(), so their id
-- spaces cannot collide, which means the foreign keys pointing at them need
-- only be repointed — no row anywhere has to be rewritten.

CREATE TYPE "VendorKind" AS ENUM ('SUPPLIER', 'LAB');
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "kind" "VendorKind" NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "taxRegistrationNo" TEXT,
    "nationalTaxNo" TEXT,
    "bankAccountNo" TEXT,
    "bankIban" TEXT,
    "paymentTerms" TEXT,
    "creditLimit" DECIMAL(12,2),
    "rating" INTEGER DEFAULT 0,
    "notes" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "specializations" TEXT,
    "avgTurnaround" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- `isActive` is not carried across. Both tables had it *and* `status`, and the
-- schema comment on it admitted it merely mirrored `status != BLOCKED/INACTIVE`
-- — two columns that could disagree with nothing deciding which one won. Where
-- they do disagree, the more restrictive of the two is taken: a row flagged
-- inactive is not silently reopened by this migration.
INSERT INTO "Vendor" (
    "id", "hospitalId", "kind", "code", "name", "contactPerson", "email", "phone",
    "alternatePhone", "address", "city", "state", "postalCode",
    "taxRegistrationNo", "nationalTaxNo", "bankAccountNo", "bankIban",
    "paymentTerms", "creditLimit", "rating", "notes", "status",
    "createdAt", "updatedAt", "deletedAt"
)
SELECT
    s."id", s."hospitalId", 'SUPPLIER', s."code", s."name", s."contactPerson", s."email", s."phone",
    s."alternatePhone", s."address", s."city", s."state", s."postalCode",
    s."taxRegistrationNo", s."nationalTaxNo", s."bankAccountNo", s."bankIban",
    s."paymentTerms", s."creditLimit", s."rating", s."notes",
    CASE WHEN s."isActive" THEN s."status"::text::"VendorStatus" ELSE 'INACTIVE'::"VendorStatus" END,
    s."createdAt", s."updatedAt", s."deletedAt"
FROM "Supplier" s;

INSERT INTO "Vendor" (
    "id", "hospitalId", "kind", "code", "name", "contactPerson", "email", "phone",
    "alternatePhone", "address", "city", "state", "postalCode",
    "taxRegistrationNo", "nationalTaxNo",
    "paymentTerms", "creditLimit", "rating", "notes", "status",
    "specializations", "avgTurnaround",
    "createdAt", "updatedAt", "deletedAt"
)
SELECT
    v."id", v."hospitalId", 'LAB', v."code", v."name", v."contactPerson", v."email", v."phone",
    v."alternatePhone", v."address", v."city", v."state", v."postalCode",
    v."taxRegistrationNo", v."nationalTaxNo",
    v."paymentTerms", v."creditLimit", v."rating", v."notes",
    CASE WHEN v."isActive" THEN v."status"::text::"VendorStatus" ELSE 'INACTIVE'::"VendorStatus" END,
    v."specializations", v."avgTurnaround",
    v."createdAt", v."updatedAt", v."deletedAt"
FROM "LabVendor" v;

-- Unique per clinic *and kind*. LabVendor never had a uniqueness constraint on
-- its code at all — two laboratories could quietly share one — so including the
-- kind both fixes that and means a supplier and a laboratory may each be "V001"
-- without this migration renaming one of them.
CREATE UNIQUE INDEX "Vendor_hospitalId_kind_code_key" ON "Vendor"("hospitalId", "kind", "code");
CREATE INDEX "Vendor_hospitalId_idx" ON "Vendor"("hospitalId");
CREATE INDEX "Vendor_kind_idx" ON "Vendor"("kind");
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");
CREATE INDEX "Vendor_status_idx" ON "Vendor"("status");
CREATE INDEX "Vendor_deletedAt_idx" ON "Vendor"("deletedAt");

ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_hospitalId_fkey"
    FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Repoint the six foreign keys.
--
-- The columns keep their names. `InventoryBatch.supplierId` and
-- `LabOrder.labVendorId` both reference Vendor now, and each name still says
-- which part the vendor plays in that row — which is more than "vendorId" twice
-- over would have said.
-- ---------------------------------------------------------------------------

ALTER TABLE "InventoryBatch" DROP CONSTRAINT "InventoryBatch_supplierId_fkey";
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryItem" DROP CONSTRAINT "InventoryItem_preferredSupplierId_fkey";
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_preferredSupplierId_fkey"
    FOREIGN KEY ("preferredSupplierId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockTransaction" DROP CONSTRAINT "StockTransaction_supplierId_fkey";
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_supplierId_fkey";
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierItem" DROP CONSTRAINT "SupplierItem_supplierId_fkey";
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LabOrder" DROP CONSTRAINT "LabOrder_labVendorId_fkey";
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_labVendorId_fkey"
    FOREIGN KEY ("labVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "Supplier";
DROP TABLE "LabVendor";
DROP TYPE "SupplierStatus";
DROP TYPE "LabVendorStatus";

-- ---------------------------------------------------------------------------
-- StockAlert: two timestamps for one event
--
-- `alertDate` defaulted to now() beside `createdAt`, which also defaults to
-- now(), and nothing ever set either to anything else. `updatedAt` said only
-- when the row was acknowledged, which `acknowledgedAt` already records.
--
-- The table itself stays. The existence of an alert is derivable from stock
-- levels, but the acknowledgement on it is not — and a clinic that has already
-- ordered more gloves needs the alert to stop shouting before the stock level
-- changes.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "StockAlert_alertDate_idx";
ALTER TABLE "StockAlert"
    DROP COLUMN "alertDate",
    DROP COLUMN "updatedAt";
CREATE INDEX "StockAlert_createdAt_idx" ON "StockAlert"("createdAt");
