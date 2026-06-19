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

    await page.goto(`${base}/admin/index.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#loginScreen').waitFor({ state: 'visible', timeout: 5000 });
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
    console.log('✓ نجح اختبار الواجهة العامة ودخول الإدارة');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
