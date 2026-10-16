-- Restore original two-chance-code issuance without invalidating already printed cards.
begin;
alter table brc.applicants alter column card_print_code drop default;
notify pgrst, 'reload schema';
commit;
