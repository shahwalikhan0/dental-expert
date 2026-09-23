-- Boilerplate clinical notes on the procedure catalogue.
--
-- Purely additive, and every column is nullable with no backfill: an existing
-- procedure simply has no defaults, and a treatment written from it behaves
-- exactly as it does today. Nothing reads these at render time -- they are
-- copied onto the Treatment when it is created -- so existing notes, signed or
-- otherwise, cannot be changed by this migration or by any later edit to the
-- catalogue. See the comments on model Procedure.

-- AlterTable
ALTER TABLE "Procedure" ADD COLUMN     "defaultDiagnosis" TEXT,
ADD COLUMN     "defaultFindings" TEXT,
ADD COLUMN     "defaultFollowUpDays" INTEGER,
ADD COLUMN     "defaultProcedureNotes" TEXT;
