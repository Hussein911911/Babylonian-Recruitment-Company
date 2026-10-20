// REAL crypto, streams, subprocess failures, retention, path guards. PostgreSQL
// executables are deliberate SYNTHETIC fixtures: not proof of a pg_restore drill.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {backup,verify,validateSource,validateTarget,restoreDrill} from '../office/backup-agent.mjs';
const dir=mkdtempSync(join(tmpdir(),'hrc-database-agent-'));let count=0;
const check=(name,v)=>{assert.ok(v,name);count++;console.log('✓ '+name);};
try{
 const schedule=readFileSync(new URL('../office/windows/Register-Tasks.ps1',import.meta.url),'utf8');
 check('Windows registration is weekly, Friday by default, not daily',schedule.includes('-Weekly -WeeksInterval 1 -DaysOfWeek $BackupDay')&&schedule.includes("$BackupDay='Friday'")&&!schedule.includes('-Daily'));
 check('Windows registration rejects old multi-copy retention config',schedule.includes('$backupConfig.keep -ne 1'));
 const bin=join(dir,'bin'),dest=join(dir,'backups');mkdirSync(bin);mkdirSync(dest);
 const pair=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase:'fixture-recovery-password'}});
 const cfg={databaseUrl:'postgresql://fixture@localhost:5432/postgres?sslmode=verify-full',pgpassFile:join(dir,'fixture.pgpass'),pgBin:bin,destination:dest,recipientPublicKey:join(dir,'public.pem'),recipientPrivateKey:join(dir,'private.pem'),privateKeyPasswordFile:join(dir,'password.txt'),restoreUrl:'postgresql://fixture@127.0.0.1:5434/brc_restore_drill_fixture',keep:2};
 writeFileSync(cfg.pgpassFile,'localhost:5432:postgres:fixture:synthetic-only',{mode:0o600});writeFileSync(cfg.recipientPublicKey,pair.publicKey);writeFileSync(cfg.recipientPrivateKey,pair.privateKey,{mode:0o600});writeFileSync(cfg.privateKeyPasswordFile,'fixture-recovery-password',{mode:0o600});
 const dump=`#!/usr/bin/env node\nif(process.env.HRC_FAKE_DUMP_FAIL)process.exit(9);process.stdout.write(Buffer.concat([Buffer.from('PGDMP-SYNTHETIC fixture-customer-07700000000'),Buffer.alloc(1200000,65)]));`;
 const restore=`#!/usr/bin/env node\nlet first=true;process.stdin.on('data',b=>{if(first&&!b.subarray(0,5).equals(Buffer.from('PGDMP')))process.exit(7);first=false;});process.stdin.on('end',()=>{if(process.env.HRC_FAKE_PARSE_FAIL)process.exit(8);process.exit(0);});`;
 writeFileSync(join(bin,'pg_dump'),dump,{mode:0o700});writeFileSync(join(bin,'pg_restore'),restore,{mode:0o700});
 assert.throws(()=>validateSource('postgresql://user:secret@db/postgres?sslmode=verify-full'));assert.throws(()=>validateSource('postgresql://user@db/postgres?sslmode=require'));check('source forbids URL passwords and unverified TLS',true);
 for(const url of ['postgresql://user@db.supabase.co/brc_restore_drill_test','postgresql://user@127.0.0.1/postgres','postgresql://user@localhost/brc_restore_drill_test?host=db.supabase.co'])assert.throws(()=>validateTarget(url,'ISOLATED-ONLY'));check('restoration cannot target production, generic local DB, or libpq host override',true);
 assert.throws(()=>validateTarget(cfg.restoreUrl,''));check('isolated restore requires explicit confirmation',true);
 const manifest=await backup(cfg,{clock:()=>new Date('2026-10-19T09:00:00Z')}),file=join(dest,manifest.file);
 check('successful encrypted archive atomically published',manifest.bytes>1200000&&manifest.validation==='full-archive-decoded-without-database-writes');
 check('manifest does not pretend a restore succeeded',manifest.restoreDrill===false);
 check('no database password, customer data or private key in ciphertext',!readFileSync(file).includes(Buffer.from('fixture-customer'))&&!readFileSync(file).includes(Buffer.from('synthetic-only'))&&!readFileSync(file).includes(Buffer.from('PRIVATE KEY')));
 const result=await verify(file,cfg);check('real RSA-OAEP/AES-GCM round trip authenticated',result.ok&&result.restoreDrill===false);
 writeFileSync(cfg.privateKeyPasswordFile,'incorrect-password-at-least-16');await assert.rejects(()=>verify(file,cfg));check('wrong recovery password rejected',true);writeFileSync(cfg.privateKeyPasswordFile,'fixture-recovery-password');
 const original=readFileSync(file);const bad=Buffer.from(original);bad[bad.length-1]^=1;writeFileSync(file,bad);await assert.rejects(()=>verify(file,cfg));check('ciphertext corruption rejected by checksum',true);
 const m={...manifest,sha256:createHash('sha256').update(bad).digest('hex')};writeFileSync(file+'.json',JSON.stringify(m));await assert.rejects(()=>verify(file,cfg));check('tampering rejected by GCM even if attacker replaces checksum',true);writeFileSync(file,original);writeFileSync(file+'.json',JSON.stringify(manifest));
 process.env.HRC_FAKE_DUMP_FAIL='1';await assert.rejects(()=>backup(cfg,{clock:()=>new Date('2026-10-19T09:01:00Z')}));delete process.env.HRC_FAKE_DUMP_FAIL;check('source failure cannot publish a partial success',readdirSync(dest).filter(f=>f.endsWith('.hrcdb')).length===1&&!readdirSync(dest).some(f=>f.endsWith('.partial')));
 process.env.HRC_FAKE_PARSE_FAIL='1';await assert.rejects(()=>backup(cfg,{clock:()=>new Date('2026-10-19T09:02:00Z')}));delete process.env.HRC_FAKE_PARSE_FAIL;check('archive decoder failure preserves prior verified backup',readdirSync(dest).filter(f=>f.endsWith('.hrcdb')).length===1);
 await backup(cfg,{clock:()=>new Date('2026-10-19T09:03:00Z')});await backup(cfg,{clock:()=>new Date('2026-10-19T09:04:00Z')});check('retention keeps latest two verified pairs, only after success',readdirSync(dest).filter(f=>f.endsWith('.hrcdb')).length===2&&!readdirSync(dest).includes(manifest.file));
 // Explicit latest-only policy: a failure must not remove the last good pair.
 cfg.keep=1;
 const latest=await backup(cfg,{clock:()=>new Date('2026-10-19T09:05:00Z')});
 check('keep=1 retains exactly the newest verified archive and manifest',readdirSync(dest).filter(f=>f.endsWith('.hrcdb')).length===1&&readdirSync(dest).includes(latest.file));
 process.env.HRC_FAKE_PARSE_FAIL='1';await assert.rejects(()=>backup(cfg,{clock:()=>new Date('2026-10-19T09:06:00Z')}));delete process.env.HRC_FAKE_PARSE_FAIL;
 check('keep=1 decoder failure preserves the latest verified pair',readdirSync(dest).filter(f=>f.endsWith('.hrcdb')).length===1&&readdirSync(dest).includes(latest.file));
 delete cfg.keep;await backup(cfg,{clock:()=>new Date('2026-10-19T09:07:00Z')});
 check('default retention is one successful copy',readdirSync(dest).filter(f=>f.endsWith('.hrcdb')).length===1);
 // Guard runs BEFORE opening/decrypting any input or launching a DB process.
 await assert.rejects(()=>restoreDrill('/does-not-exist',{...cfg,restoreUrl:'postgresql://user@production.supabase.co/postgres'},'ISOLATED-ONLY'),/loopback/);check('production restore rejected before any process or file access',true);
 console.log(`Database archive agent: ${count} checks passed (synthetic PostgreSQL executables; real native restore NOT tested).`);
}finally{delete process.env.HRC_FAKE_PARSE_FAIL;delete process.env.HRC_FAKE_DUMP_FAIL;rmSync(dir,{recursive:true,force:true});}
