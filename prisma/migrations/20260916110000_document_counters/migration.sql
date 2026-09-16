-- One counter per clinic per number series.
--
-- Every reference number in the application was produced by reading the
-- highest existing one and adding one:
--
--     const last = await prisma.invoice.findFirst({ orderBy: { invoiceNo: 'desc' } })
--     return `${prefix}${String(lastNumber + 1).padStart(4, '0')}`
--
-- Between the read and the write there is a gap. Two receptionists billing in
-- the same second fall into it, the second write loses to
-- @@unique([hospitalId, invoiceNo]), and what the cashier sees is a 500 and no
-- invoice. Thirteen generators had this shape.
--
-- `series` is the number's own prefix, which already encodes whatever resets
-- the count — INV-202609- rolls monthly, APT2026 yearly — so a new period is
-- simply a series nobody has used yet, and there is nothing to backfill for
-- it. For the period in progress the application seeds the counter from the
-- highest number already issued, on the first call only.
CREATE TABLE "DocumentCounter" (
    "hospitalId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("hospitalId","series")
);

ALTER TABLE "DocumentCounter"
  ADD CONSTRAINT "DocumentCounter_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
