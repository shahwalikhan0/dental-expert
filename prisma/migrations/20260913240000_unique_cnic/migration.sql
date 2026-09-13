-- One CNIC, one person (FR-002 Duplicate Prevention).
--
-- A CNIC identifies exactly one citizen, so two patient records carrying the
-- same one are the same patient entered twice.
--
-- PostgreSQL treats NULLs as distinct in a unique index, which is what makes
-- this workable: children are issued a B-Form rather than a CNIC, and plenty
-- of adults arrive without theirs, so most rows will have no value here and
-- none of them collide.
--
-- If this migration fails with a unique-violation, the database already holds
-- duplicates and they have to be merged first. To find them:
--
--   SELECT "hospitalId", "cnic", count(*)
--   FROM "Patient" WHERE "cnic" IS NOT NULL
--   GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Deliberately not cleaned up automatically: deciding which of two patient
-- records is the real one, and what happens to the appointments and invoices
-- hanging off the other, is a judgement about a person's medical history.

-- CreateIndex
CREATE UNIQUE INDEX "Patient_hospitalId_cnic_key" ON "Patient"("hospitalId", "cnic");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_hospitalId_cnic_key" ON "Staff"("hospitalId", "cnic");
