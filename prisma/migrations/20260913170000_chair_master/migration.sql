-- Chair master (FR-025) and chair-aware conflict detection (FR-004).
--
-- `Appointment.chairNumber` was a bare integer typed into a hardcoded 1..5
-- dropdown: the clinic could not name its operatories, deactivate one for
-- servicing, or report utilisation against a real list. This replaces it with a
-- `Chair` record per clinic.
--
-- Written by hand rather than taken from `prisma migrate diff`, which emits
-- DROP COLUMN "chairNumber" + ADD COLUMN "chairId" in a single AlterTable and
-- would discard every existing chair assignment. The order below is:
-- create the table, add the nullable FK column, promote the integers already in
-- use into real chairs, repoint the appointments, and only then drop the old
-- column.

-- CreateTable
CREATE TABLE "Chair" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "room" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Chair_hospitalId_idx" ON "Chair"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "Chair_hospitalId_name_key" ON "Chair"("hospitalId", "name");

-- AddForeignKey
ALTER TABLE "Chair" ADD CONSTRAINT "Chair_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "chairId" TEXT;

-- Backfill: every (clinic, chairNumber) pair in use becomes a named chair.
INSERT INTO "Chair" ("id", "hospitalId", "name", "sortOrder", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::TEXT,
    d."hospitalId",
    'Chair ' || d."chairNumber",
    d."chairNumber",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT "hospitalId", "chairNumber"
    FROM "Appointment"
    WHERE "chairNumber" IS NOT NULL
) AS d
ON CONFLICT ("hospitalId", "name") DO NOTHING;

UPDATE "Appointment" AS a
SET "chairId" = c."id"
FROM "Chair" AS c
WHERE a."chairNumber" IS NOT NULL
  AND c."hospitalId" = a."hospitalId"
  AND c."name" = 'Chair ' || a."chairNumber";

-- AlterTable
ALTER TABLE "Appointment" DROP COLUMN "chairNumber";

-- CreateIndex
CREATE INDEX "Appointment_chairId_idx" ON "Appointment"("chairId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_chairId_fkey" FOREIGN KEY ("chairId") REFERENCES "Chair"("id") ON DELETE SET NULL ON UPDATE CASCADE;
