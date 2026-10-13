-- A plan item knows the treatment that carries it out, so finishing the
-- treatment can finish the item; a lab order knows the treatment it is for.
-- Both nullable: existing rows have no link and nothing can be inferred for
-- them safely.
ALTER TABLE "TreatmentPlanItem" ADD COLUMN "treatmentId" TEXT;
CREATE UNIQUE INDEX "TreatmentPlanItem_treatmentId_key" ON "TreatmentPlanItem"("treatmentId");
ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LabOrder" ADD COLUMN "treatmentId" TEXT;
CREATE INDEX "LabOrder_treatmentId_idx" ON "LabOrder"("treatmentId");
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
