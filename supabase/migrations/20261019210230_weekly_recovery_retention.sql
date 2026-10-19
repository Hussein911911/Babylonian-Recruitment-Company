-- Weekly operational recovery, Friday 23:00 Baghdad (20:00 UTC).
-- A failed capture/verification/prune rolls back as ONE transaction; old copies
-- survive. Only the database owner/cron may call this private function.
create or replace function brc.recovery_weekly() returns uuid
language plpgsql security definer set search_path=brc,public as $$
declare p jsonb; k text; result uuid;
begin
 perform set_config('lock_timeout','8s',true);
 perform pg_advisory_xact_lock(8310192026);
 lock table brc.applicants,brc.jobs,brc.job_attempts,brc.settings,brc.employer_job_credentials in share mode;
 p:=brc.recovery_capture();
 select secret into strict k from brc.recovery_control where singleton;
 insert into brc.recovery_copies(name,actor,safety,counts,schema_hash,data_hash,ciphertext)
 values('نسخة أسبوعية — '||to_char(clock_timestamp() at time zone 'Asia/Baghdad','YYYY-MM-DD HH24:MI'),null,false,brc.recovery_counts(p),p->>'schema',encode(extensions.digest(p::text,'sha256'),'hex'),extensions.pgp_sym_encrypt(p::text,k,'cipher-algo=aes256,compress-algo=1')) returning id into result;
 -- Decrypt and authenticate the new copy BEFORE removing any old copy.
 if brc.recovery_read(result) is distinct from p then raise exception 'فشل التحقق من النسخة الأسبوعية';end if;
 delete from brc.recovery_tickets where copy_id<>result;
 delete from brc.recovery_copies where id<>result;
 return result;
end $$;
revoke all on function brc.recovery_weekly() from public,anon,authenticated,service_role;
-- SCHEDULER: installed pg_cron required. No external service/credentials.
select cron.schedule('hrc-weekly-recovery','0 20 * * 5','select brc.recovery_weekly();');
