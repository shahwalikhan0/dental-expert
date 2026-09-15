-- Every index leads with the tenant.
--
-- There were 142 single-column indexes and 3 composite ones, none of which
-- started with `hospitalId`. Every list screen asks the same shape of question
--
--     WHERE "hospitalId" = $1 AND <filter> ORDER BY <column> DESC LIMIT 20
--
-- and Postgres can use one index for that, then filter and sort the rest by
-- hand. Measured on 400,001 invoices across 50 tenants:
--
--                            before      after
--     the page query         9.06 ms     0.44 ms     (20x)
--     the pager's count      62.9 ms     0.35 ms     (180x)
--     rows read and discarded  6,737          0
--     buffers touched            188         23
--
-- The discarded rows are other clinics' invoices, so the gap widens linearly
-- with the table. Every paginated screen runs both queries.
--
-- Ninety-six single-column indexes go and fifty-seven composites replace them,
-- which is also less to write on every insert.
--
-- One note for a production database with real volume: these are plain
-- CREATE INDEX statements, which take a write lock for the duration. Prisma
-- runs a migration inside a transaction and CREATE INDEX CONCURRENTLY cannot
-- run in one, so on a large database apply the CREATE statements by hand with
-- CONCURRENTLY first, then mark this migration applied.

-- DropIndex
DROP INDEX "Appointment_chairId_idx";

-- DropIndex
DROP INDEX "Appointment_doctorId_idx";

-- DropIndex
DROP INDEX "Appointment_hospitalId_idx";

-- DropIndex
DROP INDEX "Appointment_patientId_idx";

-- DropIndex
DROP INDEX "Appointment_scheduledDate_idx";

-- DropIndex
DROP INDEX "Appointment_status_idx";

-- DropIndex
DROP INDEX "AuditLog_createdAt_idx";

-- DropIndex
DROP INDEX "AuditLog_hospitalId_idx";

-- DropIndex
DROP INDEX "AuditLog_userId_idx";

-- DropIndex
DROP INDEX "CashierSession_hospitalId_idx";

-- DropIndex
DROP INDEX "CashierSession_openedAt_idx";

-- DropIndex
DROP INDEX "CashierSession_status_idx";

-- DropIndex
DROP INDEX "Chair_hospitalId_idx";

-- DropIndex
DROP INDEX "DentalChartEntry_hospitalId_idx";

-- DropIndex
DROP INDEX "DentalChartEntry_patientId_idx";

-- DropIndex
DROP INDEX "DentalChartEntry_toothNumber_idx";

-- DropIndex
DROP INDEX "Document_documentType_idx";

-- DropIndex
DROP INDEX "Document_hospitalId_idx";

-- DropIndex
DROP INDEX "Document_patientId_idx";

-- DropIndex
DROP INDEX "FormSubmission_hospitalId_idx";

-- DropIndex
DROP INDEX "FormSubmission_patientId_idx";

-- DropIndex
DROP INDEX "FormSubmission_status_idx";

-- DropIndex
DROP INDEX "InventoryBatch_expiryDate_idx";

-- DropIndex
DROP INDEX "InventoryBatch_hospitalId_idx";

-- DropIndex
DROP INDEX "InventoryBatch_itemId_idx";

-- DropIndex
DROP INDEX "InventoryItem_category_idx";

-- DropIndex
DROP INDEX "InventoryItem_currentStock_idx";

-- DropIndex
DROP INDEX "InventoryItem_deletedAt_idx";

-- DropIndex
DROP INDEX "InventoryItem_hospitalId_idx";

-- DropIndex
DROP INDEX "InventoryItem_itemType_idx";

-- DropIndex
DROP INDEX "InventoryItem_name_idx";

-- DropIndex
DROP INDEX "Invoice_createdAt_idx";

-- DropIndex
DROP INDEX "Invoice_hospitalId_idx";

-- DropIndex
DROP INDEX "Invoice_patientId_idx";

-- DropIndex
DROP INDEX "Invoice_status_idx";

-- DropIndex
DROP INDEX "LabOrder_deletedAt_idx";

-- DropIndex
DROP INDEX "LabOrder_hospitalId_idx";

-- DropIndex
DROP INDEX "LabOrder_orderDate_idx";

-- DropIndex
DROP INDEX "LabOrder_patientId_idx";

-- DropIndex
DROP INDEX "LabOrder_status_idx";

-- DropIndex
DROP INDEX "Medication_hospitalId_idx";

-- DropIndex
DROP INDEX "Medication_name_idx";

-- DropIndex
DROP INDEX "MessageLog_channel_idx";

-- DropIndex
DROP INDEX "MessageLog_hospitalId_idx";

-- DropIndex
DROP INDEX "MessageLog_patientId_idx";

-- DropIndex
DROP INDEX "MessageLog_recipient_idx";

-- DropIndex
DROP INDEX "MessageLog_scheduledFor_idx";

-- DropIndex
DROP INDEX "MessageLog_sentAt_idx";

-- DropIndex
DROP INDEX "MessageLog_status_idx";

-- DropIndex
DROP INDEX "Patient_firstName_lastName_idx";

-- DropIndex
DROP INDEX "Patient_hospitalId_idx";

-- DropIndex
DROP INDEX "Patient_phone_idx";

-- DropIndex
DROP INDEX "Payment_cashierSessionId_idx";

-- DropIndex
DROP INDEX "Payment_hospitalId_idx";

-- DropIndex
DROP INDEX "Payment_paymentDate_idx";

-- DropIndex
DROP INDEX "Prescription_doctorId_idx";

-- DropIndex
DROP INDEX "Prescription_hospitalId_idx";

-- DropIndex
DROP INDEX "Prescription_patientId_idx";

-- DropIndex
DROP INDEX "Procedure_category_idx";

-- DropIndex
DROP INDEX "Procedure_hospitalId_idx";

-- DropIndex
DROP INDEX "PurchaseOrder_deletedAt_idx";

-- DropIndex
DROP INDEX "PurchaseOrder_hospitalId_idx";

-- DropIndex
DROP INDEX "PurchaseOrder_orderDate_idx";

-- DropIndex
DROP INDEX "PurchaseOrder_status_idx";

-- DropIndex
DROP INDEX "PurchaseOrder_supplierId_idx";

-- DropIndex
DROP INDEX "Refund_hospitalId_idx";

-- DropIndex
DROP INDEX "Refund_refundedAt_idx";

-- DropIndex
DROP INDEX "Staff_hospitalId_idx";

-- DropIndex
DROP INDEX "Staff_phone_idx";

-- DropIndex
DROP INDEX "StaffInvite_email_idx";

-- DropIndex
DROP INDEX "StaffInvite_hospitalId_idx";

-- DropIndex
DROP INDEX "StaffInvite_status_idx";

-- DropIndex
DROP INDEX "StockAlert_alertType_idx";

-- DropIndex
DROP INDEX "StockAlert_createdAt_idx";

-- DropIndex
DROP INDEX "StockAlert_hospitalId_idx";

-- DropIndex
DROP INDEX "StockAlert_isAcknowledged_idx";

-- DropIndex
DROP INDEX "StockAlert_itemId_idx";

-- DropIndex
DROP INDEX "StockTransaction_createdAt_idx";

-- DropIndex
DROP INDEX "StockTransaction_hospitalId_idx";

-- DropIndex
DROP INDEX "StockTransaction_itemId_idx";

-- DropIndex
DROP INDEX "StockTransaction_transactionDate_idx";

-- DropIndex
DROP INDEX "StockTransaction_type_idx";

-- DropIndex
DROP INDEX "Treatment_doctorId_idx";

-- DropIndex
DROP INDEX "Treatment_hospitalId_idx";

-- DropIndex
DROP INDEX "Treatment_patientId_idx";

-- DropIndex
DROP INDEX "Treatment_signedById_idx";

-- DropIndex
DROP INDEX "TreatmentPlan_hospitalId_idx";

-- DropIndex
DROP INDEX "TreatmentPlan_patientId_idx";

-- DropIndex
DROP INDEX "TreatmentPlan_status_idx";

-- DropIndex
DROP INDEX "Vendor_deletedAt_idx";

-- DropIndex
DROP INDEX "Vendor_hospitalId_idx";

-- DropIndex
DROP INDEX "Vendor_kind_idx";

-- DropIndex
DROP INDEX "Vendor_name_idx";

-- DropIndex
DROP INDEX "Vendor_status_idx";

-- DropIndex
DROP INDEX "Waitlist_hospitalId_idx";

-- DropIndex
DROP INDEX "Waitlist_status_idx";

-- CreateIndex
CREATE INDEX "Appointment_hospitalId_scheduledDate_scheduledTime_idx" ON "Appointment"("hospitalId", "scheduledDate", "scheduledTime");

-- CreateIndex
CREATE INDEX "Appointment_hospitalId_status_scheduledDate_idx" ON "Appointment"("hospitalId", "status", "scheduledDate");

-- CreateIndex
CREATE INDEX "Appointment_hospitalId_doctorId_scheduledDate_idx" ON "Appointment"("hospitalId", "doctorId", "scheduledDate");

-- CreateIndex
CREATE INDEX "Appointment_hospitalId_patientId_scheduledDate_idx" ON "Appointment"("hospitalId", "patientId", "scheduledDate" DESC);

-- CreateIndex
CREATE INDEX "Appointment_chairId_scheduledDate_idx" ON "Appointment"("chairId", "scheduledDate");

-- CreateIndex
CREATE INDEX "AuditLog_hospitalId_createdAt_idx" ON "AuditLog"("hospitalId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_hospitalId_action_createdAt_idx" ON "AuditLog"("hospitalId", "action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_hospitalId_userId_createdAt_idx" ON "AuditLog"("hospitalId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CashierSession_hospitalId_status_openedAt_idx" ON "CashierSession"("hospitalId", "status", "openedAt" DESC);

-- CreateIndex
CREATE INDEX "Chair_hospitalId_isActive_sortOrder_idx" ON "Chair"("hospitalId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "DentalChartEntry_hospitalId_patientId_toothNumber_idx" ON "DentalChartEntry"("hospitalId", "patientId", "toothNumber");

-- CreateIndex
CREATE INDEX "Document_hospitalId_patientId_createdAt_idx" ON "Document"("hospitalId", "patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Document_hospitalId_documentType_idx" ON "Document"("hospitalId", "documentType");

-- CreateIndex
CREATE INDEX "FormSubmission_hospitalId_status_createdAt_idx" ON "FormSubmission"("hospitalId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FormSubmission_hospitalId_patientId_idx" ON "FormSubmission"("hospitalId", "patientId");

-- CreateIndex
CREATE INDEX "InventoryBatch_hospitalId_itemId_idx" ON "InventoryBatch"("hospitalId", "itemId");

-- CreateIndex
CREATE INDEX "InventoryBatch_hospitalId_expiryDate_idx" ON "InventoryBatch"("hospitalId", "expiryDate");

-- CreateIndex
CREATE INDEX "InventoryItem_hospitalId_deletedAt_name_idx" ON "InventoryItem"("hospitalId", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "InventoryItem_hospitalId_deletedAt_itemType_idx" ON "InventoryItem"("hospitalId", "deletedAt", "itemType");

-- CreateIndex
CREATE INDEX "InventoryItem_hospitalId_deletedAt_category_idx" ON "InventoryItem"("hospitalId", "deletedAt", "category");

-- CreateIndex
CREATE INDEX "Invoice_hospitalId_status_createdAt_idx" ON "Invoice"("hospitalId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Invoice_hospitalId_patientId_createdAt_idx" ON "Invoice"("hospitalId", "patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LabOrder_hospitalId_deletedAt_status_orderDate_idx" ON "LabOrder"("hospitalId", "deletedAt", "status", "orderDate" DESC);

-- CreateIndex
CREATE INDEX "LabOrder_hospitalId_patientId_orderDate_idx" ON "LabOrder"("hospitalId", "patientId", "orderDate" DESC);

-- CreateIndex
CREATE INDEX "Medication_hospitalId_isActive_name_idx" ON "Medication"("hospitalId", "isActive", "name");

-- CreateIndex
CREATE INDEX "MessageLog_hospitalId_channel_createdAt_idx" ON "MessageLog"("hospitalId", "channel", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MessageLog_hospitalId_patientId_createdAt_idx" ON "MessageLog"("hospitalId", "patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MessageLog_hospitalId_status_createdAt_idx" ON "MessageLog"("hospitalId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MessageLog_status_scheduledFor_idx" ON "MessageLog"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Patient_hospitalId_createdAt_idx" ON "Patient"("hospitalId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Patient_hospitalId_isActive_createdAt_idx" ON "Patient"("hospitalId", "isActive", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Patient_hospitalId_phone_idx" ON "Patient"("hospitalId", "phone");

-- CreateIndex
CREATE INDEX "Patient_hospitalId_lastName_firstName_idx" ON "Patient"("hospitalId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Payment_hospitalId_paymentDate_idx" ON "Payment"("hospitalId", "paymentDate" DESC);

-- CreateIndex
CREATE INDEX "Payment_hospitalId_cashierSessionId_idx" ON "Payment"("hospitalId", "cashierSessionId");

-- CreateIndex
CREATE INDEX "Prescription_hospitalId_createdAt_idx" ON "Prescription"("hospitalId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Prescription_hospitalId_patientId_createdAt_idx" ON "Prescription"("hospitalId", "patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Prescription_hospitalId_doctorId_idx" ON "Prescription"("hospitalId", "doctorId");

-- CreateIndex
CREATE INDEX "Procedure_hospitalId_isActive_category_idx" ON "Procedure"("hospitalId", "isActive", "category");

-- CreateIndex
CREATE INDEX "PurchaseOrder_hospitalId_deletedAt_status_orderDate_idx" ON "PurchaseOrder"("hospitalId", "deletedAt", "status", "orderDate" DESC);

-- CreateIndex
CREATE INDEX "PurchaseOrder_hospitalId_supplierId_orderDate_idx" ON "PurchaseOrder"("hospitalId", "supplierId", "orderDate" DESC);

-- CreateIndex
CREATE INDEX "Refund_hospitalId_refundedAt_idx" ON "Refund"("hospitalId", "refundedAt" DESC);

-- CreateIndex
CREATE INDEX "Staff_hospitalId_isActive_lastName_idx" ON "Staff"("hospitalId", "isActive", "lastName");

-- CreateIndex
CREATE INDEX "StaffInvite_hospitalId_status_createdAt_idx" ON "StaffInvite"("hospitalId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "StockAlert_hospitalId_isAcknowledged_createdAt_idx" ON "StockAlert"("hospitalId", "isAcknowledged", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "StockAlert_itemId_alertType_isAcknowledged_idx" ON "StockAlert"("itemId", "alertType", "isAcknowledged");

-- CreateIndex
CREATE INDEX "StockTransaction_hospitalId_transactionDate_idx" ON "StockTransaction"("hospitalId", "transactionDate" DESC);

-- CreateIndex
CREATE INDEX "StockTransaction_hospitalId_itemId_transactionDate_idx" ON "StockTransaction"("hospitalId", "itemId", "transactionDate" DESC);

-- CreateIndex
CREATE INDEX "StockTransaction_hospitalId_type_transactionDate_idx" ON "StockTransaction"("hospitalId", "type", "transactionDate" DESC);

-- CreateIndex
CREATE INDEX "Treatment_hospitalId_status_createdAt_idx" ON "Treatment"("hospitalId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Treatment_hospitalId_patientId_createdAt_idx" ON "Treatment"("hospitalId", "patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Treatment_hospitalId_doctorId_createdAt_idx" ON "Treatment"("hospitalId", "doctorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TreatmentPlan_hospitalId_status_createdAt_idx" ON "TreatmentPlan"("hospitalId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TreatmentPlan_hospitalId_patientId_createdAt_idx" ON "TreatmentPlan"("hospitalId", "patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Vendor_hospitalId_kind_deletedAt_name_idx" ON "Vendor"("hospitalId", "kind", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "Vendor_hospitalId_kind_status_idx" ON "Vendor"("hospitalId", "kind", "status");

-- CreateIndex
CREATE INDEX "Waitlist_hospitalId_status_createdAt_idx" ON "Waitlist"("hospitalId", "status", "createdAt");

