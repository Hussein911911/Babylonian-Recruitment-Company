-- INSERT policies do not grant access to the bigserial sequence.
-- Keep all existing audit RLS/read/immutability rules unchanged.
begin;
grant usage on sequence brc.audit_log_id_seq to authenticated;
notify pgrst, 'reload schema';
commit;
