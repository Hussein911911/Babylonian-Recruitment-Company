/* ===========================================================================
 *  HRC — نسخ احتياطي إلى **مجلدات خارجية**: Google Drive (مُزامَن) وUSB
 *  ---------------------------------------------------------------------------
 *  ⚠️ لماذا مجلدات لا واجهة برمجية (API)؟
 *
 *  خياران لربط Google Drive:
 *    (أ) Google Drive API  — يحتاج مشروعاً في Google Cloud، شاشة موافقة،
 *        client_id/secret، رمز وصول يتجدّد، وأحياناً مراجعة أمنية من Google.
 *        أي: كلمة سر إضافية تحفظها وتديرها — وهذا يخالف «لا أسألك كلمة سر».
 *    (ب) مجلد Drive المُزامَن — برنامج Google Drive Desktop يُزامن مجلداً على
 *        القرص، فننسخ إليه كأي مجلد آخر. **صفر مفاتيح، صفر كلمات سر، صفر
 *        حسابات جديدة.** وDrive نفسه يرفع الملف إلى السحابة.
 *
 *  اخترنا (ب). نفس الكود يعمل لـUSB أيضاً: USB ليس إلا مجلداً بمسار آخر.
 *
 *  ⚠️ لماذا النسخ لا النقل؟
 *  لو نقلنا الملف ثم فُصل USB بعد النقل وقبل التحقق، خسرنا النسخة الوحيدة.
 *  لذلك: ننسخ → نتحقق بالبصمة → نكتب بياناً → ثم فقط نُطبّق الاحتفاظ.
 *  ولو فشل أي هدف، النسخة الأصلية تبقى سليمة في مجلد الوكيل.
 *
 *  ⚠️ حدّ يجب قوله بصراحة:
 *  «نجح النسخ» هنا يعني أن الملف وصل إلى القرص بالبصمة الصحيحة. أما أن Drive
 *  رفعه فعلاً إلى السحابة، فهذا شيء يقرّر Google Drive Desktop نفسه ولا
 *  نستطيع إثباته من هنا. نتحقق من *وجود المجلد* قبل كل نسخة، لا من الرفع.
 * =========================================================================== */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export const TARGETS_FORMAT = 'HRC-BACKUP-TARGETS-v1';

/* بصمة الملف كاملاً — نستخدمها للتأكد أن النسخة طبق الأصل */
export function sha256File(path) {
  const hash = createHash('sha256');
  const fd = readFileSync(path); // الأرشيف ~١١٥ كيلوبايت؛ التحويل للتدفق غير لازم
  hash.update(fd);
  return hash.digest('hex');
}

/* مجلد USB قد يُفصل — نتحقق قبل أن نبدأ بالنسخ كي لا نُفشل نسخة كاملة */
export function targetAvailable(path) {
  try {
    const p = resolve(path);
    if (!existsSync(p)) return false;
    if (!statSync(p).isDirectory()) return false;
    /* اختبار كتابة حقيقي: بعض الأقراص تُظهر المجلد لكنها للقراءة فقط */
    const probe = join(p, '.hrc-write-probe');
    writeFileSync(probe, String(Date.now()), { flag: 'w' });
    const ok = readFileSync(probe, 'utf8').length > 0;
    unlinkSync(probe);
    return ok;
  } catch { return false; }
}

/* ينسخ (لا ينقل) زوج الأرشيف + البيان إلى هدف واحد، ويتحقق من البصمة */
export function mirrorPairTo(pairFile, manifestFile, targetDir, { keep = 3 } = {}) {
  const dest = resolve(targetDir);
  mkdirSync(dest, { recursive: true });
  const archiveName = pairFile.split(/[\\/]/).at(-1);
  const manifestName = manifestFile.split(/[\\/]/).at(-1);
  const destArchive = join(dest, archiveName);

  copyFileSync(pairFile, destArchive);

  /* ⚠️ التحقق بعد النسخ لا قبله: قرص USB قد يكتب بيانات ناقصة بلا خطأ */
  const sourceHash = sha256File(pairFile);
  const copiedHash = sha256File(destArchive);
  if (sourceHash !== copiedHash) {
    try { unlinkSync(destArchive); } catch { /* لا شيء لنُنظّفه */ }
    throw new Error('بصمة النسخة المنقولة لا تطابق الأصل — أُلغيت النسخة على هذا الهدف');
  }
  copyFileSync(manifestFile, join(dest, manifestName));

  /* بيان الوجهة — يُثبت ماذا وصل ومتى، بلا أي بيانات تشغيلية */
  const targetManifest = {
    format: TARGETS_FORMAT,
    archive: archiveName,
    sha256: copiedHash,
    bytes: statSync(destArchive).size,
    copiedAt: new Date().toISOString(),
  };
  writeFileSync(join(dest, archiveName + '.mirror.json'), JSON.stringify(targetManifest, null, 2));

  /* الاحتفاظ: نطبّقه بعد النجاح فقط، وعلى أزواج تحمل بياناً صالحاً فقط */
  const kept = pruneMirror(dest, keep);

  return { target: dest, archive: archiveName, sha256: copiedHash, kept };
}

/* يحذف الأقدم فقط، ولا يمسّ شيئاً لم نُنشئه (لا ملفات المستخدم) */
function pruneMirror(dest, keep) {
  const mirrors = readdirSync(dest)
    .filter((f) => /^hrc-[\dTZ.-]+\.hrcdb\.mirror\.json$/.test(f))
    .sort();
  const toDrop = mirrors.slice(0, Math.max(0, mirrors.length - Math.max(1, Math.min(365, keep))));
  for (const entry of toDrop) {
    try {
      const meta = JSON.parse(readFileSync(join(dest, entry), 'utf8'));
      if (meta.format !== TARGETS_FORMAT) continue;
      /* نتحقق أن الأرشيف المذكور هو فعلاً الملف المُدار — لا نحذف بالاسم وحده */
      if (meta.archive !== entry.replace(/\.mirror\.json$/, '')) continue;
      const a = join(dest, meta.archive);
      if (existsSync(a)) unlinkSync(a);
      unlinkSync(join(dest, entry));
      const m = a + '.json';
      if (existsSync(m)) unlinkSync(m);
    } catch { /* هدف تالف لا يُوقف النسخة الأخرى */ }
  }
  return readdirSync(dest).filter((f) => /\.hrcdb$/.test(f)).sort();
}

/* نُنسخ إلى كل الأهداف المتاحة، ونُبلّغ بصدق عن كل هدف.
   هدف مفصول (USB خارج الجهاز) لا يُفشل النسخة — بل يُسجَّل «غائب». */
export function mirrorPair(pairFile, manifestFile, targets, { keep = 3 } = {}) {
  const results = [];
  for (const t of targets || []) {
    const dir = typeof t === 'string' ? t : t.path;
    const name = (typeof t === 'object' && t.name) || dir;
    if (!targetAvailable(dir)) {
      results.push({ target: dir, name, ok: false, absent: true, reason: 'المجلد غير موجود أو غير قابل للكتابة الآن' });
      continue;
    }
    try {
      const r = mirrorPairTo(pairFile, manifestFile, dir, { keep });
      results.push({ target: dir, name, ok: true, ...r });
    } catch (e) {
      results.push({ target: dir, name, ok: false, reason: e.message || String(e) });
    }
  }
  return results;
}
