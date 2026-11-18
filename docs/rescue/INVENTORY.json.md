# جرد الحزمة — HRC Rescue Kit
> يُولَّد من قراءة فعلية للإنتاج بتاريخ 2026-11-18. أي رقم هنا مقيس، لا مُقدَّر.

## ١. الكود

| البند | القيمة |
|---|---|
| المستودع | Hussein911911/Babylonian-Recruitment-Company |
| الفرع | `arena/48cbd681-babylonian-recruitment-company` |
| الـcommit | `cab5025` |
| الـcommit الأساس | `36a26de` |
| تعديلات غير محفوظة | **لا شيء** (شجرة العمل نظيفة) |
| Node المطلوب | 22.x (جُرِّب على v22.22.3) |
| npm | 10.9.8 · lockfileVersion 3 |
| الملفات في الأرشيف | 643 ملفاً |
| حجم الأرشيف | 53 م.ب |
| البناء | `npm ci` ثم `npm run dist` → 98 ملفاً · 11.7 م.ب |

**ما استُثني من الأرشيف:** `node_modules/`, `.git/`, `dist/`, `tests/.tmp/`, `.office/`, `*.key.pem`, `*.pgpass`, `*.hrcdb`.

## ٢. قاعدة البيانات — مقارنة الاسترجاع الفعلي بالإنتاج

نُفِّذ `docs/schema.sql` على قاعدة **فارغة معزولة** (PGlite، بلا أي اتصال بالإنتاج)، ثم قُورنت الكائنات بجرد الإنتاج الحيّ:

| الكائن | المسترجَع | الإنتاج | الحالة |
|---|---|---|---|
| جداول `brc` | 20 | 22 | **ناقص ٢** — انظر أدناه |
| دوال | 74 | 75 | **ناقص ١** — `security_audit` |
| مشغّلات | 22 | 22 | ✓ مطابق |
| فهارس | 42 | 42 | ✓ مطابق |
| سياسات RLS | 18 | 18 | ✓ مطابق |
| عروض (views) | 7 | 7 | ✓ مطابق |
| جداول بـRLS | 20 | 22 | **ناقص ٢** — نفس الجدولين |
| تتابعات | 3 | 3 | ✓ `audit_log_id_seq`, `form_serial_seq`, `job_code_seq` |
| مدة بناء الهيكل | 205 ms | — | — |

### النقص المعلن (بقصد، موثّق في `tools/recovery-core.mjs` KNOWN_GAPS)

| الكائن | لماذا ليس في الملف |
|---|---|
| `brc.applicants_no_backup_20261011` (٧ صفوف) | لقطة صيانة يدوية قبل حذف — ليست جزءاً من التطبيق |
| `brc.jobs_image_url_rollback_20261112` (٤ صفوف) | لقطة تراجع قبل نقل الصور |
| `brc.security_audit()` | دالة تدقيق داخلية — غير لازمة للتشغيل |

**لا يوجد أي نقص غير مفسَّر.** كل فرق بين الملف والإنتاج له اسم وسبب.

## ٣. أعداد البيانات الحقيقية (للمقارنة بعد الاسترجاع)

| الجدول | الصفوف | الحجم |
|---|---|---|
| `brc.applicants` | 725 | 119 kB |
| `brc.jobs` | 22 | 8.7 kB |
| `brc.job_attempts` | 1,535 | 131 kB |
| `brc.audit_log` | 3,801 | 23 MB |
| `brc.issued_serials` | 769 | 37 kB |
| `brc.card_number_registry` | 175 | 8.4 kB |
| `brc.recovery_chances` | 1,535 | 156 kB |
| `brc.recovery_prints` | 725 | 26 kB |
| `brc.card_issue_requests` | 29 | — |
| `brc.staff` | 3 | — |
| `brc.settings` | 5 | — |
| `brc.employer_job_credentials` | 3 | — |
| `brc.card_lookup_budget` | 6 | — |
| `brc.employer_otp` | 1 | — |
| `brc.employer_login_budget` | 1 | — |
| `brc.recovery_control` | 1 | — |
| `brc.recovery_copies` | 5 | — |
| `brc.card_number_counter` | 1 | — |
| `brc.office_receipts` | 0 | — |
| `brc.recovery_tickets` | 0 | — |
| `auth.users` | **4** | — |
| `storage.objects` | 5 | — |

> ⚠️ `auth.users` = ٤ بينما `brc.staff` = ٣ — يوجد حساب واحد بلا صف موظف. راجعه بعد الاسترجاع.

## ٤. المهام المجدولة (pg_cron) — **ليست في SQL**

| # | الاسم | التوقيت | الأمر | مفعّلة |
|---|---|---|---|---|
| 1 | `brc-auto-release` | `* * * * *` (كل دقيقة) | `select * from brc.run_auto_release();` | نعم |
| 6 | `hrc-card-archive-daily` | `15 0 * * *` | `select brc.archive_finished_cards();` | نعم |
| 7 | `recovery-ensure-fresh` | `10 1 * * *` | `select brc.recovery_ensure_fresh();` | نعم |
| 8 | `recovery-auto-backup` | `0 20 * * *` | `select brc.recovery_run_scheduled();` | نعم |

يجب إعادة إنشائها يدوياً — الكود في `database/recreate-cron.sql`.

## ٥. الامتدادات

`pg_cron`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`

**يلزم تفعيلها من اللوحة قبل تنفيذ الاسترجاع:** `pgcrypto`, `pg_cron`.

## ٦. Edge Functions

| الاسم | النسخة | verify_jwt | المصدر |
|---|---|---|---|
| `hrc-staff-admin` | 1 | **نعم** | `supabase/functions/hrc-staff-admin/index.ts` ✓ في المستودع |

`hrc-employer-otp` موجود في المستودع لكنه **غير منشور** على الإنتاج. لا تنشره بلا داعٍ.

## ٧. التخزين

| Bucket | عام؟ | حد الحجم | الأنواع المسموحة | ملفات | بايت |
|---|---|---|---|---|---|
| `job-images` | **نعم** | 2,097,152 | jpeg, png, webp | 5 | 790,882 |

الملفات: `jobs/hrc-1043.jpg`, `jobs/hrc-1045.jpg`, `jobs/hrc-1046.jpg`, `jobs/hrc-1057.jpg`, `jobs/new.jpg`

⚠️ **لم تُنزَّل** — انظر `MISSING-ITEMS.md`.

## ٨. المصادقة

| البند | القيمة |
|---|---|
| النظام | **Supabase Auth** (`signInWithPassword`) — لا نظام مخصص |
| `site_url` | `http://localhost:3000` ← **قيمة افتراضية لم تُضبط** |
| ترويسات النسخ (hashes) | موجودة (bcrypt) لكل الحسابات الثلاثة |
| تأكيد البريد | مفعّل للجميع |
| مزوّدو OAuth | **لا أحد** — بريد/كلمة مرور فقط |
| SMTP مخصص | **لا** (يستخدم بريد Supabase) |
| CAPTCHA | معطّل |
| التسجيل مفتوح | `disable_signup: false` |

## ٩. النشر

| البند | القيمة |
|---|---|
| المنصة | Cloudflare Pages |
| الرابط | `babylonian-recruitment-company.pages.dev` |
| فرع الإنتاج | `main` |
| الدومين المخصص | **لا يوجد** (`hrc-babil.com` غير مسجَّل) |
| مخرجات البناء | `dist/` |
| `functions/api/revalidate.js` | دالة حافة على Cloudflare |
| متغيرات البيئة | لا توجد — المفتاح العام داخل `assets/js/supabase-config.js` |
