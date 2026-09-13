-- Replace India's two-component GST with a single configurable tax line.
--
-- Written by hand rather than taken from `prisma migrate diff`, which emits
-- DROP COLUMN + ADD COLUMN and would silently discard the tax already recorded
-- against issued invoices. An invoice that charged 18% must keep showing 18%:
-- you do not restate a document the patient has already been given.

-- ---------------------------------------------------------------------------
-- Hospital: tax identifiers renamed, tax settings added
-- ---------------------------------------------------------------------------
ALTER TABLE "Hospital" RENAME COLUMN "gstNumber" TO "taxRegistrationNo";
ALTER TABLE "Hospital" RENAME COLUMN "panNumber" TO "nationalTaxNo";

ALTER TABLE "Hospital"
  ADD COLUMN "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxLabel" TEXT NOT NULL DEFAULT 'Sales Tax';

-- ---------------------------------------------------------------------------
-- Invoice: two components collapse into one, carrying their values across
-- ---------------------------------------------------------------------------
ALTER TABLE "Invoice"
  ADD COLUMN "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CGST and SGST were always levied together on the same base, so their sum is
-- the single rate that was actually applied.
UPDATE "Invoice"
SET "taxRate" = COALESCE("cgstRate", 0) + COALESCE("sgstRate", 0),
    "taxAmount" = COALESCE("cgstAmount", 0) + COALESCE("sgstAmount", 0);

ALTER TABLE "Invoice"
  DROP COLUMN "cgstRate",
  DROP COLUMN "sgstRate",
  DROP COLUMN "cgstAmount",
  DROP COLUMN "sgstAmount";

-- ---------------------------------------------------------------------------
-- Trading partners: same rename
-- ---------------------------------------------------------------------------
ALTER TABLE "Supplier" RENAME COLUMN "gstNumber" TO "taxRegistrationNo";
ALTER TABLE "LabVendor" RENAME COLUMN "gstNumber" TO "taxRegistrationNo";
