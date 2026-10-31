-- The removed sale/fill UI must not leave a direct public sale endpoint.
-- apply_with_card and office_submit still use this function as a private helper;
-- retaining it preserves self-service applications and office conflict checks.
-- Existing cards, applications, receipts and audit history are not deleted.
revoke all on function brc.activate_card(text, jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
