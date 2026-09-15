-- Payroll leaves the schema, and the screens that collected it leave with it.
--
-- Spec §3 puts "full payroll, attendance, or enterprise HR management beyond
-- basic user/staff profiles" out of scope for the initial release. The staff
-- form nonetheless asked for a monthly salary, a bank account number and an
-- IBAN, and stored all three — three columns of a clinic's most sensitive
-- employment data, held for a feature nobody was going to build.
--
-- Attendance and leave went the same way in 39fdd2e; this is the rest of it.
--
-- Deliberately not preserved. There is nowhere to move a salary to, and
-- keeping a copy of staff bank details "just in case" is the opposite of what
-- dropping the feature is for.
ALTER TABLE "Staff"
  DROP COLUMN "salary",
  DROP COLUMN "bankAccountNo",
  DROP COLUMN "bankIban";
