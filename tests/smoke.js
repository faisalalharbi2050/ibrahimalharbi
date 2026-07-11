const { spawn } = require('child_process');
const { chromium } = require('playwright');

const port = 4317;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dev-server.js'], {
  cwd: require('path').resolve(__dirname, '..'),
  env: { ...process.env, PORT: String(port) },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('تعذر تشغيل خادم الاختبار');
}

(async () => {
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#mainContent', { state: 'visible' });
    const publicState = await page.evaluate(() => ({
      hasH1: !!document.querySelector('h1#pName'),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      adminEntryVisible: getComputedStyle(document.querySelector('.topbar')).display !== 'none',
    }));
    if (!publicState.hasH1 || publicState.overflow || publicState.adminEntryVisible) {
      throw new Error(`فشل فحص الواجهة العامة: ${JSON.stringify(publicState)}`);
    }

    const deletionMergeState = await page.evaluate(() => {
      const merged = mergeRemoteData(
        { books: [{ id: 'cached-book' }], adLinks: [{ id: 'cached-link' }], partners: [{ id: 'legacy-link' }] },
        { books: [], adLinks: [] }
      );
      return { books: merged.books, adLinks: merged.adLinks, hasPartners: Object.prototype.hasOwnProperty.call(merged, 'partners') };
    });
    if (deletionMergeState.books.length || deletionMergeState.adLinks.length || deletionMergeState.hasPartners) {
      throw new Error(`Deleted content was restored from cache: ${JSON.stringify(deletionMergeState)}`);
    }

    await page.goto(`${base}/admin/index.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#loginScreen').waitFor({ state: 'visible', timeout: 5000 });
    const adminDeletionMergeState = await page.evaluate(() => {
      const merged = mergeRemoteData(
        { books: [{ id: 'cached-book' }], adLinks: [{ id: 'cached-link' }], partners: [{ id: 'legacy-link' }] },
        { books: [], adLinks: [] }
      );
      return { books: merged.books, adLinks: merged.adLinks, hasPartners: Object.prototype.hasOwnProperty.call(merged, 'partners') };
    });
    if (adminDeletionMergeState.books.length || adminDeletionMergeState.adLinks.length || adminDeletionMergeState.hasPartners) {
      throw new Error(`Admin restored deleted content from cache: ${JSON.stringify(adminDeletionMergeState)}`);
    }

    const analyticsRangeState = await page.evaluate(async () => {
      document.querySelector('#dashboard').style.display = 'block';
      activatePanel('analytics');
      D = { social: [], books: [], adLinks: [], collab: { plans: [] }, sectionsOff: {} };
      const calls = [];
      const originalRpc = window.sb?.rpc;
      window.sb.rpc = async (_name, params) => {
        calls.push(params?.p_days ?? null);
        return { data: {
          current: { visits: params?.p_days || 1000, clicks: (params?.p_days || 1000) + 1, requests: 2 },
          previous: params?.p_days ? { visits: 1, clicks: 1, requests: 1 } : null,
          statuses: {}, series: [], currentLinkCounts: [], cumulativeLinkCounts: [], topLocations: [], recent: []
        }, error: null };
      };
      const select = document.querySelector('#aRange');
      for (const value of ['7', '30', '90', 'all']) {
        select.value = value;
        await renderAnalytics();
      }
      window.sb.rpc = originalRpc;
      return { calls, selected: select.value, html: document.querySelector('#statsGrid')?.innerHTML || '' };
    });
    if (JSON.stringify(analyticsRangeState.calls) !== JSON.stringify([7, 30, 90, null]) || analyticsRangeState.selected !== 'all' || !analyticsRangeState.html) {
      throw new Error(`Analytics range dropdown did not request the selected periods: ${JSON.stringify(analyticsRangeState)}`);
    }

    const analyticsQueuedRangeState = await page.evaluate(async () => {
      const calls = [];
      let releaseFirst;
      const first = new Promise((resolve) => { releaseFirst = resolve; });
      const originalRpc = window.sb?.rpc;
      window.sb.rpc = async (_name, params) => {
        calls.push(params?.p_days ?? null);
        if (calls.length === 1) await first;
        return { data: {
          current: { visits: params?.p_days || 1000, clicks: (params?.p_days || 1000) + 1, requests: 2 },
          previous: params?.p_days ? { visits: 1, clicks: 1, requests: 1 } : null,
          statuses: {}, series: [], currentLinkCounts: [], cumulativeLinkCounts: [], topLocations: [], recent: []
        }, error: null };
      };
      adminAnalyticsHasRendered = true;
      const select = document.querySelector('#aRange');
      select.value = '7';
      const inFlight = renderAnalytics();
      await new Promise((resolve) => setTimeout(resolve, 0));
      select.value = '30';
      await renderAnalytics();
      releaseFirst();
      await inFlight;
      await new Promise((resolve) => setTimeout(resolve, 20));
      window.sb.rpc = originalRpc;
      return { calls };
    });
    if (JSON.stringify(analyticsQueuedRangeState.calls) !== JSON.stringify([7, 30])) {
      throw new Error(`Queued analytics range selection was not applied immediately after the in-flight load: ${JSON.stringify(analyticsQueuedRangeState)}`);
    }
    await page.evaluate(() => { document.querySelector('#dashboard').style.display = 'none'; });
    if (!(await page.locator('#loginScreen').isVisible())) throw new Error('شاشة دخول الإدارة غير ظاهرة');
    if (await page.locator('#dashboard').isVisible()) throw new Error('لوحة الإدارة ظهرت دون جلسة موثقة');
    const notificationLayout = await page.evaluate(() => {
      document.querySelector('#dashboard').style.display = 'block';
      document.querySelector('#notifPanel').classList.add('open');
      const rect = document.querySelector('#notifPanel').getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: window.innerWidth };
    });
    if (notificationLayout.left < 0 || notificationLayout.right > notificationLayout.viewport) {
      throw new Error(`نافذة الإشعارات خارج الشاشة: ${JSON.stringify(notificationLayout)}`);
    }
    const unsavedNavigationState = await page.evaluate(async () => {
      document.querySelector('#dashboard').style.display = 'block';
      verifiedAdminSession = { user: { app_metadata: { platform_role: 'owner' } } };
      activatePanel('books');
      openBookForm();
      document.querySelector('#bTitle').value = 'عنوان غير محفوظ';
      let prompted = false;
      const nativeConfirm = window.platformConfirm;
      window.platformConfirm = async () => { prompted = true; return false; };
      await nav('analytics');
      window.platformConfirm = nativeConfirm;
      return {
        prompted,
        activePanel: document.querySelector('.panel.on')?.id || '',
        dirty: isBookFormDirty(),
      };
    });
    if (!unsavedNavigationState.prompted || unsavedNavigationState.activePanel !== 'panel-books' || !unsavedNavigationState.dirty) {
      throw new Error(`فشل منع الانتقال مع بيانات كتاب غير محفوظة: ${JSON.stringify(unsavedNavigationState)}`);
    }
    const whatsappState = await page.evaluate(() => {
      D.collab = { ...(D.collab || {}), requests: [{
        id: 'wa-test', requestNo: 'AB-123', name: 'محمد', phone: '0501234567',
        created_at: '2026-06-22T09:00:00.000Z', status: 'new', archived: false
      }] };
      renderRequests();
      openRequestWhatsApp('wa-test');
      document.querySelector('#whatsappAdAmount').value = '1500';
      toggleWhatsAppNotes();
      document.querySelector('#whatsappNotes').value = 'موعد النشر حسب الاتفاق';
      updateWhatsAppPreview();
      const message = document.querySelector('#whatsappMessagePreview').value;
      const notesVisible = !document.querySelector('#whatsappNotesField').hidden;
      let opened = '';
      const nativeOpen = window.open;
      window.open = (url) => { opened = String(url); };
      sendRequestWhatsApp();
      openRequestWhatsApp('wa-test');
      document.querySelector('#whatsappAdAmount').value = '';
      updateWhatsAppPreview();
      const blankAmountMessage = document.querySelector('#whatsappMessagePreview').value;
      let openedWithoutAmount = '';
      window.open = (url) => { openedWithoutAmount = String(url); };
      sendRequestWhatsApp();
      window.open = nativeOpen;
      return {
        hasAction: !!document.querySelector('.request-row-actions > .ico-whatsapp'),
        notesVisible,
        message,
        opened: decodeURIComponent(opened),
        blankAmountMessage,
        openedWithoutAmount: decodeURIComponent(openedWithoutAmount)
      };
    });
    if (!whatsappState.hasAction || !whatsappState.opened.includes('wa.me/966501234567') ||
        !whatsappState.message.includes('AB-123') || !whatsappState.message.includes('محمد') ||
        !whatsappState.message.includes('1500') || !whatsappState.message.includes('موعد النشر حسب الاتفاق') ||
        !whatsappState.notesVisible || !whatsappState.openedWithoutAmount.includes('wa.me/966501234567') ||
        !whatsappState.blankAmountMessage.includes('—')) {
      throw new Error(`فشل مسار إرسال واتساب: ${JSON.stringify(whatsappState)}`);
    }
    console.log('✓ نجح اختبار الواجهة العامة ودخول الإدارة وإرسال واتساب');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
