-- Merging duplicate patient records.
--
-- Two records for one person is the commonest mess a busy front desk makes:
-- somebody returns with a new phone number, or the same name is typed twice on
-- a Monday morning. This application could warn about it at registration and
-- could do nothing about it afterwards — there was no merge, anywhere.
--
-- The loser of a merge is deactivated, not deleted. Its patient ID is already
-- written on prescriptions, receipts and lab dockets, and somebody looking it
-- up later should be told where the record went rather than shown nothing.
ALTER TABLE "Patient" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Patient" ADD COLUMN "mergedAt" TIMESTAMP(3);

-- SET NULL rather than CASCADE: if the surviving record is ever removed, the
-- merged one should lose its pointer, not be deleted along with it.
ALTER TABLE "Patient"
  ADD CONSTRAINT "Patient_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Patient_mergedIntoId_idx" ON "Patient"("mergedIntoId");
