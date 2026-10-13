-- A password is 8 to 32 characters, for every clinic, with no composition
-- rules (lib/password-policy.ts). The minimum-length field and the four
-- capital/small/number/symbol switches are gone from Settings → Security, so
-- the rows they wrote are deleted rather than left claiming a rule nothing
-- enforces.
DELETE FROM "Setting"
WHERE "category" = 'security'
  AND "key" IN (
    'passwordMinLength',
    'passwordRequireUppercase',
    'passwordRequireLowercase',
    'passwordRequireNumbers',
    'passwordRequireSpecialChars'
  );
