import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const screenshotDir = 'C:/Users/tanlo/AppData/Local/Temp/plane-test';
try { await import('fs').then(fs => fs.mkdirSync(screenshotDir, { recursive: true })); } catch {}

async function screenshot(name) {
  const p = `${screenshotDir}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  console.log(`Screenshot: ${p}`);
}

console.log('Navigating to http://localhost:3000...');
await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
await screenshot('01-home');
console.log('URL after load:', page.url());
console.log('Title:', await page.title());

// Check if we need to log in
if (page.url().includes('sign-in') || page.url().includes('login') || page.url() === 'http://localhost:3000/') {
  console.log('Need to log in, looking for login form...');
  await screenshot('02-login-page');

  // Try to find email/password fields
  const emailField = page.locator('input[type="email"], input[name="email"]').first();
  const passwordField = page.locator('input[type="password"]').first();

  if (await emailField.isVisible()) {
    await emailField.fill('admin@example.com');
    await passwordField.fill('admin123');
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ timeout: 10000 }).catch(() => {});
    await screenshot('03-after-login');
    console.log('URL after login:', page.url());
  }
}

// Extract workspace slug from URL
const url = page.url();
console.log('Current URL:', url);
const match = url.match(/localhost:3000\/([^/]+)/);
const workspaceSlug = match ? match[1] : null;
console.log('Workspace slug:', workspaceSlug);

if (workspaceSlug && !['sign-in', 'login', 'onboarding', 'create-workspace'].includes(workspaceSlug)) {
  const importsUrl = `http://localhost:3000/${workspaceSlug}/settings/imports`;
  console.log(`Navigating to imports page: ${importsUrl}`);
  await page.goto(importsUrl, { waitUntil: 'networkidle', timeout: 15000 });
  await screenshot('04-imports-page');
  console.log('Imports page URL:', page.url());
  console.log('Imports page title:', await page.title());

  // Check for 404
  const bodyText = await page.textContent('body');
  if (bodyText.includes('cannot be found') || bodyText.includes('404')) {
    console.log('ERROR: Got 404 page!');
    console.log('Page text:', bodyText.substring(0, 500));
  } else {
    console.log('Page loaded successfully');

    // Check for Import button
    const importBtn = page.locator('button:has-text("Import"), button[type="submit"]');
    const count = await importBtn.count();
    console.log(`Import buttons found: ${count}`);

    if (count > 0) {
      console.log('PASS: Import button is visible');
      await importBtn.first().scrollIntoViewIfNeeded();
      await screenshot('05-import-button');
    } else {
      console.log('FAIL: Import button not found');
      console.log('Page content:', bodyText.substring(0, 1000));
    }
  }

  // Check console errors
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('Console error:', msg.text());
  });
} else {
  console.log('Could not determine workspace slug, current URL:', url);
  await screenshot('05-unknown-state');
}

await browser.close();
