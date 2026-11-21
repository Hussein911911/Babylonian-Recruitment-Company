#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — فكّ تشفير حزمة الطوارئ (.hrcbak)
   الاستخدام:
     node tools/open-backup.mjs rescue-kit.hrcbak            # يكتب بجانبه
     node tools/open-backup.mjs … --out /tmp/kit.zip
     node tools/open-backup.mjs … --password-file /path/pw.txt
   كلمة المرور تُقرأ من: --password-file · البيئة HRC_BACKUP_PASSWORD · أو
   سؤال مخفي في الطرفية. لا تُمرَّر أبداً كوسيط سطر أوامر (يظهر في ps).
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { decryptBuffer, readHeader, sha256 } from './backup-crypto.mjs';

function die(m) { console.error(`✖ ${m}`); process.exit(2); }

/* سؤال مخفي: بلا صدى، ويعمل أيضاً حين لا تكون الطرفية TTY */
async function askHidden(prompt) {
  process.stderr.write(prompt);
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let buf = '';
    stdin.on('data', function onData(ch) {
      ch = ch.toString('utf8');
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
        process.stderr.write('\n'); resolve(buf); return;
      }
      if (ch === '\u0003') { process.stderr.write('\n'); process.exit(130); }   // Ctrl-C
      if (ch === '\u007f') { buf = buf.slice(0, -1); return; }
      buf += ch;
    });
  });
}

const file = process.argv[2];
if (!file || file.startsWith('--')) die('الاستخدام: node tools/open-backup.mjs <file.hrcbak> [--out path] [--password-file f]');
if (!existsSync(file)) die(`الملف غير موجود: ${file}`);
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };

const raw = readFileSync(file);
let header;
try { ({ header } = readHeader(raw)); } catch (e) { die(e.message); }
console.log('الملف      :', path.resolve(file));
console.log('الاسم الأصلي:', header.name || '(غير مذكور)');
console.log('الحجم      :', header.plainBytes, 'بايت · بُني', header.createdAt);
console.log('كلمة المرور : تُقرأ الآن (لا تُطبع ولا تُحفظ)');

let pw = process.env.HRC_BACKUP_PASSWORD;
const pf = arg('password-file');
if (pf) pw = readFileSync(pf, 'utf8').replace(/\r?\n$/, '');
if (!pw) pw = await askHidden('كلمة المرور: ');

let out;
try { out = decryptBuffer(raw, pw); } catch (e) {
  die(`فشل الفكّ: ${e.message}\n  تحقّق من كلمة المرور، ومن أن الملف لم يُعدَّل.`);
}
const dest = arg('out') || path.join(path.dirname(file), header.name || (path.basename(file).replace(/\.hrcbak$/i, '') + '.zip'));
writeFileSync(dest, out.plain);
console.log('✔ فُكّ التشفير وبصمة المحتوى مطابقة');
console.log('  sha256   :', sha256(out.plain));
console.log('  كُتب إلى :', path.resolve(dest));
