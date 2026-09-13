-- Aadhaar -> CNIC, and drop the Indian state default.
--
-- Written by hand. `prisma migrate diff` emits
--
--     ALTER TABLE "Patient" DROP COLUMN "aadharNumber", ADD COLUMN "cnic" TEXT;
--
-- which would discard every identity number on file. A rename keeps them.
--
-- Note for anyone migrating real data off an Indian deployment: the values
-- carried across are Aadhaar numbers (12 digits) and will not validate as a
-- CNIC (13 digits, first digit 1-7). They are preserved rather than cleared,
-- because deleting an identifier is worse than holding one that needs
-- re-capturing, but they should be re-collected.

-- AlterTable
ALTER TABLE "Staff" RENAME COLUMN "aadharNumber" TO "cnic";

-- AlterTable
ALTER TABLE "Patient" RENAME COLUMN "aadharNumber" TO "cnic";

-- The upstream default stamped "Tamil Nadu" onto every patient who did not
-- name a province. Existing rows are left alone; only the default is removed.
ALTER TABLE "Patient" ALTER COLUMN "state" DROP DEFAULT;
