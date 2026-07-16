const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('site/index.html');
const admin = read('admin/index.html');
const schema = read('supabase/migrations/20260618000000_launch_hardening.sql');
const loginGuardSchema = read('supabase/migrations/20260619001000_admin_login_guard.sql');
const loginFunction = read('supabase/functions/admin-login/index.ts');
const publicEventsFunction = read('supabase/functions/public-events/index.ts');
const publicContentFunction = read('supabase/functions/public-content/index.ts');
const rateLimitSchema = read('supabase/migrations/20260623000000_rolling_public_rate_limits.sql');
const translateFunction = read('supabase/functions/admin-translate/index.ts');
const adminMediaFunction = read('supabase/functions/admin-media/index.ts');

const checks = [
  ['No mojibake Arabic text in shipped HTML', !/(ط·ظ|ظ„ظ|ط§ظ|طھظ|Ø|Ù)/.test(admin + index)],
  ['Admin inline JavaScript parses successfully', (() => {
    try {
      [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
        .map((match) => match[1])
        .filter((code) => code.trim())
        .forEach((code, index) => new vm.Script(code, { filename: `admin-inline-${index}.js` }));
      return true;
    } catch {
      return false;
    }
  })()],
  ['Admin accepts empty remote arrays as deletions', !admin.includes("if(Array.isArray(local[key])&&local[key].length") && admin.includes("hasOwnProperty.call(remote,'adLinks'))delete merged.partners")],
  ['Admin waits for deletion persistence', admin.includes("const saved=await save();") && admin.includes("if(!saved){await loadAll();return;}")],
  ['Admin rolls back failed book image/content saves', (admin.match(/const beforeSave=JSON.stringify\(D\);/g)||[]).length >= 2 && admin.includes('D=JSON.parse(beforeSave);') && admin.includes('renderBooksAdmin();')],
  ['Admin rolls back failed ad link image/content saves', admin.includes('D=JSON.parse(beforeSave);') && admin.includes('renderAdLinks();')],
  ['Admin purges stale corrupted browser cache', admin.includes('hasSuspiciousReplacementChars(D)') && admin.includes("localStorage.removeItem('influencer_data')")],
  ['Admin treats remote site data as authoritative', admin.includes('const merged={...remote};') && !admin.includes('merged.collab={...(local.collab||{}),...(remote.collab||{})}')],
  ['Admin exposes save failure detail', admin.includes('shortDetail') && admin.includes('Content save failed')],
  ['Deleted public arrays remain deleted', !index.includes("if(Array.isArray(local[key])&&local[key].length") && index.includes("hasOwnProperty.call(remote,'adLinks'))delete merged.partners")],
  ['Public content bypasses stale caches', (index.match(/cache:'no-store'/g)||[]).length >= 2 && publicContentFunction.includes('no-store, max-age=0')],
  ['الواجهة تسمح بالتكبير', !index.includes('user-scalable=no')],
  ['الواجهة تحتوي عنوان H1', /<h1[^>]*id="pName"/.test(index)],
  ['عنوان الصفحة مضبوط على صفحتي', /<title[^>]*>صفحتي<\/title>/.test(index)],
  ['إخفاء روابط الدعم لا يُلغى تلقائيًا', !index.includes('D.adLinks.some(p=>p.active!==false))D.sectionsOff.adLinks=false') && !admin.includes('D.adLinks.some(p=>p.active!==false))D.sectionsOff.adLinks=false')],
  ['روابط المعاينة تُفتح خارج الإطار', admin.includes('frame.onload=wirePreviewLinks') && admin.includes("window.open(href,'_blank'" )],
  ['الهيدر يعرض التاريخ الهجري ثم الميلادي', /hijri\+'[^']+'\+greg/.test(admin)],
  ['بطاقات الكتب والإعلانات تعرض الحالة دون نص زائد', !admin.includes('إظهار / إخفاء') && admin.includes('book-actions-meta') && admin.includes('active!==false')],
  ['تغيير حالة الكتب والإعلانات يتطلب تأكيدًا', admin.includes("if(sec==='books')") && admin.includes("if(sec==='adLinks')") && admin.includes('platformConfirm')],
  ['زر واتساب مباشر في عمود الإجراءات', admin.includes('request-row-actions') && admin.includes('ico-whatsapp') && !admin.includes('whatsapp-action')],
  ['إرسال طلب تواصل الأعمال عبر واتساب متاح', admin.includes('openRequestWhatsApp') && admin.includes('https://wa.me/') && admin.includes('whatsappAdAmount')],
  ['رسالة واتساب تتضمن بيانات الطلب وقيمة الطلب والملاحظات', admin.includes('buildWhatsAppMessage') && admin.includes('amount||') && admin.includes('whatsappNotes')],
  ['صورة رابط الدعم تستخدم واجهة رفع الأغلفة', admin.includes('cover-btn-face ad-cover-btn-face') && admin.includes('onAdLinkImageFile(this)')],
  ['نموذج رابط الدعم يستخدم تخطيط الصورة والحقول الموحد', admin.includes('book-form-layout ad-link-form-layout') && admin.includes('book-form-fields')],
  ['زر رابط الدعم يظهر أسفل النصوص', index.includes('class="p-content"') && index.includes('<span class="p-cta">${cta}</span></div>')],
  ['نافذة طلب تواصل الأعمال متوافقة مع ارتفاع الجوال', index.includes('height:100dvh') && index.includes('env(safe-area-inset-top)') && index.includes('overscroll-behavior:contain')],
  ['بطاقة تواصل الأعمال تتضمن مسافة بين العنوان والزر', index.includes('.collab-title + .collab-entry-btn{margin-top:22px}')],
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
  ['معرف الطلب يولد في الخادم', publicEventsFunction.includes('id: crypto.randomUUID()') && !publicEventsFunction.includes('id: clean(payload.id')],
  ['حد الطلب نصف ساعة للشبكة و12 ساعة للجوال', publicEventsFunction.includes('30 * 60') && publicEventsFunction.includes('12 * 60 * 60') && rateLimitSchema.includes('consume_public_rate_limit')],
  ['رقم الجوال لا يخزن في جدول الحدود', publicEventsFunction.includes('phoneHash') && rateLimitSchema.includes('salted hashes only')],
  ['النقرات تتحقق من المعرفات المنشورة', publicEventsFunction.includes('collectTrackableIds') && publicEventsFunction.includes('invalid_click')],
  ['لوحة الإدارة ترمز معرفات الطلبات', admin.includes('jsString(r.id)') && !admin.includes("openRequestDetails('${r.id}')")],
  ['الترجمة تمر عبر وظيفة خادمة محمية', admin.includes("functions.invoke('admin-translate'") && translateFunction.includes('ANTHROPIC_API_KEY') && !admin.includes("fetch('https://api.anthropic.com")],
  ['الواجهة العامة لا تفتح اتصال Realtime دائم', !index.includes("sb.channel('public-site-data')")],
  ['الصور تنقل إلى التخزين العام', admin.includes('migrateEmbeddedImages') && rateLimitSchema.includes("public-media")],
  ['رفع الصور يمر عبر وظيفة إدارة محمية', admin.includes("functions.invoke('admin-media'") && !admin.includes("storage.from('public-media').upload") && adminMediaFunction.includes('admin_login_sessions') && adminMediaFunction.includes('SUPABASE_SERVICE_ROLE_KEY')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
