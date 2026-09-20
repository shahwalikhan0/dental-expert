-- Security settings, enforced.
--
-- Settings → Security wrote twelve rows that nothing read. This migration does
-- the two things that cannot be done in application code: it gives every
-- account a date its password was last set, so the expiry has something to
-- measure, and it removes the two-factor rows, because the switch that wrote
-- them is gone.

-- When the password was last set.
--
-- Nullable, then backfilled to now(). Backfilling to "now" rather than to the
-- account's `createdAt` is deliberate: the true date was never recorded, and
-- dating every existing password from the day its account was made would, on a
-- clinic that turns the expiry on, expire the entire staff at once for time
-- that passed while the policy did nothing. The clock starts here.
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

UPDATE "User" SET "passwordChangedAt" = NOW() WHERE "password" IS NOT NULL;

-- An invitation that has not been accepted holds no password, so it has no
-- date either. It gets one when it is claimed.

-- Two-factor authentication is not implemented and no longer offered.
--
-- The switch stored `requireTwoFactor` and nothing consulted it, so a clinic
-- that had turned it on believed it had a second factor and had a password.
-- Deleting the rows removes the claim along with the control; leaving them
-- would leave a `true` in the settings table for a feature that does not
-- exist, which is exactly the thing being corrected.
DELETE FROM "Setting" WHERE "key" = 'requireTwoFactor' AND "category" = 'security';
