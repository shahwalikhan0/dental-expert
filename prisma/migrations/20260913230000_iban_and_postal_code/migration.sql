-- bankIfsc -> bankIban, pincode -> postalCode.
--
-- IFSC is India's bank routing identifier; Pakistani accounts are identified by
-- a 24-character IBAN. "PIN code" is India's term for what Pakistan Post calls
-- a postal code.
--
-- Written by hand. `prisma migrate diff` emits DROP COLUMN + ADD COLUMN for
-- each of these across five tables, which would discard every bank account
-- detail and every address on file. Renames keep them.
--
-- The values carried across are whatever was previously entered. An IFSC code
-- is not a valid IBAN, so anything migrated off an Indian deployment needs
-- re-collecting — but an identifier that needs re-typing is better than one
-- that has been deleted.

-- AlterTable
ALTER TABLE "Hospital" RENAME COLUMN "bankIfsc" TO "bankIban";
ALTER TABLE "Hospital" RENAME COLUMN "pincode" TO "postalCode";

-- AlterTable
ALTER TABLE "Staff" RENAME COLUMN "bankIfsc" TO "bankIban";
ALTER TABLE "Staff" RENAME COLUMN "pincode" TO "postalCode";

-- AlterTable
ALTER TABLE "Supplier" RENAME COLUMN "bankIfsc" TO "bankIban";
ALTER TABLE "Supplier" RENAME COLUMN "pincode" TO "postalCode";

-- AlterTable
ALTER TABLE "Patient" RENAME COLUMN "pincode" TO "postalCode";

-- AlterTable
ALTER TABLE "LabVendor" RENAME COLUMN "pincode" TO "postalCode";
