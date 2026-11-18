# إعدادات المصادقة — القيم المسحوبة من الإنتاج

> هذه **ليست** أسراراً، لكنها إعدادات يجب إعادتها كما هي وإلا اختلف سلوك الدخول.

| الإعداد | القيمة في الإنتاج | ماذا تفعل |
|---|---|---|
| `site_url` | `http://localhost:3000` | ⚠️ **لم تُضبط** — اضبطها على نطاقك |
| `uri_allow_list` | *(فارغ)* | أضف نطاقك |
| `jwt_exp` | 3600 | ساعة واحدة — مناسب |
| `disable_signup` | `false` | التسجيل مفتوح (الموظفون يُنشَؤون من اللوحة) |
| `external_email_enabled` | `true` | بريد + كلمة مرور |
| `external_phone_enabled` | `false` | لا SMS |
| `mailer_autoconfirm` | `false` | يلزم تأكيد البريد |
| `mailer_otp_length` | 8 | |
| `password_min_length` | 6 | |
| `security_captcha_enabled` | `false` | |
| `refresh_token_rotation_enabled` | `true` | |
| `rate_limit_email_sent` | 2/ساعة | ⚠️ منخفض — عند إنشاء ٣ حسابات قد تصطدم |
| `smtp_host` | `null` | يستخدم بريد Supabase المدمج |
| مزوّدو OAuth | لا أحد | |

## بعد النقل — ما يجب فعله

1. `Authentication → URL Configuration` → **Site URL** = نطاقك الجديد.
2. **Redirect URLs** → أضف `https://<نطاقك>/**`.
3. إن أردت نفس كلمات المرور: استورد `auth.users` من النسخة (انظر `RESTORE-GUIDE-AR.md`). الهاشات bcrypt وتُقبل كما هي.
4. لو تعذّر استيراد `auth.users`: أنشئ الموظفين الثلاثة من `الإعدادات → إضافة موظف`، وكلمات المرور تُختار من جديد.
