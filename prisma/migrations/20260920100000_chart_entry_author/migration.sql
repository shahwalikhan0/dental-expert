-- A charted finding had no author.
--
-- `DentalChartEntry` recorded what was seen, on which tooth, and when — and
-- nothing about who saw it. That is the one column a clinical record cannot do
-- without: §2 of the specification asks that sensitive changes be attributable
-- to a user and a timestamp, and UAT-04 asks for the encounter to be saved
-- "with author/date". The treatment note has had `signedById` all along; the
-- chart it is written against had nothing.
--
-- Nullable, and existing rows keep NULL. Backfilling this from, say, whoever
-- last touched the patient would put a name against a finding that person may
-- never have made. An empty author is honest; a wrong one is evidence.
ALTER TABLE "DentalChartEntry" ADD COLUMN "recordedById" TEXT;

ALTER TABLE "DentalChartEntry"
  ADD CONSTRAINT "DentalChartEntry_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Answers "what has this clinician charted", which is how the column gets used
-- once it exists.
CREATE INDEX "DentalChartEntry_recordedById_idx" ON "DentalChartEntry"("recordedById");
