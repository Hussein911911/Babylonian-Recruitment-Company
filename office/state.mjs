import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
export const hash = value => createHash('sha256').update(value).digest('hex');
export function seal(value, key) {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
 return Buffer.concat([Buffer.from('HRCO1'),iv,cipher.getAuthTag(),bytes]);
}
export function unseal(bytes,key){
 if(bytes.subarray(0,5).toString()!=='HRCO1')throw new Error('invalid_archive');
 const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(5,17));cipher.setAuthTag(bytes.subarray(17,33));
 return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(33)),cipher.final()]).toString());
}
export function atomicWrite(path,bytes){
 mkdirSync(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+randomBytes(6).toString('hex')+'.tmp';
 const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 try{renameSync(temp,path);if(process.platform!=='win32'){const directory=openSync(dirname(path),'r');try{fsyncSync(directory);}finally{closeSync(directory);}}}catch(e){try{unlinkSync(temp);}catch{}throw e;}
}
export function openState(path,key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('32_byte_key_required');
 const state=existsSync(path)?unseal(readFileSync(path),key):{version:1,sessions:{},outbox:[],snapshots:{},lastSync:null,backup:null};
 if(state.version!==1)throw new Error('unknown_state_version');
 state.snapshots??={};
 let tail=Promise.resolve(),durable=JSON.stringify(state);
 const rollback=()=>{for(const k of Object.keys(state))delete state[k];Object.assign(state,JSON.parse(durable));};
 return {state,save(){try{atomicWrite(path,seal(state,key));durable=JSON.stringify(state);}catch(e){rollback();throw e;}},exclusive(fn){const work=tail.then(fn).catch(e=>{rollback();throw e;});tail=work.catch(()=>{});return work;}};
}
export function acquireLock(path){
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const create=()=>{const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,String(process.pid));fsyncSync(fd);}finally{closeSync(fd);}};
 try{create();}catch(e){
  if(e.code!=='EEXIST')throw e;
  const guard=path+'.recover',recovery=openSync(guard,'wx',0o600);closeSync(recovery);
  try{
   const pid=Number(readFileSync(path,'utf8'));if(!Number.isInteger(pid)||pid<1)throw new Error('lock_requires_operator_review');
   let dead=false;try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH')dead=true;}
   if(!dead)throw new Error('another_process_is_running');unlinkSync(path);create();
  }finally{unlinkSync(guard);}
 }
 let released=false;return ()=>{if(!released){released=true;try{unlinkSync(path);}catch{}}};
}
