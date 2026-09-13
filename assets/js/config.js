/* ===========================================================================
 *  BRC — إعدادات النظام (شركة بابل للتوظيف)
 *  ملف واحد للتحكم بكل الثوابت: بيانات الشركة، الحدود الزمنية، المستخدمين،
 *  المناطق، مبالغ الاستمارة، وبيانات العرض التجريبي.
 * =========================================================================== */
(function (root) {
  'use strict';

  var CONFIG = {
    company: {
      nameAr: 'شركة بابل للتوظيف',
      nameEn: 'Babylonian Recruitment Company',
      legalName: 'شركة بابل للتوظيف (شركة الهدف)',
      slogan: 'نوفّر الأيادي العاملة الفنية والتخصصية في بابل والفرات الأوسط',
      phones: ['07760058007', '07863148999'],
      address: 'حلة - شارع 60 - قرب مستشفى الكفل - مجاور الجيلاوي',
      addressShort: 'الحلة – بابل، العراق',
      email: 'info@brc-babil.com',
      hours: 'السبت – الخميس: 9:00 صباحاً – 6:00 مساءً',
      license: 'إجازة عمل رسمية / وزارة العمل والشؤون الاجتماعية',
      branch: 'بابل – الحلة'
    },

    /* --------------------------------------------------------------
     * قواعد العمل الأساسية
     * -------------------------------------------------------------- */
    rules: {
      attemptLimit: 5,        // عدد المحاولات لكل استمارة
      validityDays: 30,       // صلاحية الاستمارة (يوم)
      holdHours: 24,          // مدة التعليق المؤقت للوظيفة (ساعة)
      formFee: 10000,         // رسم إصدار الاستمارة (دينار عراقي)
      feeCurrency: 'IQD',
      autoReleaseEnabled: true
    },

    /* --------------------------------------------------------------
     * رابط التحقق المطبوع داخل الكيو آر كود
     * -------------------------------------------------------------- */
    verifyBase: 'https://brc-babil.com/verify',   // الرابط الرسمي الاحتياطي (يُطبع في الاستمارة)
    autoVerifyBase: true,                          // يتبع نطاق النشر تلقائياً (Render/النطاق الرسمي)
    verifyLocal: 'verify.html',                    // صفحة التحقق المحلية (للعمل بلا إنترنت)
    verifySecret: 'BRC-BABIL-2026-TOKEN',          // مفتاح توليد بصمة التحقق

    /* --------------------------------------------------------------
     * المستخدمون (نظام تجريبي يعمل بالكامل داخل المتصفح)
     * في النسخة السحابية تُدار الحسابات والصلاحيات عبر Supabase Auth + RLS
     * -------------------------------------------------------------- */
    users: [
      { username: 'admin', password: 'admin123', name: 'المدير العام', role: 'admin', title: 'الإدارة العامة' },
      { username: 'staff', password: 'staff123', name: 'أحمد الموسوي', role: 'staff', title: 'موظف توظيف' },
      { username: 'staff2', password: 'staff123', name: 'زينب الحسيني', role: 'staff', title: 'موظفة توظيف' }
    ],

    /* مناطق عمل الشركة */
    regions: [
      'الحلة', 'المحاويل', 'الكفل', 'الهاشمية', 'المسيب', 'الحمزة الشرقي',
      'الصويرة', 'الوردية', 'أبو غرق', 'الإسكندرية', 'النيل', 'سدة الهندية', 'بغداد'
    ],

    shifts: ['صباحي', 'مسائي', 'ليلي', 'صباحي + مسائي', 'دوام كامل', 'نوبات'],

    jobCategories: ['صناعي', 'خدمات', 'صحي', 'هندسي', 'إداري', 'تجاري', 'زراعي', 'تقني'],

    /* حالات الوظيفة */
    jobStatus: {
      available: { ar: 'متاحة', cls: 'ok' },
      reserved: { ar: 'محجوزة مؤقتاً', cls: 'warn' },
      closed: { ar: 'مغلقة', cls: 'muted' }
    },

    /* حالات مهلة الاستمارة / المحاولة */
    slotStatus: {
      empty: { ar: '—', cls: 'muted' },
      selected: { ar: 'مُختارة', cls: 'info' },
      reserved: { ar: 'بانتظار المقابلة', cls: 'warn' },
      succeeded: { ar: 'تم التوظيف', cls: 'ok' },
      rejected: { ar: 'مرفوض / لم ينجح', cls: 'danger' },
      expired: { ar: 'انتهت المهلة', cls: 'danger' }
    },

    /* حالات الاستمارة */
    formStatus: {
      active: { ar: 'سارية', cls: 'ok' },
      expired: { ar: 'منتهية الصلاحية', cls: 'danger' },
      exhausted: { ar: 'استُهلكت المحاولات', cls: 'warn' },
      completed: { ar: 'مكتملة', cls: 'info' }
    },

    /* --------------------------------------------------------------
     * بيانات عرض تجريبية (تُزرع مرة واحدة عند أول تشغيل)
     * -------------------------------------------------------------- */
    seed: {
      jobs: [
        { code: 'BRC-1042', title: 'عامل مخزن', category: 'صناعي', region: 'الحلة', salaryMin: 600000, salaryMax: 750000, shift: 'صباحي', employer: { name: 'مخازن الفرات للتبريد', phone: '07701234567', address: 'الحلة - المنطقة الصناعية - شارع المعمل' }, interviewLocation: 'مقر الشركة - الحلة', requirements: ['لياقة بدنية جيدة', 'خبرة سنة على الأقل', 'شهادة جنسية + سكن'], gender: 'لا فرق' },
        { code: 'BRC-1043', title: 'سائق حمل (فئة ثالثة)', category: 'خدمات', region: 'المحاويل', salaryMin: 750000, salaryMax: 900000, shift: 'دوام كامل', employer: { name: 'شركة آفاق النقل', phone: '07811234567', address: 'المحاويل - الطريق العام - مجمع النقل' }, interviewLocation: 'المحاويل - مقابل مديرية النقل', requirements: ['إجازة سوق فئة ثالثة', 'خبرة 3 سنوات', 'عدم وجود تسجيل جنائي' ], gender: 'ذكر' },
        { code: 'BRC-1044', title: 'ممرضة/ممرض (مناوبة)', category: 'صحي', region: 'الكفل', salaryMin: 900000, salaryMax: 1200000, shift: 'نوبات', employer: { name: 'مستشفى الكفل الأهلي', phone: '07731234567', address: 'الكفل - قرب المستشفى القديم' }, interviewLocation: 'مستشفى الكفل الأهلي - الإدارة', requirements: ['شهادة تمريض معتمدة', 'خبرة سنة', 'الالتزام بالنوبات'], gender: 'لا فرق' },
        { code: 'BRC-1045', title: 'مهندس مدني (تنفيذ)', category: 'هندسي', region: 'الحلة', salaryMin: 1500000, salaryMax: 2200000, shift: 'صباحي', employer: { name: 'مجموعة بابل للإنشاءات', phone: '07741234567', address: 'الحلة - حي الحسين - الشارع الرئيسي' }, interviewLocation: 'مقر الشركة - الحلة', requirements: ['شهادة هندسة مدنية', 'خبرة 4 سنوات في المشاريع', 'إجادة AutoCAD'], gender: 'لا فرق' },
        { code: 'BRC-1046', title: 'باريستا / عامل كافيه', category: 'خدمات', region: 'الهاشمية', salaryMin: 500000, salaryMax: 650000, shift: 'مسائي', employer: { name: 'كافيه دجلة', phone: '07751234567', address: 'الهاشمية - الشارع التجاري' }, interviewLocation: 'كافيه دجلة', requirements: ['حسن المظهر والتعامل', 'خبرة مفضلة'], gender: 'لا فرق' },
        { code: 'BRC-1047', title: 'أمين مخزن (إلكترونيات)', category: 'إداري', region: 'الحلة', salaryMin: 700000, salaryMax: 850000, shift: 'صباحي', employer: { name: 'شركة الرافدين للإلكترونيات', phone: '07761234567', address: 'الحلة - شارع 60 - مجمع التجارة' }, interviewLocation: 'شركة الرافدين - المكتب الرئيسي', requirements: ['إجادة إكسل', 'أمانة ودقة', 'خبرة مخازن'], gender: 'لا فرق' },
        { code: 'BRC-1048', title: 'طباخ خطوط إنتاج', category: 'خدمات', region: 'المسيب', salaryMin: 650000, salaryMax: 800000, shift: 'نوبات', employer: { name: 'مطابخ البابلية المركزية', phone: '07771234567', address: 'المسيب - المنطقة الصناعية' }, interviewLocation: 'مطابخ البابلية - القسم الإداري', requirements: ['خبرة مطاعم/مطابخ مركزية', 'صحة جيدة'], gender: 'ذكر' },
        { code: 'BRC-1049', title: 'فني كهرباء صناعية', category: 'تقني', region: 'الإسكندرية', salaryMin: 800000, salaryMax: 1000000, shift: 'صباحي', employer: { name: 'معمل الإسكندرية للبلاستيك', phone: '07781234567', address: 'الإسكندرية - منطقة المعامل' }, interviewLocation: 'المعمل - مكتب الإدارة', requirements: ['خبرة لوحات كهربائية', 'شهادة مهنية'], gender: 'ذكر' }
      ],
      jobsExtras: {
        'BRC-1049': { status: 'closed' }        // الباقي تُستنتج حالاته من المحاولات المُزرَعة
      },
      applicants: [
        { serial: 'BRC-NO-000117', fullName: 'علي حسين محمد', phone: '07701112233', address: 'الحلة - حي الجامعة', dob: '1996-04-12', createdBy: 'staff' },
        { serial: 'BRC-NO-000118', fullName: 'زهراء عبد الكريم', phone: '07702223344', address: 'المحاويل - حي الحسين', dob: '1999-08-02', createdBy: 'staff2' },
        { serial: 'BRC-NO-000119', fullName: 'مصطفى جبار علي', phone: '07703334455', address: 'الكفل - حي الزهراء', dob: '1994-01-25', createdBy: 'staff' },
        { serial: 'BRC-NO-000120', fullName: 'حسين كاظم عبد الله', phone: '07704445566', address: 'الحلة - شارع 40', dob: '1997-11-30', createdBy: 'staff' }
      ],
      /* محاولات مرتبطة بالاستمارات التجريبية */
      attempts: [
        { serial: 'BRC-NO-000120', no: 1, jobCode: 'BRC-1042', slotStatus: 'rejected', note: 'رفض صاحب العمل — عدم توفر سكن قريب' },
        { serial: 'BRC-NO-000120', no: 2, jobCode: 'BRC-1044', slotStatus: 'reserved', note: 'بانتظار نتيجة المقابلة' },
        { serial: 'BRC-NO-000119', no: 1, jobCode: 'BRC-1045', slotStatus: 'reserved', note: 'مقابلة مجدولة' },
        { serial: 'BRC-NO-000118', no: 1, jobCode: 'BRC-1043', slotStatus: 'succeeded', note: 'تم التوظيف فعلياً' }
      ]
    }
  };

  root.BRC_CONFIG = CONFIG;
  if (typeof module === 'object' && module.exports) module.exports = CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
