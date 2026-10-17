-- 007_utilities_partial.sql — written by C for D's review (TEAM.md section 2); B and D agreed
-- to the value on 2026-10-17.
--
-- utilities_included gains 'partial': some utilities included, or the tenant pays a share or one
-- of them ("tenant pays 40% of utilities", "heat and water included, hydro extra"). Before this,
-- those were stored as 'no', which reads as "tenant pays everything". The worker writes
-- 'partial' only once this constraint allows it (until then it stores 'unknown').

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_utilities_included_check;
ALTER TABLE listings ADD CONSTRAINT listings_utilities_included_check
    CHECK (utilities_included IN ('yes', 'partial', 'no', 'unknown'));
