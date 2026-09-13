-- Daily closing (FR-015) and the discount/refund approval trail (FR-013/014).
--
-- Unlike the tax and chair migrations, this one is taken verbatim from
-- `prisma migrate diff`: it is purely additive — new enums, new nullable
-- columns and new tables — so there is nothing for a generated DROP to
-- discard.
--
-- Existing refunds are deliberately NOT backfilled into `Refund`. The old
-- implementation recorded amount, date and reason on the Payment row but no
-- authoriser, and `Refund.authorisedById` is NOT NULL: there is no honest
-- value to invent for a refund nobody is recorded as having approved. The
-- legacy `Payment.refundAmount/refundDate/refundReason` columns stay, and
-- continue to hold the running total, so historical reads are unaffected.

-- CreateEnum
CREATE TYPE "CashierSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "DiscountApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "discountApprovalStatus" "DiscountApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "discountApprovedById" TEXT,
ADD COLUMN     "discountDecidedAt" TIMESTAMP(3),
ADD COLUMN     "discountDecisionNote" TEXT,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountRequestedById" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cashierSessionId" TEXT,
ADD COLUMN     "recordedById" TEXT;

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "refundNo" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "refundMethod" "PaymentMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "authorisedById" TEXT NOT NULL,
    "cashierSessionId" TEXT,
    "transactionId" TEXT,
    "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierSession" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "sessionNo" TEXT NOT NULL,
    "status" "CashierSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openingFloat" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingNotes" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closingNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashierSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierSessionCount" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "expectedAmount" DECIMAL(10,2) NOT NULL,
    "countedAmount" DECIMAL(10,2) NOT NULL,
    "varianceAmount" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashierSessionCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Refund_hospitalId_idx" ON "Refund"("hospitalId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Refund_cashierSessionId_idx" ON "Refund"("cashierSessionId");

-- CreateIndex
CREATE INDEX "Refund_refundedAt_idx" ON "Refund"("refundedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_hospitalId_refundNo_key" ON "Refund"("hospitalId", "refundNo");

-- CreateIndex
CREATE INDEX "CashierSession_hospitalId_idx" ON "CashierSession"("hospitalId");

-- CreateIndex
CREATE INDEX "CashierSession_status_idx" ON "CashierSession"("status");

-- CreateIndex
CREATE INDEX "CashierSession_openedAt_idx" ON "CashierSession"("openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashierSession_hospitalId_sessionNo_key" ON "CashierSession"("hospitalId", "sessionNo");

-- CreateIndex
CREATE INDEX "CashierSessionCount_sessionId_idx" ON "CashierSessionCount"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CashierSessionCount_sessionId_paymentMethod_key" ON "CashierSessionCount"("sessionId", "paymentMethod");

-- CreateIndex
CREATE INDEX "Payment_cashierSessionId_idx" ON "Payment"("cashierSessionId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_discountRequestedById_fkey" FOREIGN KEY ("discountRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_discountApprovedById_fkey" FOREIGN KEY ("discountApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_authorisedById_fkey" FOREIGN KEY ("authorisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cashierSessionId_fkey" FOREIGN KEY ("cashierSessionId") REFERENCES "CashierSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierSession" ADD CONSTRAINT "CashierSession_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierSession" ADD CONSTRAINT "CashierSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierSession" ADD CONSTRAINT "CashierSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierSessionCount" ADD CONSTRAINT "CashierSessionCount_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashierSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashierSessionId_fkey" FOREIGN KEY ("cashierSessionId") REFERENCES "CashierSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

