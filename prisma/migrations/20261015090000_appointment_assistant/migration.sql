-- The dental assistant on a visit, alongside the dentist. Optional, and kept
-- if the assistant's staff record is removed only as a cleared field.

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "assistantId" TEXT;

-- CreateIndex
CREATE INDEX "Appointment_hospitalId_assistantId_startsAt_idx" ON "Appointment"("hospitalId", "assistantId", "startsAt");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
