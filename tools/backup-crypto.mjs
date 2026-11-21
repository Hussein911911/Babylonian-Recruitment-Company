/* ═══════════════════════════════════════════════════════════════════════════
   HRC — تشفير ملفات النسخ الاحتياطي (scrypt + AES-256-GCM)
   ---------------------------------------------------------------------------
   لماذا لا zip بكلمة مرور؟ لأن تشفير ZIP التقليدي ضعيف (ZipCrypto)، و7-Zip
   قد لا يكون موجوداً على جهاز الاستعادة. هنا نستخدم ما في Node نفسه:
     • scrypt (N=2^15, r=8, p=1) لاشتقاق المفتاح — مقاوم للذاكرة/الوقت
     • AES-256-GCM مع وسم مصادقة: أي تعديل بايت واحد يُفسد الفكّ
   صيغة الملف (.hrcbak):
       HRCBK1\n <طول الترويسة 4 بايت big-endian> <ترويسة JSON> <نص مشفّر+وسم>
   الترويسة لا تحوي سراً — فقط ملح/IV/معاملات KDF واسم الملف الأصلي وبصمته.
   ═══════════════════════════════════════════════════════════════════════════ */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

export const MAGIC = 'HRCBK1\n';
const KDF = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024, keylen: 32 };

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function encryptBuffer(plain, password, meta = {}) {
  if (!password || String(password).length < 12) {
    throw new Error('كلمة المرور قصيرة — ١٢ حرفاً على الأقل (عبارة من ٤ كلمات أفضل)');
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(String(password), salt, KDF.keylen, KDF);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = {
    v: 1, kdf: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p,
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    name: meta.name || null, plainBytes: plain.length, plainSha256: sha256(plain),
    createdAt: new Date().toISOString(),
  };
  const hbuf = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(hbuf.length, 0);
  return Buffer.concat([Buffer.from(MAGIC, 'ascii'), len, hbuf, body, tag]);
}

export function readHeader(buf) {
  if (buf.slice(0, MAGIC.length).toString('ascii') !== MAGIC) {
    throw new Error('ليس ملف .hrcbak صالحاً (الترويسة غير مطابقة)');
  }
  const lenAt = MAGIC.length;
  const hlen = buf.readUInt32BE(lenAt);
  const header = JSON.parse(buf.slice(lenAt + 4, lenAt + 4 + hlen).toString('utf8'));
  return { header, bodyAt: lenAt + 4 + hlen };
}

export function decryptBuffer(buf, password) {
  const { header, bodyAt } = readHeader(buf);
  const tag = buf.slice(buf.length - 16);
  const body = buf.slice(bodyAt, buf.length - 16);
  const key = scryptSync(String(password), Buffer.from(header.salt, 'base64'),
    KDF.keylen, { N: header.N, r: header.r, p: header.p, maxmem: KDF.maxmem });
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]); // يرمي إن عُدّل بايت
  const got = sha256(plain);
  if (header.plainSha256 && got !== header.plainSha256) {
    throw new Error('بصمة المحتوى لا تطابق الترويسة — الملف تالف أو مُعدَّل');
  }
  return { plain, header };
}
