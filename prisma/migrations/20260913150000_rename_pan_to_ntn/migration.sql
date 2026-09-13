-- PAN is India's Permanent Account Number. Pakistan's equivalent is the
-- National Tax Number, so the column is renamed rather than dropped: any value
-- already captured is the same kind of identifier and should survive.
--
-- Staff.aadharNumber and Patient.aadharNumber are deliberately NOT touched
-- here. Aadhaar is an identity document, not a tax number, and its Pakistani
-- counterpart (CNIC) has a different shape and validation. That belongs with
-- the identity pass, not this one. See CHANGES.md.
ALTER TABLE "Staff" RENAME COLUMN "panNumber" TO "nationalTaxNo";
ALTER TABLE "Supplier" RENAME COLUMN "panNumber" TO "nationalTaxNo";
ALTER TABLE "LabVendor" RENAME COLUMN "panNumber" TO "nationalTaxNo";
