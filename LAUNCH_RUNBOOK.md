# دليل تجهيز الإطلاق

هذه الخطوات إلزامية قبل توجيه الجمهور إلى الموقع.

## 1. قاعدة البيانات

نفّذ migration الإنتاج الموجود في `supabase/migrations/20260618000000_launch_hardening.sql`. الملف قابل لإعادة التشغيل ويزيل سياسات الكتابة العامة القديمة.

حوّل حساب المالك الوحيد إلى دور `owner`، مع استبدال البريد:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) ||
  '{"role":"admin","platform_role":"owner","sections":[]}'::jsonb
where email = 'owner@example.com';
```

لا تمنح دور `owner` لأكثر من حساب تشغيلي واحد. بقية الحسابات تُنشأ من قسم الصلاحيات في اللوحة.

## 2. أسرار الوظائف

عيّن أسرار وظائف Supabase من بيئة آمنة، ولا تضع `service_role` في ملفات الواجهة:

```powershell
supabase secrets set PUBLIC_ALLOWED_ORIGINS=https://your-domain.example
supabase secrets set PUBLIC_RATE_LIMIT_SALT=ضع-قيمة-عشوائية-طويلة-هنا
```

متغيرات `SUPABASE_URL` و`SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` توفرها Supabase للوظائف المستضافة.

## 3. نشر الوظائف

```powershell
supabase functions deploy public-content
supabase functions deploy public-events
supabase functions deploy create-admin-user
supabase functions deploy manage-admin-user
```

## 4. الاستضافة والحماية

- انشر الملفات عبر Vercel، وتحقق من تفعيل ترويسات الحماية المعرفة في `vercel.json` و`admin/vercel.json`.
- اربط النطاق بـ HTTPS فقط.
- اجعل بوابة الإدارة المستقلة محميًا أيضًا بقواعد WAF وrate limiting.
- لا تعِد إظهار رابط الإدارة في الصفحة العامة.

## 5. التحقق

```powershell
npm run check
```

بعد النشر اختبر: تحميل الصفحة من شبكة جوال، تسجيل دخول كل دور، إنشاء طلب واحد، تسجيل نقرة، تعطيل حساب موظف، واسترجاع نسخة احتياطية تجريبية.

## 6. قبل الحملة

- فعّل MFA للحسابات الثلاثة من إعدادات Supabase Auth.
- فعّل تنبيهات الأخطاء واستهلاك قاعدة البيانات ووظائف Edge.
- نفّذ اختبار تحميل تدريجي على نسخة staging، ثم ابدأ بنسبة صغيرة من الجمهور.
- راجع نص الخصوصية ومدة الاحتفاظ بطلبات العملاء مع المستشار المختص.
