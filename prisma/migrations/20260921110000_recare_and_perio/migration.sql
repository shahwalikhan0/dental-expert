-- Recare, and the periodontal chart.
--
-- RECARE is the mechanism a dental practice actually lives on: every patient
-- carries a date for when they should next be seen, and the clinic works the
-- list of who has passed it. The application had appointment reminders — which
-- tell somebody about a booking that already exists — and nothing that finds
-- the people with no booking at all. The specification's own target benefits
-- ask to "reduce missed follow-ups"; nothing here could find one.
--
-- THE PERIODONTAL CHART covers §3's "periodontal findings where required".
-- What existed was PERIODONTIC as a procedure category — a billing code, not a
-- clinical record. Six sites per tooth is the standard full-mouth chart.

-- ---------------------------------------------------------------------------
-- Recare
-- ---------------------------------------------------------------------------

CREATE TYPE "RecareStatus" AS ENUM ('ACTIVE', 'OPTED_OUT', 'INACTIVE');

CREATE TABLE "RecareType" (
  "id"             TEXT NOT NULL,
  "hospitalId"     TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "intervalMonths" INTEGER NOT NULL DEFAULT 6,
  "description"    TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "isDefault"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RecareType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecareType_hospitalId_name_key" ON "RecareType"("hospitalId", "name");
CREATE INDEX "RecareType_hospitalId_isActive_sortOrder_idx"
  ON "RecareType"("hospitalId", "isActive", "sortOrder");

ALTER TABLE "RecareType" ADD CONSTRAINT "RecareType_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Recare" (
  "id"           TEXT NOT NULL,
  "hospitalId"   TEXT NOT NULL,
  "patientId"    TEXT NOT NULL,
  "recareTypeId" TEXT NOT NULL,
  "dueDate"      DATE NOT NULL,
  "lastDoneAt"   TIMESTAMP(3),
  "snoozedUntil" DATE,
  "snoozeReason" TEXT,
  "status"       "RecareStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Recare_pkey" PRIMARY KEY ("id")
);

-- One standing recare of each kind per patient. Two "six-month check-ups" for
-- the same person is a duplicate, not a second appointment.
CREATE UNIQUE INDEX "Recare_patientId_recareTypeId_key" ON "Recare"("patientId", "recareTypeId");
-- The due list is the whole module: status and date together, in that order.
CREATE INDEX "Recare_hospitalId_status_dueDate_idx" ON "Recare"("hospitalId", "status", "dueDate");
CREATE INDEX "Recare_hospitalId_patientId_idx" ON "Recare"("hospitalId", "patientId");

ALTER TABLE "Recare" ADD CONSTRAINT "Recare_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Recare" ADD CONSTRAINT "Recare_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Recare" ADD CONSTRAINT "Recare_recareTypeId_fkey"
  FOREIGN KEY ("recareTypeId") REFERENCES "RecareType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing clinic gets the standard three. Intervals are a starting
-- point, not a clinical instruction — they are configuration precisely so the
-- practice can set its own.
INSERT INTO "RecareType" ("id", "hospitalId", "name", "intervalMonths", "description", "sortOrder", "isDefault", "updatedAt")
SELECT
  md5(h."id" || t.name)::text,
  h."id",
  t.name,
  t.months,
  t.description,
  t.sort_order,
  t.is_default,
  CURRENT_TIMESTAMP
FROM "Hospital" h
CROSS JOIN (VALUES
  ('Scale and polish', 6, 'Routine hygiene visit', 0, true),
  ('Child check-up', 6, 'Routine examination for a child', 1, false),
  ('Periodontal maintenance', 3, 'For patients under periodontal care', 2, false)
) AS t(name, months, description, sort_order, is_default);

-- ---------------------------------------------------------------------------
-- Periodontal charting
-- ---------------------------------------------------------------------------

CREATE TYPE "PerioSite" AS ENUM ('MB', 'B', 'DB', 'ML', 'L', 'DL');

CREATE TABLE "PerioExam" (
  "id"           TEXT NOT NULL,
  "hospitalId"   TEXT NOT NULL,
  "patientId"    TEXT NOT NULL,
  "examDate"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedById" TEXT,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PerioExam_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PerioExam_hospitalId_patientId_examDate_idx"
  ON "PerioExam"("hospitalId", "patientId", "examDate" DESC);

ALTER TABLE "PerioExam" ADD CONSTRAINT "PerioExam_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerioExam" ADD CONSTRAINT "PerioExam_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerioExam" ADD CONSTRAINT "PerioExam_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PerioMeasurement" (
  "id"          TEXT NOT NULL,
  "examId"      TEXT NOT NULL,
  "toothNumber" INTEGER NOT NULL,
  "site"        "PerioSite" NOT NULL,
  -- Null means "not probed", which is not zero. An unprobed site must never
  -- read as a healthy one.
  "pocketDepth" INTEGER,
  "recession"   INTEGER,
  "bleeding"    BOOLEAN NOT NULL DEFAULT false,
  "suppuration" BOOLEAN NOT NULL DEFAULT false,
  "plaque"      BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "PerioMeasurement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerioMeasurement_examId_toothNumber_site_key"
  ON "PerioMeasurement"("examId", "toothNumber", "site");
CREATE INDEX "PerioMeasurement_examId_toothNumber_idx"
  ON "PerioMeasurement"("examId", "toothNumber");

ALTER TABLE "PerioMeasurement" ADD CONSTRAINT "PerioMeasurement_examId_fkey"
  FOREIGN KEY ("examId") REFERENCES "PerioExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PerioToothFinding" (
  "id"          TEXT NOT NULL,
  "examId"      TEXT NOT NULL,
  "toothNumber" INTEGER NOT NULL,
  "mobility"    INTEGER,
  "furcation"   INTEGER,
  "isMissing"   BOOLEAN NOT NULL DEFAULT false,
  "isImplant"   BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "PerioToothFinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerioToothFinding_examId_toothNumber_key"
  ON "PerioToothFinding"("examId", "toothNumber");

ALTER TABLE "PerioToothFinding" ADD CONSTRAINT "PerioToothFinding_examId_fkey"
  FOREIGN KEY ("examId") REFERENCES "PerioExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
