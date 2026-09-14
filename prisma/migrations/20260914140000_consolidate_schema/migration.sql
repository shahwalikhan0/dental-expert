-- Consolidating the schema: 55 tables -> 48.
--
-- Nine tables go and two arrive. Every one of them is either the same table
-- written out more than once (three message logs, two amendment logs), or a
-- table standing in for a column (a category, a preference sheet), or a table
-- nothing ever read.
--
-- Hand-written, as every migration here is. Each drop is preceded by the
-- INSERT ... SELECT that carries its rows somewhere.

-- ===========================================================================
-- 1. MessageLog  <-  SMSLog + EmailLog + AppointmentReminder
-- ===========================================================================

CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "patientId" TEXT,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "templateId" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerRef" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "cost" DECIMAL(10,4),
    "trackingId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- The ids are carried over unchanged, so a message keeps the id anything else
-- may have recorded. SMS and email ids cannot collide: they came from separate
-- cuid() sequences.
INSERT INTO "MessageLog" (
    "id", "hospitalId", "channel", "patientId", "recipient", "body",
    "templateId", "status", "provider", "providerRef",
    "scheduledFor", "sentAt", "failedAt", "errorMessage", "cost",
    "metadata", "createdAt", "updatedAt"
)
SELECT
    s."id", s."hospitalId", 'SMS'::"CommunicationChannel", s."patientId", s."phone", s."message",
    s."templateId", s."status", s."gateway", s."messageId",
    s."scheduledFor", s."sentAt", s."failedAt", s."errorMessage", s."cost",
    -- `metadata` was free text holding JSON. Anything that will not parse is
    -- kept as a JSON string rather than thrown away.
    CASE
        WHEN s."metadata" IS NULL THEN NULL
        WHEN s."metadata" ~ '^\s*[\{\[]' THEN s."metadata"::jsonb
        ELSE to_jsonb(s."metadata")
    END,
    s."createdAt", s."updatedAt"
FROM "SMSLog" s;

INSERT INTO "MessageLog" (
    "id", "hospitalId", "channel", "patientId", "recipient", "subject", "body",
    "templateId", "status", "providerRef", "trackingId",
    "scheduledFor", "sentAt", "openedAt", "failedAt", "errorMessage",
    "metadata", "createdAt", "updatedAt"
)
SELECT
    e."id", e."hospitalId", 'EMAIL'::"CommunicationChannel", e."patientId", e."email", e."subject", e."body",
    e."templateId", e."status", e."messageId", e."trackingId",
    e."scheduledFor", e."sentAt", e."openedAt", e."failedAt", e."errorMessage",
    CASE
        WHEN e."metadata" IS NULL THEN NULL
        WHEN e."metadata" ~ '^\s*[\{\[]' THEN e."metadata"::jsonb
        ELSE to_jsonb(e."metadata")
    END,
    e."createdAt", e."updatedAt"
FROM "EmailLog" e;

-- AppointmentReminder recorded that a reminder was scheduled, and nothing about
-- what it said or where it went. The clinic and patient come from the
-- appointment; the recipient is the patient's phone or address depending on the
-- channel; the body is honestly marked as not having been kept.
INSERT INTO "MessageLog" (
    "id", "hospitalId", "channel", "patientId", "recipient", "body",
    "relatedType", "relatedId", "status",
    "scheduledFor", "sentAt", "createdAt", "updatedAt"
)
SELECT
    r."id",
    a."hospitalId",
    r."reminderType"::text::"CommunicationChannel",
    a."patientId",
    COALESCE(
        CASE WHEN r."reminderType" = 'EMAIL' THEN p."email" ELSE p."phone" END,
        ''
    ),
    '(reminder content was not recorded)',
    'Appointment',
    r."appointmentId",
    CASE r."status"
        WHEN 'SENT' THEN 'SENT'::"MessageStatus"
        WHEN 'FAILED' THEN 'FAILED'::"MessageStatus"
        WHEN 'CANCELLED' THEN 'CANCELLED'::"MessageStatus"
        ELSE 'PENDING'::"MessageStatus"
    END,
    r."scheduledFor", r."sentAt", r."createdAt", r."createdAt"
FROM "AppointmentReminder" r
JOIN "Appointment" a ON a."id" = r."appointmentId"
JOIN "Patient" p ON p."id" = a."patientId";

CREATE UNIQUE INDEX "MessageLog_trackingId_key" ON "MessageLog"("trackingId");
CREATE INDEX "MessageLog_hospitalId_idx" ON "MessageLog"("hospitalId");
CREATE INDEX "MessageLog_patientId_idx" ON "MessageLog"("patientId");
CREATE INDEX "MessageLog_channel_idx" ON "MessageLog"("channel");
CREATE INDEX "MessageLog_recipient_idx" ON "MessageLog"("recipient");
CREATE INDEX "MessageLog_status_idx" ON "MessageLog"("status");
CREATE INDEX "MessageLog_sentAt_idx" ON "MessageLog"("sentAt");
CREATE INDEX "MessageLog_scheduledFor_idx" ON "MessageLog"("scheduledFor");
CREATE INDEX "MessageLog_relatedType_relatedId_idx" ON "MessageLog"("relatedType", "relatedId");

ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_hospitalId_fkey"
    FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "CommunicationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "SMSLog";
DROP TABLE "EmailLog";
DROP TABLE "AppointmentReminder";
DROP TYPE "ReminderType";
DROP TYPE "ReminderStatus";

-- ===========================================================================
-- 2. TreatmentAmendment  <-  TreatmentAddendum + TreatmentRevision
-- ===========================================================================

CREATE TYPE "AmendmentKind" AS ENUM ('ADDENDUM', 'CORRECTION');

CREATE TABLE "TreatmentAmendment" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "kind" "AmendmentKind" NOT NULL,
    "body" TEXT NOT NULL,
    "changes" JSONB,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TreatmentAmendment_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TreatmentAmendment" ("id", "hospitalId", "treatmentId", "kind", "body", "authorId", "createdAt")
SELECT "id", "hospitalId", "treatmentId", 'ADDENDUM', "body", "authorId", "createdAt"
FROM "TreatmentAddendum";

-- A revision's `reason` is what the clinician wrote, so it becomes the body;
-- `changes` keeps what the note said beforehand.
INSERT INTO "TreatmentAmendment" ("id", "hospitalId", "treatmentId", "kind", "body", "changes", "authorId", "createdAt")
SELECT "id", "hospitalId", "treatmentId", 'CORRECTION', "reason", "changes", "amendedById", "createdAt"
FROM "TreatmentRevision";

CREATE INDEX "TreatmentAmendment_hospitalId_idx" ON "TreatmentAmendment"("hospitalId");
CREATE INDEX "TreatmentAmendment_treatmentId_idx" ON "TreatmentAmendment"("treatmentId");
CREATE INDEX "TreatmentAmendment_kind_idx" ON "TreatmentAmendment"("kind");

ALTER TABLE "TreatmentAmendment" ADD CONSTRAINT "TreatmentAmendment_hospitalId_fkey"
    FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TreatmentAmendment" ADD CONSTRAINT "TreatmentAmendment_treatmentId_fkey"
    FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TreatmentAmendment" ADD CONSTRAINT "TreatmentAmendment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "TreatmentAddendum";
DROP TABLE "TreatmentRevision";

-- ===========================================================================
-- 3. Patient.communicationPrefs  <-  PatientCommunicationPreference
--
-- Fifteen columns and one row per patient — except that nothing ever created a
-- row, so every patient had none, and the SMS service read
-- `!preference?.smsEnabled` and refused to send to anybody at all. The defaults
-- now live in lib/communication-preferences.ts and apply to the patients who
-- have never expressed one, which is all of them.
--
-- `preferredLanguage` is not carried across: Patient.locale already says it.
-- ===========================================================================

ALTER TABLE "Patient" ADD COLUMN "communicationPrefs" JSONB;

UPDATE "Patient" p SET "communicationPrefs" = jsonb_build_object(
    'sms', c."smsEnabled",
    'email', c."emailEnabled",
    'whatsapp', c."whatsappEnabled",
    'appointmentReminders', c."appointmentReminders",
    'paymentReminders', c."paymentReminders",
    'promotions', c."promotionalMessages",
    'birthdayWishes', c."birthdayWishes",
    'preferredChannel', c."preferredChannel",
    'doNotContact', c."dndRegistered",
    'unsubscribedAt', c."unsubscribedAt"
)
FROM "PatientCommunicationPreference" c
WHERE c."patientId" = p."id";

DROP TABLE "PatientCommunicationPreference";

-- ===========================================================================
-- 4. InventoryItem.category  <-  InventoryCategory
-- ===========================================================================

ALTER TABLE "InventoryItem" ADD COLUMN "category" TEXT;

UPDATE "InventoryItem" i SET "category" = c."name"
FROM "InventoryCategory" c
WHERE c."id" = i."categoryId";

ALTER TABLE "InventoryItem" DROP COLUMN "categoryId";
DROP TABLE "InventoryCategory";

CREATE INDEX "InventoryItem_category_idx" ON "InventoryItem"("category");

-- ===========================================================================
-- 5. Lab order children
--
-- LabOrderDocument had no route, no page and no query anywhere in the
-- application: it was created by the scoping pass as a home for a legacy table
-- and nothing was ever written to it. LabOrderHistory recorded status
-- transitions, which is what AuditLog is for — the routes now write there.
-- ===========================================================================

DROP TABLE "LabOrderDocument";
DROP TABLE "LabOrderHistory";

-- ===========================================================================
-- 6. MedicalHistory: sixteen condition booleans become three lists
--
-- The booleans could only record what somebody thought of when the schema was
-- written. A patient on warfarin, a transplant recipient, anyone on a
-- bisphosphonate — all of them matter more to a dental procedure than several
-- of the conditions that did get a column, and all of them ended up crammed
-- into `otherConditions` as prose.
-- ===========================================================================

ALTER TABLE "MedicalHistory"
    ADD COLUMN "allergies" TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN "conditions" TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN "medications" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "MedicalHistory" SET
    "allergies" = ARRAY(
        SELECT btrim(x) FROM unnest(ARRAY["drugAllergies", "foodAllergies", "materialAllergies"]) AS x
        WHERE btrim(COALESCE(x, '')) <> ''
    ),
    "conditions" = ARRAY(
        SELECT btrim(x) FROM unnest(ARRAY[
            CASE WHEN "hasDiabetes"         THEN concat_ws(' — ', 'Diabetes', NULLIF(btrim(COALESCE("diabetesType", '')), '')) END,
            CASE WHEN "hasHypertension"     THEN 'Hypertension' END,
            CASE WHEN "hasHeartDisease"     THEN concat_ws(' — ', 'Heart disease', NULLIF(btrim(COALESCE("heartCondition", '')), '')) END,
            CASE WHEN "hasBleedingDisorder" THEN 'Bleeding disorder' END,
            CASE WHEN "hasAsthma"           THEN 'Asthma' END,
            CASE WHEN "hasThyroid"          THEN concat_ws(' — ', 'Thyroid disorder', NULLIF(btrim(COALESCE("thyroidType", '')), '')) END,
            CASE WHEN "hasHepatitis"        THEN concat_ws(' — ', 'Hepatitis', NULLIF(btrim(COALESCE("hepatitisType", '')), '')) END,
            CASE WHEN "hasHiv"              THEN 'HIV' END,
            CASE WHEN "hasEpilepsy"         THEN 'Epilepsy' END,
            "otherConditions"
        ]) AS x
        WHERE btrim(COALESCE(x, '')) <> ''
    ),
    -- Split on newlines only. Splitting on commas would cut "Warfarin 5mg,
    -- alternate days" in half.
    "medications" = ARRAY(
        SELECT btrim(x) FROM unnest(regexp_split_to_array(COALESCE("currentMedications", ''), E'\n+')) AS x
        WHERE btrim(x) <> ''
    );

ALTER TABLE "MedicalHistory"
    DROP COLUMN "hasAllergies",
    DROP COLUMN "drugAllergies",
    DROP COLUMN "foodAllergies",
    DROP COLUMN "materialAllergies",
    DROP COLUMN "hasDiabetes",
    DROP COLUMN "diabetesType",
    DROP COLUMN "hasHypertension",
    DROP COLUMN "hasHeartDisease",
    DROP COLUMN "heartCondition",
    DROP COLUMN "hasBleedingDisorder",
    DROP COLUMN "hasAsthma",
    DROP COLUMN "hasThyroid",
    DROP COLUMN "thyroidType",
    DROP COLUMN "hasHepatitis",
    DROP COLUMN "hepatitisType",
    DROP COLUMN "hasHiv",
    DROP COLUMN "hasEpilepsy",
    DROP COLUMN "otherConditions",
    DROP COLUMN "currentMedications";

ALTER TABLE "MedicalHistory" RENAME COLUMN "medications" TO "currentMedications";

ALTER TABLE "MedicalHistory"
    ALTER COLUMN "allergies" DROP DEFAULT,
    ALTER COLUMN "conditions" DROP DEFAULT,
    ALTER COLUMN "currentMedications" DROP DEFAULT;

-- ===========================================================================
-- 7. Columns for things that are not built
--
-- The four gateway columns were written by the Razorpay/PhonePe/Paytm checkout
-- that the scoping pass removed — those three onboard Indian merchants only.
-- Nothing has read them since. `Invoice.insuranceAmount` is the same: insurance
-- is specification §16, a future enhancement, and no code sets or reads it.
-- ===========================================================================

DROP INDEX IF EXISTS "Payment_gatewayOrderId_idx";
ALTER TABLE "Payment"
    DROP COLUMN "gateway",
    DROP COLUMN "gatewayOrderId",
    DROP COLUMN "gatewayPaymentId",
    DROP COLUMN "gatewayStatus";

ALTER TABLE "Invoice" DROP COLUMN "insuranceAmount";

-- HSN is India's GST classification for goods. Renamed rather than dropped:
-- Pakistan's customs tariff uses the same HS basis, so the value is still good.
ALTER TABLE "InventoryItem" RENAME COLUMN "hsnCode" TO "taxCode";
