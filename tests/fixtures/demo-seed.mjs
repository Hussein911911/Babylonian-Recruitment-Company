/* ===========================================================================
 *  tests/fixtures/demo-seed.mjs — بيانات عرض للاختبارات وحدها
 *  ---------------------------------------------------------------------------
 *  لماذا هنا لا في assets/js/config.js؟
 *    كانت هذه البيانات (8 وظائف و8 متقدمين بأسماء وأرقام وهمية) مزروعة في
 *    config.js فتصل إلى الإنتاج. وهذا خطر تشغيلي: أي موظف يفتح اللوحة على
 *    جهاز جديد أو بلا اتصال كان يراها ويحسبها سجلات حقيقية فيتصل بأرقام لا
 *    وجود لها. أُفرغت من الإنتاج (2026-09-19) ونُقلت إلى هنا.
 *
 *  الاختبارات التي تفحص الواجهة (بطاقات الوظائف، الاستمارة، التصفية) تحتاج
 *  بيانات لتعمل، فتحقنها من هذا الملف عبر applyDemoSeed(window) قبل تحميل
 *  store.js — فتبقى القوة الكاملة للفحوص دون أن يتلوّث الإنتاج.
 * ========================================================================= */

export const DEMO_SEED = {
      jobs: [
        { code: 'HRC-1042', title: 'عامل مخزن', category: 'صناعي', region: 'الحلة', salaryMin: 600000, salaryMax: 750000, shift: 'صباحي', employer: { name: 'مخازن الفرات للتبريد', phone: '07701234567', address: 'الحلة - المنطقة الصناعية - شارع المعمل' }, interviewLocation: 'مقر الشركة - الحلة', requirements: ['لياقة بدنية جيدة', 'خبرة سنة على الأقل', 'شهادة جنسية + سكن'], gender: 'لا فرق', imageUrl: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&q=80' },
        { code: 'HRC-1043', title: 'سائق حمل (فئة ثالثة)', category: 'خدمات', region: 'المحاويل', salaryMin: 750000, salaryMax: 900000, shift: 'دوام كامل', employer: { name: 'شركة آفاق النقل', phone: '07811234567', address: 'المحاويل - الطريق العام - مجمع النقل' }, interviewLocation: 'المحاويل - مقابل مديرية النقل', requirements: ['إجازة سوق فئة ثالثة', 'خبرة 3 سنوات', 'عدم وجود تسجيل جنائي' ], gender: 'ذكر', imageUrl: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=800&q=80' },
        { code: 'HRC-1044', title: 'ممرضة/ممرض (مناوبة)', category: 'صحي', region: 'الكفل', salaryMin: 900000, salaryMax: 1200000, shift: 'نوبات', employer: { name: 'مستشفى الكفل الأهلي', phone: '07731234567', address: 'الكفل - قرب المستشفى القديم' }, interviewLocation: 'مستشفى الكفل الأهلي - الإدارة', requirements: ['شهادة تمريض معتمدة', 'خبرة سنة', 'الالتزام بالنوبات'], gender: 'لا فرق', imageUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&q=80' },
        { code: 'HRC-1045', title: 'مهندس مدني (تنفيذ)', category: 'هندسي', region: 'الحلة', salaryMin: 1500000, salaryMax: 2200000, shift: 'صباحي', employer: { name: 'مجموعة بابل للإنشاءات', phone: '07741234567', address: 'الحلة - حي الحسين - الشارع الرئيسي' }, interviewLocation: 'مقر الشركة - الحلة', requirements: ['شهادة هندسة مدنية', 'خبرة 4 سنوات في المشاريع', 'إجادة AutoCAD'], gender: 'لا فرق', imageUrl: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80' },
        { code: 'HRC-1046', title: 'باريستا / عامل كافيه', category: 'خدمات', region: 'الهاشمية', salaryMin: 500000, salaryMax: 650000, shift: 'مسائي', employer: { name: 'كافيه دجلة', phone: '07751234567', address: 'الهاشمية - الشارع التجاري' }, interviewLocation: 'كافيه دجلة', requirements: ['حسن المظهر والتعامل', 'خبرة مفضلة'], gender: 'لا فرق', imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&q=80' },
        { code: 'HRC-1047', title: 'أمين مخزن (إلكترونيات)', category: 'إداري', region: 'الحلة', salaryMin: 700000, salaryMax: 850000, shift: 'صباحي', employer: { name: 'شركة الرافدين للإلكترونيات', phone: '07761234567', address: 'الحلة - شارع 60 - مجمع التجارة' }, interviewLocation: 'شركة الرافدين - المكتب الرئيسي', requirements: ['إجادة إكسل', 'أمانة ودقة', 'خبرة مخازن'], gender: 'لا فرق', imageUrl: 'https://images.unsplash.com/photo-1553413077-190dd305871c?w=800&q=80' },
        { code: 'HRC-1048', title: 'طباخ خطوط إنتاج', category: 'خدمات', region: 'المسيب', salaryMin: 650000, salaryMax: 800000, shift: 'نوبات', employer: { name: 'مطابخ البابلية المركزية', phone: '07771234567', address: 'المسيب - المنطقة الصناعية' }, interviewLocation: 'مطابخ البابلية - القسم الإداري', requirements: ['خبرة مطاعم/مطابخ مركزية', 'صحة جيدة'], gender: 'ذكر', imageUrl: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80' },
        { code: 'HRC-1049', title: 'فني كهرباء صناعية', category: 'تقني', region: 'الإسكندرية', salaryMin: 800000, salaryMax: 1000000, shift: 'صباحي', employer: { name: 'معمل الإسكندرية للبلاستيك', phone: '07781234567', address: 'الإسكندرية - منطقة المعامل' }, interviewLocation: 'المعمل - مكتب الإدارة', requirements: ['خبرة لوحات كهربائية', 'شهادة مهنية'], gender: 'ذكر', imageUrl: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=800&q=80' }
      ],
      jobsExtras: {
        'HRC-1049': { status: 'closed' }        // الباقي تُستنتج حالاته من المحاولات المُزرَعة
      },
      applicants: [
        { serial: 'HRC-NO-000117', fullName: 'علي حسين محمد', phone: '07701112233', address: 'الحلة - حي الجامعة', dob: '1996-04-12', createdBy: 'staff' },
        { serial: 'HRC-NO-000118', fullName: 'زهراء عبد الكريم', phone: '07702223344', address: 'المحاويل - حي الحسين', dob: '1999-08-02', createdBy: 'staff2' },
        { serial: 'HRC-NO-000119', fullName: 'مصطفى جبار علي', phone: '07703334455', address: 'الكفل - حي الزهراء', dob: '1994-01-25', createdBy: 'staff' },
        { serial: 'HRC-NO-000120', fullName: 'حسين كاظم عبد الله', phone: '07704445566', address: 'الحلة - شارع 40', dob: '1997-11-30', createdBy: 'staff' }
      ],
      /* محاولات مرتبطة بالاستمارات التجريبية */
      attempts: [
        { serial: 'HRC-NO-000120', no: 1, jobCode: 'HRC-1042', slotStatus: 'rejected', note: 'رفض صاحب العمل — عدم توفر سكن قريب' },
        { serial: 'HRC-NO-000120', no: 2, jobCode: 'HRC-1044', slotStatus: 'reserved', note: 'بانتظار نتيجة المقابلة' },
        { serial: 'HRC-NO-000119', no: 1, jobCode: 'HRC-1045', slotStatus: 'reserved', note: 'مقابلة مجدولة' },
        { serial: 'HRC-NO-000118', no: 1, jobCode: 'HRC-1043', slotStatus: 'succeeded', note: 'تم التوظيف فعلياً' }
      ]
    };

/* تحقن البذرة في نافذة jsdom بعد تحميل config.js وقبل استعمال store.js */
export function applyDemoSeed(win) {
  if (!win || !win.BRC_CONFIG) throw new Error('BRC_CONFIG غير محمّل بعد');
  win.BRC_CONFIG.seed = JSON.parse(JSON.stringify(DEMO_SEED));
  return win.BRC_CONFIG.seed;
}
