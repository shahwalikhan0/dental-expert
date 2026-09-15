-- UPI is India's instant-payment rail. No Pakistani clinic can take one.
--
-- The two things a Pakistani patient actually pays with already had values in
-- this enum: a mobile wallet (JazzCash, Easypaisa, SadaPay) is WALLET, and
-- Raast or an interbank transfer is BANK_TRANSFER. Keeping UPI meant a payment
-- method on the till screen nobody could select honestly, and a line on every
-- daily reconciliation that was always zero.
--
-- Anything recorded as UPI becomes WALLET: it was taken on a phone, and WALLET
-- is where that money belongs in a reconciliation.

-- ---------------------------------------------------------------------------
-- 1. Move the rows off UPI before the value goes.
--
-- The counts have to be merged rather than updated. `CashierSessionCount` is
-- unique on (sessionId, paymentMethod), so a session that counted both UPI and
-- WALLET would collide — and the answer is to add the two together, not to
-- drop one of them. This is a till reconciliation; losing a line loses money.
-- ---------------------------------------------------------------------------

UPDATE "CashierSessionCount" c
SET "expectedAmount" = c."expectedAmount" + u."expectedAmount",
    "countedAmount"  = c."countedAmount"  + u."countedAmount",
    "varianceAmount" = c."varianceAmount" + u."varianceAmount",
    "notes" = NULLIF(concat_ws(E'\n', NULLIF(c."notes", ''), NULLIF(u."notes", '')), '')
FROM "CashierSessionCount" u
WHERE u."sessionId" = c."sessionId"
  AND u."paymentMethod" = 'UPI'
  AND c."paymentMethod" = 'WALLET';

DELETE FROM "CashierSessionCount"
WHERE "paymentMethod" = 'UPI'
  AND "sessionId" IN (SELECT "sessionId" FROM "CashierSessionCount" WHERE "paymentMethod" = 'WALLET');

UPDATE "CashierSessionCount" SET "paymentMethod" = 'WALLET' WHERE "paymentMethod" = 'UPI';
UPDATE "Payment" SET "paymentMethod" = 'WALLET' WHERE "paymentMethod" = 'UPI';
UPDATE "Refund" SET "refundMethod" = 'WALLET' WHERE "refundMethod" = 'UPI';

-- ---------------------------------------------------------------------------
-- 2. Rebuild the enum without it.
--
-- PostgreSQL has no DROP VALUE, so the type is replaced wholesale and every
-- column that uses it is re-typed. The defaults are dropped first: a column
-- default referencing the old type blocks the ALTER.
-- ---------------------------------------------------------------------------

CREATE TYPE "PaymentMethod_new" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'INSURANCE', 'WALLET', 'ONLINE');

ALTER TABLE "Payment"
    ALTER COLUMN "paymentMethod" TYPE "PaymentMethod_new" USING ("paymentMethod"::text::"PaymentMethod_new");
ALTER TABLE "Refund"
    ALTER COLUMN "refundMethod" TYPE "PaymentMethod_new" USING ("refundMethod"::text::"PaymentMethod_new");
ALTER TABLE "CashierSessionCount"
    ALTER COLUMN "paymentMethod" TYPE "PaymentMethod_new" USING ("paymentMethod"::text::"PaymentMethod_new");

DROP TYPE "PaymentMethod";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";

-- ---------------------------------------------------------------------------
-- 3. The two columns that named the rail
--
-- `Payment.upiId` recorded the payer's handle for a UPI payment — the same kind
-- of thing `transactionId` beside it already holds, for every rail rather than
-- one. `Hospital.upiId` is a payment handle to print on an invoice; renamed
-- rather than dropped, because a Pakistani clinic does print a JazzCash or
-- Easypaisa number and nothing else covers that.
-- ---------------------------------------------------------------------------

UPDATE "Payment"
SET "transactionId" = "upiId"
WHERE "transactionId" IS NULL AND "upiId" IS NOT NULL;

ALTER TABLE "Payment" DROP COLUMN "upiId";
ALTER TABLE "Hospital" RENAME COLUMN "upiId" TO "mobileWalletId";
