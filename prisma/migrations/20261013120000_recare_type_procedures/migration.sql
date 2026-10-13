-- Which procedures count as the visit for a recall type (bug report 12 Oct,
-- finding 46). Completing a treatment moves the patient's recalls whose type
-- is linked to the treatment's procedure. Until now there was no link, and the
-- application guessed one from the names; this is the stored link that
-- replaces the guess. Implicit Prisma many-to-many: "A" is Procedure, "B" is
-- RecareType (the model whose name sorts first is "A").

-- CreateTable
CREATE TABLE "_ProcedureToRecareType" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_ProcedureToRecareType_AB_unique" ON "_ProcedureToRecareType"("A", "B");

-- CreateIndex
CREATE INDEX "_ProcedureToRecareType_B_index" ON "_ProcedureToRecareType"("B");

-- AddForeignKey
ALTER TABLE "_ProcedureToRecareType" ADD CONSTRAINT "_ProcedureToRecareType_A_fkey" FOREIGN KEY ("A") REFERENCES "Procedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProcedureToRecareType" ADD CONSTRAINT "_ProcedureToRecareType_B_fkey" FOREIGN KEY ("B") REFERENCES "RecareType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: the links the name-matching code made at completion time, written
-- down once, so every existing clinic keeps exactly today's behaviour and can
-- then change it on the recall types screen. These are the three families of
-- the retired `RECARE_PROCEDURE_FAMILIES` (lib/recare.ts), translated from
-- case-insensitive JavaScript regexes to PostgreSQL's `~*`. A recall type and
-- a procedure are only ever linked within the same clinic. Active or not, as
-- before: the old match did not look at either side's isActive.
--
--  - hygiene: type name says scale/scaling/polish/hygiene/clean/prophy, and so
--    does the procedure's, in PREVENTIVE or PERIODONTIC;
--  - periodontal: type name says perio, procedure name says perio, root
--    planing or debridement, in PERIODONTIC or PREVENTIVE;
--  - examination: type name says check-up or exam, and so does the
--    procedure's, in DIAGNOSTIC or PREVENTIVE.
INSERT INTO "_ProcedureToRecareType" ("A", "B")
SELECT DISTINCT p."id", t."id"
FROM "RecareType" t
JOIN "Procedure" p ON p."hospitalId" = t."hospitalId"
WHERE
  (
    t."name" ~* 'scal(e|ing)|polish|hygien|clean|prophy'
    AND p."name" ~* 'scal(e|ing)|polish|clean|prophy|hygien'
    AND p."category" IN ('PREVENTIVE', 'PERIODONTIC')
  )
  OR (
    t."name" ~* 'perio'
    AND p."name" ~* 'perio|root planing|debridement'
    AND p."category" IN ('PERIODONTIC', 'PREVENTIVE')
  )
  OR (
    t."name" ~* 'check[[:space:]-]?up|exam'
    AND p."name" ~* 'check[[:space:]-]?up|exam'
    AND p."category" IN ('DIAGNOSTIC', 'PREVENTIVE')
  )
ON CONFLICT DO NOTHING;
