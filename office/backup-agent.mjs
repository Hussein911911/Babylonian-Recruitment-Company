// Independent PostgreSQL logical archives. No service-role key; never plaintext
// on disk. pg_dump is read-only; restore-drill refuses non-loopback targets.
import {spawn} from 'node:child_process';
import {createCipheriv,createDecipheriv,randomBytes,publicEncrypt,privateDecrypt,constants,createHash,generateKeyPairSync,createPublicKey} from 'node:crypto';
import {createReadStream,createWriteStream,readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,renameSync,unlinkSync,openSync,fsyncSync,closeSync,statSync,appendFileSync} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicWrite,acquireLock} from './state.mjs';
import {mirrorPair} from './mirror.mjs';
const MAGIC=Buffer.from('HRCDB1');
export function validateSource(url){const u=new URL(url);if(!['postgres:','postgresql:'].includes(u.protocol)||u.password||u.searchParams.has('password')||u.searchParams.get('sslmode')!=='verify-full')throw new Error('Source requires password-free PostgreSQL URL and sslmode=verify-full');return u;}
export function validateTarget(url,confirmation){const u=new URL(url);if(!['postgres:','postgresql:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!/^\/brc_restore_drill_[a-zA-Z0-9_]+$/.test(u.pathname)||u.password||u.search)throw new Error('Only password-free loopback brc_restore_drill_* targets allowed');if(confirmation!=='ISOLATED-ONLY')throw new Error('Explicit isolated restore confirmation required');return u;}
function exe(cfg,name){return cfg.pgBin?join(cfg.pgBin,name+(process.platform==='win32'?'.exe':'')):name;}
function child(cfg,name,args,{readOnly=false}={}){
 const proc=spawn(exe(cfg,name),args,{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PGPASSWORD:'',PGPASSFILE:resolve(cfg.pgpassFile),PGOPTIONS:readOnly?'-c default_transaction_read_only=on -c lock_timeout=10000':'',PGAPPNAME:'HRC-backup-agent'}});
 let stderr='';proc.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-4000);});
 const done=new Promise((yes,no)=>{proc.on('error',no);proc.on('close',code=>code===0?yes():no(new Error(name+' failed (exit '+code+'); inspect local PostgreSQL permissions/version/certificates.')));});
 // Attach immediately: a child can exit before the streaming pipeline finishes.
 done.catch(()=>{});return {proc,done};
}
async function checksum(path){const hash=createHash('sha256');for await(const b of createReadStream(path))hash.update(b);return hash.digest('hex');}
export async function backup(cfg,{clock=()=>new Date(),spawnChild=child}={}){
 validateSource(cfg.databaseUrl);if(!cfg.pgpassFile||!existsSync(cfg.pgpassFile))throw new Error('Private pgpass file required');
 const dest=resolve(cfg.destination);mkdirSync(dest,{recursive:true,mode:0o700});const release=acquireLock(join(dest,'backup.lock'));
 const stamp=clock().toISOString(),name='hrc-'+stamp.replace(/[:.]/g,'-')+'.hrcdb',temp=join(dest,name+'.partial'),final=join(dest,name);
 let source,verifier;
 try{
  const publicKey=readFileSync(cfg.recipientPublicKey),key=randomBytes(32),iv=randomBytes(12);
  const recipient=createPublicKey(publicKey);if(recipient.asymmetricKeyType!=='rsa'||recipient.asymmetricKeyDetails.modulusLength<3072)throw new Error('Recipient RSA key must have at least 3072 bits');
  const wrapped=publicEncrypt({key:recipient,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
  const metadata={version:1,algorithm:'AES-256-GCM',wrap:'RSA-OAEP-SHA256',wrapped:wrapped.toString('base64'),iv:iv.toString('base64'),at:stamp,keyId:createHash('sha256').update(createPublicKey(publicKey).export({type:'spki',format:'der'})).digest('hex')};
  const json=Buffer.from(JSON.stringify(metadata)),len=Buffer.alloc(4);len.writeUInt32BE(json.length);const header=Buffer.concat([MAGIC,len,json]);
  writeFileSync(temp,header,{flag:'wx',mode:0o600});const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
  source=spawnChild(cfg,'pg_dump',['--dbname',cfg.databaseUrl,'--format=custom','--no-owner','--no-privileges','--serializable-deferrable','--lock-wait-timeout=10000'],{readOnly:true});source.proc.stdin.end();
  // Decode the ENTIRE custom archive into a discarded SQL stream in RAM. This
  // validates readable archive blocks, not an actual database restoration.
  verifier=spawnChild(cfg,'pg_restore',['--file=-','--no-owner','--no-privileges']);verifier.proc.stdout.resume();
  const tee=new Transform({transform(chunk,enc,cb){verifier.proc.stdin.write(chunk,error=>{if(error)cb(error);else cb(null,chunk);});},final(cb){verifier.proc.stdin.end(cb);}});
  verifier.proc.stdin.on('error',error=>tee.destroy(error));
  await pipeline(source.proc.stdout,tee,cipher,createWriteStream(temp,{flags:'a',mode:0o600}));
  await Promise.all([source.done,verifier.done]);appendFileSync(temp,cipher.getAuthTag());
  const fd=openSync(temp,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,final);
  const manifest={format:'HRC-DATABASE-ARCHIVE-v1',file:name,createdAt:stamp,bytes:statSync(final).size,sha256:await checksum(final),validation:'full-archive-decoded-without-database-writes',sourceId:createHash('sha256').update(cfg.databaseUrl).digest('hex'),scope:'PostgreSQL logical database; no global roles/ACL ownership, Storage file bytes, edge secrets, PITR or project settings',restoreDrill:false};
  atomicWrite(final+'.json',JSON.stringify(manifest,null,2));
  // Retain the latest successful manifest+archive pair by default; never purge a failed
  // job's previous successes. Retention runs only after a new verified archive.
  /* ── نسخة إلى Google Drive / USB ───────────────────────────────────────
     ⚠️ بعد نجاح النسخة الأصلية وقبل التقليم: إن فشل هدف خارجي، النسخة
     الأصلية سليمة ونُسجّل الفشل في البيان بدل إسقاط النسخة كلها.
     keep للأهداف الخارجية مستقل: قد يريد المدير ٣ على Drive ونسخة واحدة هنا. */
  let mirrors=[];
  if(Array.isArray(cfg.mirrorTargets)&&cfg.mirrorTargets.length){
   try{mirrors=mirrorPair(final,final+'.json',cfg.mirrorTargets,{keep:Number(cfg.mirrorKeep)||3});}
   catch(e){mirrors=[{ok:false,reason:e.message||String(e)}];}
   manifest.mirrors=mirrors.map(m=>({name:m.name||m.target,ok:m.ok===true,absent:m.absent===true,reason:m.reason||null,sha256:m.sha256||null}));
   atomicWrite(final+'.json',JSON.stringify(manifest,null,2));
  }
  const keep=Math.max(1,Math.min(365,Number(cfg.keep)||1));
  const manifests=readdirSync(dest).filter(f=>/^hrc-[\dTZ.-]+\.hrcdb\.json$/.test(f)).sort();
  for(const old of manifests.slice(0,-keep)){const p=join(dest,old),m=JSON.parse(readFileSync(p));if(m.format==='HRC-DATABASE-ARCHIVE-v1'&&m.validation==='full-archive-decoded-without-database-writes'&&m.file===old.slice(0,-5)){unlinkSync(p.slice(0,-5));unlinkSync(p);}}
  return manifest;
 }catch(e){source?.proc.kill();verifier?.proc.kill();try{unlinkSync(temp);}catch{}throw e;}finally{release();}
}
export async function inspectArchive(path,cfg){
 const file=resolve(path),manifest=JSON.parse(readFileSync(file+'.json'));
 if(manifest.format!=='HRC-DATABASE-ARCHIVE-v1'||manifest.file!==file.split(/[\\/]/).at(-1)||await checksum(file)!==manifest.sha256)throw new Error('Archive checksum/manifest mismatch');
 const fd=openSync(file,'r');let metadata,header,start;
 try{const prefix=Buffer.alloc(10);const {readSync}=await import('node:fs');if(readSync(fd,prefix,0,10,0)!==10||!prefix.subarray(0,6).equals(MAGIC))throw new Error('Invalid archive header');const length=prefix.readUInt32BE(6);if(length>8192||length<10)throw new Error('Invalid header length');const json=Buffer.alloc(length);if(readSync(fd,json,0,length,10)!==length)throw new Error('Truncated archive header');metadata=JSON.parse(json);header=Buffer.concat([prefix,json]);start=10+length;}finally{closeSync(fd);}
 if(metadata.version!==1||metadata.algorithm!=='AES-256-GCM'||metadata.wrap!=='RSA-OAEP-SHA256')throw new Error('Unknown archive format');
 const password=readFileSync(cfg.privateKeyPasswordFile,'utf8').trim();if(password.length<16)throw new Error('Recovery key password too short');
 const key=privateDecrypt({key:readFileSync(cfg.recipientPrivateKey),passphrase:password,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(metadata.wrapped,'base64'));
 const iv=Buffer.from(metadata.iv,'base64');if(key.length!==32||iv.length!==12)throw new Error('Invalid cipher parameters');
 const size=statSync(file).size;if(size<start+17)throw new Error('Truncated archive');const handle=openSync(file,'r'),tag=Buffer.alloc(16);try{const {readSync}=await import('node:fs');if(readSync(handle,tag,0,16,size-16)!==16)throw new Error('Truncated tag');}finally{closeSync(handle);}
 const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(header);decipher.setAuthTag(tag);
 return {stream:createReadStream(file,{start,end:size-17}),decipher,manifest};
}
export async function verify(path,cfg){
 const {stream,decipher,manifest}=await inspectArchive(path,cfg),parser=child(cfg,'pg_restore',['--file=-','--no-owner','--no-privileges']);parser.proc.stdout.resume();
 try{await pipeline(stream,decipher,parser.proc.stdin);await parser.done;return {ok:true,createdAt:manifest.createdAt,type:'authenticated-archive-validation',restoreDrill:false};}catch(e){parser.proc.kill();throw e;}
}
export async function restoreDrill(path,cfg,confirmation){
 validateTarget(cfg.restoreUrl,confirmation);
 // Authenticate every ciphertext byte BEFORE any restore write. A tampered
 // GCM stream must never reach PostgreSQL before final tag verification.
 await verify(path,cfg);
 const {stream,decipher,manifest}=await inspectArchive(path,cfg);
 // Isolated target must be a freshly created disposable database. No --clean,
 // no --create, never touch source database and no automatic production restore.
 const restore=child(cfg,'pg_restore',['--dbname',cfg.restoreUrl,'--single-transaction','--exit-on-error','--no-owner','--no-privileges']);restore.proc.stdout.resume();
 try{await pipeline(stream,decipher,restore.proc.stdin);await restore.done;return {ok:true,type:'isolated-database-restore',archive:manifest.file,at:new Date().toISOString()};}catch(e){restore.proc.kill();throw e;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const home=resolve(process.env.HRC_OFFICE_HOME||'.office'),command=process.argv[2],statusFile=join(home,'backup-status.json');mkdirSync(home,{recursive:true,mode:0o700});
 try{
  const cfg=JSON.parse(readFileSync(join(home,'backup-config.json')));
  if(command==='keygen'){
   const password=readFileSync(cfg.privateKeyPasswordFile,'utf8').trim();if(password.length<16)throw new Error('Use a recovery-key password of at least 16 characters');
   const pair=generateKeyPairSync('rsa',{modulusLength:4096,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase:password}});
   writeFileSync(cfg.recipientPrivateKey,pair.privateKey,{flag:'wx',mode:0o600});writeFileSync(cfg.recipientPublicKey,pair.publicKey,{flag:'wx',mode:0o600});console.log('Recovery keypair generated. Move the PRIVATE key/password off the backup laptop.');
  }else if(command==='backup'){
   let previous={};try{previous=JSON.parse(readFileSync(statusFile));}catch{}
   const startedAt=new Date().toISOString();atomicWrite(statusFile,JSON.stringify({...previous,lastAttempt:startedAt,state:'running'}));
   try{const result=await backup(cfg);atomicWrite(statusFile,JSON.stringify({state:'success',lastAttempt:startedAt,lastSuccess:result.createdAt,nextPlanned:null,type:'encrypted-postgresql-logical',validation:result.validation,restoreDrill:false}));console.log('Encrypted database archive saved and decoded successfully. This is not a restore drill.');}
   catch(e){atomicWrite(statusFile,JSON.stringify({...previous,lastAttempt:startedAt,state:'failed',error:'Backup failed; inspect laptop configuration/network/disk/PostgreSQL. No success recorded.'}));throw e;}
  }else if(command==='task-status'){
   const next=new Date(process.argv[3]);if(!Number.isFinite(next.getTime())||next.getTime()<=Date.now())throw new Error('Valid future Windows NextRunTime required');
   let status={};try{status=JSON.parse(readFileSync(statusFile));}catch{}
   atomicWrite(statusFile,JSON.stringify({...status,nextPlanned:next.toISOString(),scheduleObservedAt:new Date().toISOString()}));
  }else if(command==='mirror-status'){
   /* يفحص أهداف Drive/USB بلا نسخ — يعرض ما هو موصول الآن.
      مفيد لصاحب العمل: يشغّله قبل أن يغادر للتأكد أن USB موصول. */
   const targets=Array.isArray(cfg.mirrorTargets)?cfg.mirrorTargets:[];
   if(!targets.length){console.log('لا أهداف خارجية مضبوطة. أضف mirrorTargets في backup-config.json');}
   else{for(const t of targets){
     const dir=typeof t==='string'?t:t.path,name=t.name||dir;
     const available=targetAvailable(dir);
     let files=0,latest=null;
     if(available){try{const list=readdirSync(resolve(dir)).filter(f=>/^hrc-[\dTZ.-]+\.hrcdb$/.test(f)).sort();files=list.length;latest=list.at(-1)||null;}catch{}}
     console.log((available?'✓ موصول  ':'✗ مفصول  ')+name+'  →  '+dir+(available?'  ('+files+' نسخة'+(latest?', الأحدث '+latest:'')+')':''));
   }}
  }else if(command==='verify'){console.log(JSON.stringify(await verify(process.argv[3],cfg)));}
  else if(command==='restore-drill'){const result=await restoreDrill(process.argv[3],cfg,process.argv[4]);atomicWrite(join(home,'last-restore-drill.json'),JSON.stringify(result));console.log('Disposable local database restore completed. Production was not targeted.');}
  else throw new Error('Commands: keygen | backup | mirror-status | verify <archive> | restore-drill <archive> ISOLATED-ONLY');
 }catch(e){console.error(e.message);process.exitCode=1;}
}
