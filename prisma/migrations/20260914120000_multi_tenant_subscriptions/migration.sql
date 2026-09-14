-- Multi-tenant SaaS: subscriptions become a thing in their own right, and an
-- email address identifies a person within a clinic rather than across the
-- whole platform.
--
-- Hand-written, as every migration in this project is. `prisma migrate diff`
-- would have emitted DROP COLUMN for the five plan columns on "Hospital" with
-- nothing to carry their values anywhere, so every existing tenant would have
-- come out the far side on a default Free subscription.

-- ---------------------------------------------------------------------------
-- 1. Subscriptions
-- ---------------------------------------------------------------------------

CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('DUE', 'PAID', 'VOID');

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "patientLimitOverride" INTEGER,
    "staffLimitOverride" INTEGER,
    "storageLimitMbOverride" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_hospitalId_key" ON "Subscription"("hospitalId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_hospitalId_fkey"
    FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'DUE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionInvoice_invoiceNo_key" ON "SubscriptionInvoice"("invoiceNo");
CREATE INDEX "SubscriptionInvoice_subscriptionId_idx" ON "SubscriptionInvoice"("subscriptionId");
CREATE INDEX "SubscriptionInvoice_hospitalId_idx" ON "SubscriptionInvoice"("hospitalId");
CREATE INDEX "SubscriptionInvoice_status_idx" ON "SubscriptionInvoice"("status");
CREATE INDEX "SubscriptionInvoice_issuedAt_idx" ON "SubscriptionInvoice"("issuedAt");

ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Carry every existing tenant's plan across before the columns go
--
-- An allowance is only written down as an override where it differs from what
-- the plan itself now grants (lib/plans.ts). A clinic sitting on the Free
-- tier's own 100/3/500 gets NULLs, so when the Free tier is raised, they are
-- raised with it — which is the whole point of moving the numbers out of the
-- row.
-- ---------------------------------------------------------------------------

INSERT INTO "Subscription" (
    "id", "hospitalId", "plan", "status",
    "currentPeriodStart", "currentPeriodEnd",
    "patientLimitOverride", "staffLimitOverride", "storageLimitMbOverride",
    "createdAt", "updatedAt"
)
SELECT
    md5(random()::text || h."id"),
    h."id",
    h."plan",
    CASE
        -- A plan that has already lapsed must not be carried over as ACTIVE.
        WHEN h."planExpiresAt" IS NOT NULL AND h."planExpiresAt" < NOW() THEN 'PAST_DUE'::"SubscriptionStatus"
        ELSE 'ACTIVE'::"SubscriptionStatus"
    END,
    h."createdAt",
    h."planExpiresAt",
    CASE WHEN h."patientLimit"   IS DISTINCT FROM (CASE WHEN h."plan" = 'FREE' THEN 100 ELSE -1 END) THEN h."patientLimit"   END,
    CASE WHEN h."staffLimit"     IS DISTINCT FROM (CASE WHEN h."plan" = 'FREE' THEN 3   ELSE -1 END) THEN h."staffLimit"     END,
    CASE WHEN h."storageLimitMb" IS DISTINCT FROM (CASE WHEN h."plan" = 'FREE' THEN 500 ELSE -1 END) THEN h."storageLimitMb" END,
    NOW(),
    NOW()
FROM "Hospital" h;

ALTER TABLE "Hospital"
    DROP COLUMN "plan",
    DROP COLUMN "planExpiresAt",
    DROP COLUMN "patientLimit",
    DROP COLUMN "staffLimit",
    DROP COLUMN "storageLimitMb";

DROP INDEX IF EXISTS "Hospital_plan_idx";

-- ---------------------------------------------------------------------------
-- 3. An email address identifies a person within one clinic
--
-- The global unique index made the same dentist working at two practices
-- impossible, and told the second clinic to try that "an account with this
-- email already exists" — about a clinic they cannot see.
--
-- The compound index is created first: if two tenants somehow already share an
-- address inside one clinic this fails here, before the global guarantee is
-- given up, rather than after.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "User_hospitalId_email_key" ON "User"("hospitalId", "email");
DROP INDEX IF EXISTS "User_email_key";

ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "User_isPlatformAdmin_idx" ON "User"("isPlatformAdmin");
