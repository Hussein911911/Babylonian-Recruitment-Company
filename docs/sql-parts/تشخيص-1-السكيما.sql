-- ═══════════════════════════════════════════════════════════════════════════
--  HRC — تشخيص حالة القاعدة (قراءة فقط · لا يمسّ شيئاً)
--  ---------------------------------------------------------------------------
--  الغرض: تعرف **بالضبط** شنو موجود الآن قبل أن تنظّف أو تلصق.
--
--  ⚠ لا يُنشئ ولا يحذف ولا يعدّل. كل جملة `select`. الاستعلامات لا تُفرّغ
--    ولا تُلغي شيئاً — آمنة تماماً.
--
--  الطريقة: Supabase → SQL Editor → New query → الصق ← Run
--           ثم انسخ النتيجة وأرسلها لي.
--
--  ⚠ إن ظهر خطأ في سطر واحد، احذف ذلك السطر فقط وأعد التشغيل — لا تتوقف.
-- ═══════════════════════════════════════════════════════════════════════════ */

/* ═══ ① هل السكيما موجودة؟ ══════════════════════════════════════════════════
   المرجع (قاعدة كاملة بعد كل الهجرات): 19 جدولاً · 66 دالة · 21 مشغّلاً.
   نصف مبنية = 7 جداول و19 دالة (جزءان فقط) ← تكمّل من الجزء 3.
   فاضية = صفر ← ابدأ من الجزء 1.

   ⚠ الأعداد تزيد مع كل هجرة جديدة. المهمّ ليس الرقم بل **التدرّج**:
     صفر      → لم تلصق شيئاً
     أقلّ      → نصف بناء، أكمل من حيث توقفت
     قريب      → مكتمل، انتقل للبيانات */
select '① جداول brc'    as العنصر, count(*) as العدد from pg_tables where schemaname = 'brc'
union all select '① دوال brc',   count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'brc'
union all select '① مشغّلات brc', count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
                                  join pg_namespace n on n.oid = c.relnamespace
                                  where n.nspname = 'brc' and not t.tgisinternal
union all select '① أنواع brc',  count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
                                  where n.nspname = 'brc' and t.typtype = 'e'
order by 1;
