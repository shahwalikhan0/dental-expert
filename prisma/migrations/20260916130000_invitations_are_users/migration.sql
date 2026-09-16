-- An invitation is a user who has not set a password.
--
-- `StaffInvite` held an email, a name, a role and a clinic — the same identity
-- `User` holds — and accepting one copied all four across into a new `User`
-- row. Two tables, the same person, and a uniqueness rule that only one of them
-- enforced: nothing stopped an address being invited while it already held an
-- account, because the check for that lived in application code on one path and
-- was missing on the other.
--
-- The invitation now *is* the user row, with no password. It cannot sign in
-- (see lib/login.ts), holds no Staff record, and is inactive until accepted.

ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "inviteToken" TEXT;
ALTER TABLE "User" ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "invitedById" TEXT;

-- Outstanding invitations become rows. Accepted ones already have their user;
-- cancelled and expired ones are not worth carrying over, and the audit trail
-- records that they happened.
--
-- `DISTINCT ON` guards against two pending invitations to the same address at
-- one clinic, which the old table permitted and the unique index below does
-- not: the most recent one wins, which is the one whose emailed link works.
INSERT INTO "User" (
  "id", "hospitalId", "email", "password", "name", "phone", "role",
  "isActive", "isHospitalAdmin", "isPlatformAdmin",
  "inviteToken", "inviteExpiresAt", "invitedById", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (i."hospitalId", lower(i."email"))
  i."id",
  i."hospitalId",
  i."email",
  NULL,
  COALESCE(NULLIF(i."name", ''), split_part(i."email", '@', 1)),
  i."phone",
  i."role",
  false,
  false,
  false,
  i."token",
  i."expiresAt",
  i."invitedBy",
  i."createdAt",
  now()
FROM "StaffInvite" i
WHERE i."status" = 'PENDING'
  AND NOT EXISTS (
    SELECT 1 FROM "User" u
    WHERE u."hospitalId" = i."hospitalId" AND u."email" = i."email"
  )
ORDER BY i."hospitalId", lower(i."email"), i."createdAt" DESC;

-- The inviter may have been deleted since; the column is a soft reference.
UPDATE "User" SET "invitedById" = NULL
WHERE "invitedById" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "User"."invitedById");

ALTER TABLE "User"
  ADD CONSTRAINT "User_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "User_inviteToken_key" ON "User"("inviteToken");

DROP TABLE "StaffInvite";
DROP TYPE "StaffInviteStatus";
