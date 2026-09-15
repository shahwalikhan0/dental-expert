-- Age is computed, not stored.
--
-- `Patient.age` was written once at registration and never again, so it was
-- wrong for most of the year after it was recorded and a patient registered at
-- 34 stayed 34 for life. The analytics report already ignored it and computed
-- age from `dateOfBirth` — which is the tell: two places in the application
-- disagreed about how old a patient was, and the report was the one that
-- was right.
--
-- Backfill first. Some patients were registered with an age and no date of
-- birth, and dropping the column would lose the only thing known about their
-- age. A birth year is not a birth date, so this records the first of July —
-- mid-year, which is the least wrong single day to pick — and only where there
-- is nothing better.
UPDATE "Patient"
SET "dateOfBirth" = make_date(EXTRACT(YEAR FROM now())::int - "age", 7, 1)
WHERE "dateOfBirth" IS NULL
  AND "age" IS NOT NULL
  AND "age" BETWEEN 0 AND 120;

ALTER TABLE "Patient" DROP COLUMN "age";
