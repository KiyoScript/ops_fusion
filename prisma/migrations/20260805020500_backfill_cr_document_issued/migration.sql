-- Backfill for the previous migration, which made CollectionReceipt.crNumber
-- nullable and added documentIssued (default false).
--
-- Every CR that existed BEFORE that change was necessarily printed — an
-- undocumented payment was not representable until now. Leaving them at the
-- column default would misreport them as money taken without a receipt, and
-- would drop them out of the booklet accountability report.
UPDATE "CollectionReceipt" SET "documentIssued" = true WHERE "crNumber" IS NOT NULL;
