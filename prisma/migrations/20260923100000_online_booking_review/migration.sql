-- Telling an online booking apart from one the desk made.
--
-- The public booking route created appointments with status SCHEDULED and a
-- comment explaining that this was "what lets the desk work through what came
-- in overnight". It was not: the desk's own bookings are SCHEDULED too, so the
-- two were indistinguishable, and nothing anywhere surfaced online bookings.
-- Meanwhile the patient's confirmation page says "the clinic will telephone you
-- to confirm" — a promise the software gave nobody the means to keep.

-- Where the booking came from.
--
-- Defaults to false, which is correct for every row that already exists: the
-- desk made them. Backfilling from the audit trail was considered and rejected
-- — `booking.public.created` is only written since the public page shipped, so
-- it would mark some historical rows and not others, and a half-filled review
-- queue is worse than an empty one.
ALTER TABLE "Appointment" ADD COLUMN "bookedOnline" BOOLEAN NOT NULL DEFAULT false;

-- When somebody at the desk first dealt with it.
--
-- Null means "not yet looked at". Existing rows are backfilled to their
-- creation time rather than left null, so that turning this on does not present
-- the clinic with a review queue containing its entire history.
ALTER TABLE "Appointment" ADD COLUMN "reviewedAt" TIMESTAMP(3);

UPDATE "Appointment" SET "reviewedAt" = "createdAt";

-- The query the review queue runs.
CREATE INDEX "Appointment_hospitalId_bookedOnline_reviewedAt_idx"
  ON "Appointment"("hospitalId", "bookedOnline", "reviewedAt");
