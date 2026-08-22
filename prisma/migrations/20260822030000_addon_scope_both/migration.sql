-- Allow a global add-on to apply to a line item, the whole JO, or BOTH.
-- Additive enum value; existing PER_LINE_ITEM / WHOLE_JO rows are unaffected.
ALTER TYPE "AddonScope" ADD VALUE IF NOT EXISTS 'BOTH';
