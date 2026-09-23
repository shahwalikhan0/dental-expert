-- Prescription templates, and the three things an issued prescription now
-- remembers about where it came from.
--
-- Every column added to "Prescription" is nullable and every table is new, so
-- this migration cannot fail on existing data and nothing is backfilled: a
-- prescription written before today has no template, no treatment and no teeth,
-- which is the truth about it.
--
-- The two foreign keys on "Prescription" are ON DELETE SET NULL on purpose. A
-- template is meant to be deactivated rather than deleted, but if one is ever
-- removed the prescriptions issued from it must survive — they hold their own
-- copy of every medicine in "PrescriptionMedication", and losing the row would
-- destroy a clinical record to tidy up a piece of stationery.

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "toothNumbers" TEXT,
ADD COLUMN     "treatmentId" TEXT;

-- CreateTable
CREATE TABLE "PrescriptionTemplate" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "diagnosis" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "medicationId" TEXT,
    "medicationName" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "route" TEXT NOT NULL DEFAULT 'Oral',
    "timing" TEXT,
    "quantity" INTEGER,
    "instructions" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrescriptionTemplate_hospitalId_isActive_name_idx" ON "PrescriptionTemplate"("hospitalId", "isActive", "name");

-- CreateIndex
CREATE INDEX "PrescriptionTemplate_createdById_idx" ON "PrescriptionTemplate"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionTemplate_hospitalId_name_key" ON "PrescriptionTemplate"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "PrescriptionTemplateItem_templateId_sortOrder_idx" ON "PrescriptionTemplateItem"("templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "PrescriptionTemplateItem_medicationId_idx" ON "PrescriptionTemplateItem"("medicationId");

-- CreateIndex
CREATE INDEX "Prescription_hospitalId_treatmentId_idx" ON "Prescription"("hospitalId", "treatmentId");

-- CreateIndex
CREATE INDEX "Prescription_templateId_idx" ON "Prescription"("templateId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PrescriptionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplate" ADD CONSTRAINT "PrescriptionTemplate_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplate" ADD CONSTRAINT "PrescriptionTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplateItem" ADD CONSTRAINT "PrescriptionTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PrescriptionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplateItem" ADD CONSTRAINT "PrescriptionTemplateItem_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

