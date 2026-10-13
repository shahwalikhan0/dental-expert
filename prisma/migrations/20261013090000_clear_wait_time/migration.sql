-- "Wait time" used to be stored at check-in as the check-in time minus the
-- booked start: how late the patient was, not how long they waited. It is now
-- written when the patient is called in, as the time since check-in. The old
-- values cannot be turned into real waits, and averaging them alongside the
-- new ones would make every report wrong, so they are cleared.
UPDATE "Appointment" SET "waitTime" = NULL WHERE "waitTime" IS NOT NULL;
