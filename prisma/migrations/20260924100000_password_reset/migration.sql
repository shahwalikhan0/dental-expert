-- Self-service password reset.
--
-- `/forgot-password` was listed as a public route in `middleware.ts` and in
-- `lib/auth.config.ts`, and no such page or endpoint existed. A dentist who
-- forgot their password had no route back in except an administrator changing
-- it for them — which is a support call for the commonest thing that happens to
-- a password, and on a hosted product it is our support call.
--
-- Modelled on the invitation columns already on this table: no second table,
-- and a token that is cleared on use, so a lookup by token can never reach a
-- reset that has already been spent.
ALTER TABLE "User" ADD COLUMN "resetToken" TEXT;
ALTER TABLE "User" ADD COLUMN "resetExpiresAt" TIMESTAMP(3);

-- Unique so two accounts cannot hold one link, and so the lookup the reset page
-- performs is an index hit rather than a scan of every user on the platform.
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");
