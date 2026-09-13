-- A payment can now be refunded in part, which the existing statuses could not
-- express: COMPLETED hid the refund, REFUNDED claimed the whole amount had
-- gone back.
--
-- Separate from the migration before it because PostgreSQL will not let a new
-- enum value be added and then used inside the same transaction. Nothing here
-- writes the value; the first row to use it comes from application code, in a
-- later transaction.
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED' BEFORE 'REFUNDED';
