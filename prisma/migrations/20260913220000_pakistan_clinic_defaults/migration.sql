-- Pakistan defaults on the clinic record.
--
-- `locale` was moved to en-PK in the PKR pass, but `country`, `currency` and
-- `timezone` were left on IN / INR / Asia/Kolkata. The result was incoherent: a
-- clinic created without explicit settings claimed Pakistani formatting while
-- billing in Indian rupees on Indian time.

-- AlterTable
ALTER TABLE "Hospital" ALTER COLUMN "country" SET DEFAULT 'PK',
ALTER COLUMN "currency" SET DEFAULT 'PKR',
ALTER COLUMN "timezone" SET DEFAULT 'Asia/Karachi';

-- AlterTable
ALTER TABLE "SubscriptionPayment" ALTER COLUMN "currency" SET DEFAULT 'PKR';

-- Changing a default does not touch rows that already exist, and the clinic on
-- this installation is holding all three old values. They were never chosen by
-- anybody — they are what the old defaults put there — so the rows that still
-- match the old defaults *exactly* are moved across.
--
-- Deliberately narrow: a clinic that had explicitly set any one of these to
-- something else does not match all three, and is left alone. Nothing here
-- guesses at a value a person actually picked.
UPDATE "Hospital"
SET "country"  = 'PK',
    "currency" = 'PKR',
    "timezone" = 'Asia/Karachi'
WHERE "country"  = 'IN'
  AND "currency" = 'INR'
  AND "timezone" = 'Asia/Kolkata';
