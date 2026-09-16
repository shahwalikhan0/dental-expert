-- The last of the insurance module.
--
-- `39fdd2e` removed the insurance tables as out of scope. What it left behind
-- was a 517-line patient insurance panel, rendered as a tab on the patient
-- record, calling three endpoints that do not exist:
--
--     GET  /api/patients/{id}/insurance
--     GET  /api/insurance-providers
--     POST /api/patients/{id}/insurance/verify
--
-- plus three links on the billing screen to pages that are not there, an
-- "Insurance Claims" figure on the billing dashboard read from a field the
-- reports route never returns, an insurance-claim card on every invoice fed by
-- a relation that no longer exists, and `generateClaimNo()` in billing-utils
-- querying `prisma.insuranceClaim` — a model that would throw the moment
-- anything called it.
--
-- The clinic does not handle patient insurance, so the enum values go too.
--
--   PaymentMethod.INSURANCE   a method on the till nobody could choose
--                             honestly, and a column on the daily collection
--                             report that was always zero — the same shape as
--                             UPI in §18.1
--
--   DocumentType.INSURANCE    a category for a document class the clinic has
--                             no use for
--
-- Both enums are recreated, which is the only way Postgres removes a value.
-- The UPDATEs are safety nets: no row in a seeded database holds either value,
-- and anything that does is moved somewhere honest rather than blocking the
-- cast. An insurance payment becomes BANK_TRANSFER, which is how a settlement
-- would actually have arrived; an insurance document becomes OTHER.

BEGIN;

UPDATE "Payment" SET "paymentMethod" = 'BANK_TRANSFER' WHERE "paymentMethod" = 'INSURANCE';
UPDATE "Refund" SET "refundMethod" = 'BANK_TRANSFER' WHERE "refundMethod" = 'INSURANCE';
UPDATE "CashierSessionCount" SET "paymentMethod" = 'BANK_TRANSFER'
  WHERE "paymentMethod" = 'INSURANCE'
  -- The session may already hold a bank-transfer count; @@unique([sessionId,
  -- paymentMethod]) would reject a second one.
  AND NOT EXISTS (
    SELECT 1 FROM "CashierSessionCount" other
    WHERE other."sessionId" = "CashierSessionCount"."sessionId"
      AND other."paymentMethod" = 'BANK_TRANSFER'
  );
DELETE FROM "CashierSessionCount" WHERE "paymentMethod" = 'INSURANCE';

CREATE TYPE "PaymentMethod_new" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'WALLET', 'ONLINE');
ALTER TABLE "Payment" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod_new" USING ("paymentMethod"::text::"PaymentMethod_new");
ALTER TABLE "Refund" ALTER COLUMN "refundMethod" TYPE "PaymentMethod_new" USING ("refundMethod"::text::"PaymentMethod_new");
ALTER TABLE "CashierSessionCount" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod_new" USING ("paymentMethod"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "PaymentMethod_old";

UPDATE "Document" SET "documentType" = 'OTHER' WHERE "documentType" = 'INSURANCE';

CREATE TYPE "DocumentType_new" AS ENUM ('XRAY', 'CT_SCAN', 'PHOTO', 'CONSENT_FORM', 'PRESCRIPTION', 'LAB_REPORT', 'ID_PROOF', 'OTHER');
ALTER TABLE "Document" ALTER COLUMN "documentType" TYPE "DocumentType_new" USING ("documentType"::text::"DocumentType_new");
ALTER TYPE "DocumentType" RENAME TO "DocumentType_old";
ALTER TYPE "DocumentType_new" RENAME TO "DocumentType";
DROP TYPE "DocumentType_old";

COMMIT;
