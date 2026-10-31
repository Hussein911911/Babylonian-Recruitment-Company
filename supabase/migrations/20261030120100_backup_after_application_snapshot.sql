-- Adding job_snapshot changes the recovery schema fingerprint. Ensure the
-- existing automated backup policy has a usable copy immediately; retain old
-- copies rather than deleting history.
select brc.recovery_ensure_fresh();
