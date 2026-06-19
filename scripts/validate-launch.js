const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('site/index.html');
const admin = read('admin/index.html');
const schema = read('supabase/migrations/20260618000000_launch_hardening.sql');
const loginGuardSchema = read('supabase/migrations/20260619001000_admin_login_guard.sql');
const loginFunction = read('supabase/functions/admin-login/index.ts');

const checks = [
  ['الواجهة تسمح بالتكبير', !index.includes('user-scalable=no')],
  ['الواجهة تحتوي عنوان H1', /<h1[^>]*id="pName"/.test(index)],
  ['عنوان الصفحة مضبوط على صفحتي', /<title[^>]*>صفحتي<\/title>/.test(index)],
  ['إخفاء روابط الدعم لا يُلغى تلقائيًا', !index.includes('D.adLinks.some(p=>p.active!==false))D.sectionsOff.adLinks=false') && !admin.includes('D.adLinks.some(p=>p.active!==false))D.sectionsOff.adLinks=false')],
  ['روابط المعاينة تُفتح خارج الإطار', admin.includes('frame.onload=wirePreviewLinks') && admin.includes("window.open(href,'_blank'" )],
  ['صورة رابط الدعم تستخدم واجهة رفع الأغلفة', admin.includes('cover-btn-face ad-cover-btn-face') && admin.includes('onAdLinkImageFile(this)')],
  ['نموذج رابط الدعم يستخدم تخطيط الصورة والحقول الموحد', admin.includes('book-form-layout ad-link-form-layout') && admin.includes('book-form-fields')],
  ['زر رابط الدعم يظهر أسفل النصوص', index.includes('class="p-content"') && index.includes('<span class="p-cta">${cta}</span></div>')],
  ['نافذة طلب الإعلان متوافقة مع ارتفاع الجوال', index.includes('height:100dvh') && index.includes('env(safe-area-inset-top)') && index.includes('overscroll-behavior:contain')],
  ['بطاقة الإعلان تتضمن مسافة بين العنوان والزر', index.includes('.collab-title + .collab-entry-btn{margin-top:22px}')],
  ['لا توجد كتابة مباشرة للنقرات', !index.includes("sb.from('clicks').insert")],
  ['لا توجد كتابة مباشرة للجلسات النشطة', !index.includes("sb.from('active_sessions').upsert") || !index.includes('startActiveVisitorTracking();')],
  ['لا توجد كلمة مرور إدارة افتراضية', !admin.includes('DEFAULT_PW') && !admin.includes('admin123')],
  ['لا يعتمد الدخول على localStorage', !admin.includes("localStorage.setItem('admin_auth_persist'")],
  ['تحديث المحتوى محكوم بالأدوار', schema.includes('content staff can update site data')],
  ['تحليلات النقرات ليست عامة', schema.includes('drop policy if exists "public can read click analytics"')],
  ['وظيفة المحتوى العامة موجودة', fs.existsSync(path.join(root, 'supabase/functions/public-content/index.ts'))],
  ['وظيفة الأحداث العامة موجودة', fs.existsSync(path.join(root, 'supabase/functions/public-events/index.ts'))],
  ['دخول الإدارة يمر عبر البوابة المحمية', admin.includes("sb.functions.invoke('admin-login'") && !admin.includes('auth.signInWithPassword')],
  ['القفل يفعّل بعد ثلاث محاولات', loginFunction.includes('p_max_attempts: 3') && loginGuardSchema.includes('p_max_attempts integer default 3')],
  ['الجلسة المباشرة لا تمنح صلاحيات الإدارة', loginGuardSchema.includes('and public.has_active_admin_login()') && admin.includes("sb.rpc('validate_admin_login')")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
