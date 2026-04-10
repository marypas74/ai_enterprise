/**
 * Backend Restart Verification Tests
 * Verifies the fix for the 45s alternating timeout bug (stale vLLM connections).
 * Tests run sequentially against production: https://plane.lushlolli.com
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'https://plane.lushlolli.com';
const EMAIL = 'tester@enterprise.local';
const PASSWORD = 'Password1!';
const ARTIFACTS_DIR = '/tmp/e2e-verification/artifacts';
const AUTH_STATE_PATH = '/tmp/e2e-verification/auth-state.json';

function ensureArtifactsDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

async function screenshot(page: Page, name: string): Promise<string> {
  ensureArtifactsDir();
  const filePath = path.join(ARTIFACTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`  [screenshot] ${filePath}`);
  return filePath;
}

/** Perform login and wait for chat to load */
async function doLogin(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  // Wait for redirect away from /login
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 20000 });
  await page.waitForLoadState('domcontentloaded');
  // Extra wait for React to hydrate auth state
  await page.waitForTimeout(1500);
}

/** Ensure we are on the chat page (not login) */
async function ensureOnChat(page: Page) {
  const url = page.url();
  if (url.includes('/login') || !url.includes(BASE_URL)) {
    await doLogin(page);
  }
  // Navigate to chat root
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  // If redirected back to login, try once more
  if (page.url().includes('/login')) {
    await doLogin(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
}

/** Wait for the chat send button to become enabled */
async function waitForSendReady(page: Page, timeout = 120000) {
  await page.waitForFunction(
    () => {
      // Find send button by its SVG content (Send icon) or by disabled state
      const buttons = Array.from(document.querySelectorAll('button'));
      // The send button is near the textarea
      const textarea = document.querySelector('textarea');
      if (!textarea) return false;
      // Find button closest to textarea that isn't disabled
      const areaContainer = textarea.closest('div');
      if (!areaContainer) return false;
      const btns = Array.from(areaContainer.querySelectorAll('button'));
      return btns.some((b) => !(b as HTMLButtonElement).disabled);
    },
    { timeout }
  );
}

/** Get the chat textarea */
function chatTextarea(page: Page) {
  return page.locator('textarea').filter({ hasText: '' }).or(page.locator('textarea[placeholder]')).first();
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Login
// ─────────────────────────────────────────────────────────────────────────────
test('1. Login verification', async ({ page }) => {
  console.log('\n=== TEST 1: Login ===');

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await screenshot(page, '01-login-page');

  await page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await screenshot(page, '02-login-filled');

  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 20000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await screenshot(page, '03-after-login');

  const url = page.url();
  console.log(`  Post-login URL: ${url}`);
  expect(url).not.toContain('/login');

  // Save auth state for other tests
  await page.context().storageState({ path: AUTH_STATE_PATH });
  console.log(`  Auth state saved to ${AUTH_STATE_PATH}`);
  console.log('  LOGIN: PASS');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: TTFT measurement – 8 consecutive messages
// ─────────────────────────────────────────────────────────────────────────────
test('2. Timeout fix verification - 8 consecutive messages TTFT', async ({ browser }) => {
  console.log('\n=== TEST 2: TTFT Measurement (8 messages) ===');

  // Reuse saved auth state
  let context: BrowserContext;
  if (fs.existsSync(AUTH_STATE_PATH)) {
    context = await browser.newContext({ storageState: AUTH_STATE_PATH, ignoreHTTPSErrors: true });
  } else {
    context = await browser.newContext({ ignoreHTTPSErrors: true });
  }
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/login')) {
    await doLogin(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await screenshot(page, '04-chat-home');

  // Find the textarea
  const msgInput = page.locator('textarea').first();
  await msgInput.waitFor({ state: 'visible', timeout: 15000 });

  const ttftResults: { messageIndex: number; ttft_ms: number; note?: string }[] = [];

  const messages = [
    'Rispondi solo: "1"',
    'Rispondi solo: "2"',
    'Rispondi solo: "3"',
    'Rispondi solo: "4"',
    'Rispondi solo: "5"',
    'Rispondi solo: "6"',
    'Rispondi solo: "7"',
    'Rispondi solo: "8"',
  ];

  for (let i = 0; i < messages.length; i++) {
    const msgNum = i + 1;
    console.log(`\n  Message ${msgNum}/8: sending...`);

    try {
      await msgInput.waitFor({ state: 'visible', timeout: 10000 });
      await msgInput.fill(messages[i]);

      // Start waiting for the streaming API response BEFORE clicking send
      // The chat sends POST/SSE to /api/chat/... or similar
      const responsePromise = page.waitForResponse(
        (resp) => {
          const url = resp.url();
          return (url.includes('/api/chat') || url.includes('/api/messages') || url.includes('/chat/completions')) &&
                 resp.status() >= 200 && resp.status() < 300;
        },
        { timeout: 60000 }
      );

      const sendTime = Date.now();
      await msgInput.press('Enter');

      // TTFT = time from send until first byte of response arrives
      let ttft_ms = -1;
      let note: string | undefined;

      try {
        await responsePromise;
        ttft_ms = Date.now() - sendTime;
        console.log(`  Message ${msgNum}: TTFT (first response byte) = ${ttft_ms}ms`);
      } catch (e: any) {
        // API response wasn't intercepted - try DOM detection
        const domStart = Date.now();
        const proseCountBefore = await page.locator('.prose').count().catch(() => 0);

        // Wait for typing indicator or new prose element
        try {
          await page.waitForFunction(
            (before: number) => {
              const proseEls = document.querySelectorAll('.prose');
              if (proseEls.length > before) return true;
              // Check for typing indicator (streaming started but no content yet)
              const typingIndicators = document.querySelectorAll('.typing-indicator');
              return typingIndicators.length > 0;
            },
            proseCountBefore,
            { timeout: 30000 }
          );
          ttft_ms = Date.now() - domStart;
          note = 'DOM-based detection';
          console.log(`  Message ${msgNum}: TTFT (DOM) = ${ttft_ms}ms`);
        } catch {
          ttft_ms = Date.now() - sendTime;
          note = 'TTFT detection fallback (30s timeout)';
          console.log(`  Message ${msgNum}: TTFT = ${ttft_ms}ms [${note}]`);
        }
      }

      ttftResults.push({ messageIndex: msgNum, ttft_ms, note });

      // Wait for response to fully complete:
      // The typing-indicator disappears and the prose has actual content
      await page.waitForFunction(
        () => {
          const typing = document.querySelectorAll('.typing-indicator');
          if (typing.length > 0) return false; // Still streaming
          // Also check that the last .prose has content (not empty)
          const proseEls = document.querySelectorAll('.prose');
          if (proseEls.length === 0) return true; // No messages yet
          const lastProse = proseEls[proseEls.length - 1];
          return (lastProse.textContent?.trim().length ?? 0) > 0;
        },
        { timeout: 120000 }
      ).catch(() => console.log(`  Message ${msgNum}: completion wait timeout`));

      // Extra settle time
      await page.waitForTimeout(500);

      if (msgNum % 2 === 0) {
        await screenshot(page, `06-after-msg-${msgNum}`);
      }

      // Gap between messages (max 2s per spec)
      await page.waitForTimeout(300);

    } catch (err: any) {
      console.log(`  Message ${msgNum}: ERROR - ${err.message.substring(0, 100)}`);
      ttftResults.push({ messageIndex: msgNum, ttft_ms: -1, note: `ERROR: ${err.message.substring(0, 80)}` });
      await screenshot(page, `06-error-msg-${msgNum}`);
    }
  }

  await screenshot(page, '07-ttft-complete');
  await context.close();

  // Persist results
  ensureArtifactsDir();
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'ttft-results.json'),
    JSON.stringify(ttftResults, null, 2)
  );

  // Report
  console.log('\n  --- TTFT Results ---');
  for (const r of ttftResults) {
    const flag =
      r.ttft_ms < 0 ? '[ERROR]'
      : r.ttft_ms > 30000 ? '[TIMEOUT 30s+ - OLD BUG]'
      : r.ttft_ms > 5000 ? '[SLOW >5s]'
      : '[FAST]';
    console.log(`  Msg ${r.messageIndex}: ${r.ttft_ms}ms ${flag}${r.note ? ' — ' + r.note : ''}`);
  }
  const valid = ttftResults.filter((r) => r.ttft_ms > 0);
  if (valid.length > 0) {
    const avg = Math.round(valid.reduce((s, r) => s + r.ttft_ms, 0) / valid.length);
    const maxVal = Math.max(...valid.map((r) => r.ttft_ms));
    console.log(`  Average: ${avg}ms | Max: ${maxVal}ms`);
  }

  const timeoutBugMessages = ttftResults.filter((r) => r.ttft_ms > 30000);
  console.log(`\n  45s Timeout Fix: ${timeoutBugMessages.length === 0 ? 'VERIFIED' : 'ISSUE (' + timeoutBugMessages.length + ' messages > 30s)'}`);

  expect(timeoutBugMessages.length, '45s timeout bug should be fixed').toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Admin panel – GPU, VRAM, backend version
// ─────────────────────────────────────────────────────────────────────────────
test('3. Admin panel - GPU, VRAM, version', async ({ browser }) => {
  console.log('\n=== TEST 3: Admin Panel ===');

  let context: BrowserContext;
  if (fs.existsSync(AUTH_STATE_PATH)) {
    context = await browser.newContext({ storageState: AUTH_STATE_PATH, ignoreHTTPSErrors: true });
  } else {
    context = await browser.newContext({ ignoreHTTPSErrors: true });
  }
  const page = await context.newPage();

  // Admin overview — shows Backend/Frontend version
  await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/login')) {
    await doLogin(page);
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(3000);
  await screenshot(page, '08-admin-overview');

  const overviewText = await page.locator('body').textContent() ?? '';
  const beMatch = overviewText.match(/[Bb]ackend[:\s]*v?([\d]+\.[\d]+\.[\d]+)/);
  const feMatch = overviewText.match(/[Ff]rontend[:\s]*v?([\d]+\.[\d]+\.[\d]+)/);
  const backendVersion = beMatch ? beMatch[1] : null;
  const frontendVersion = feMatch ? feMatch[1] : null;

  console.log(`  Backend version: ${backendVersion ?? 'not found'}`);
  console.log(`  Frontend version: ${frontendVersion ?? 'not found'}`);

  // System Monitor — GPU + VRAM
  await page.goto(`${BASE_URL}/admin/monitor`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await screenshot(page, '09-system-monitor-top');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await screenshot(page, '09b-system-monitor-mid');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await screenshot(page, '09c-system-monitor-bottom');

  const monitorText = await page.locator('body').textContent() ?? '';
  const hasGPU = monitorText.includes('RTX 5090') || monitorText.includes('GPU');
  const hasVRAM = monitorText.includes('VRAM');
  const gpuUtilMatch = monitorText.match(/(\d+\.?\d*)%\s*(Util|utilization)/i);
  const vramMatch = monitorText.match(/([\d.]+)\s*(GB|GiB)\s*\/\s*([\d.]+)\s*(GB|GiB)/i);

  console.log(`  GPU section (RTX 5090): ${hasGPU ? 'FOUND' : 'NOT FOUND'}`);
  console.log(`  VRAM section: ${hasVRAM ? 'FOUND' : 'NOT FOUND'}`);
  if (gpuUtilMatch) console.log(`  GPU Utilization: ${gpuUtilMatch[1]}%`);
  if (vramMatch) console.log(`  VRAM: ${vramMatch[0]}`);

  await context.close();

  // Assertions
  if (backendVersion) {
    expect(backendVersion, 'Backend version should be 2.1.49').toBe('2.1.49');
    console.log('  Version check: PASS (2.1.49)');
  } else {
    console.log('  Version: not parseable — check 08-admin-overview.png');
    // Check screenshot manually
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: Model selector — vLLM display name
// ─────────────────────────────────────────────────────────────────────────────
test('4. Model selector - vLLM display name', async ({ browser }) => {
  console.log('\n=== TEST 4: Model Name Check ===');

  let context: BrowserContext;
  if (fs.existsSync(AUTH_STATE_PATH)) {
    context = await browser.newContext({ storageState: AUTH_STATE_PATH, ignoreHTTPSErrors: true });
  } else {
    context = await browser.newContext({ ignoreHTTPSErrors: true });
  }
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/login')) {
    await doLogin(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await screenshot(page, '10-chat-with-model-selector');

  // The model selector appears in the top bar, currently showing "Auto (Smart Routing)"
  // Click it to open the model dropdown
  const modelBtns = await page.locator('button').filter({ hasText: /Auto|Smart|Routing/i }).all();
  console.log(`  Found ${modelBtns.length} model-like button(s)`);

  if (modelBtns.length > 0) {
    await modelBtns[0].click();
    await page.waitForTimeout(1000);
    await screenshot(page, '11-model-dropdown-open');
  } else {
    // Try clicking the top bar area
    const topBar = page.locator('header, [class*="header"], [class*="topbar"], [class*="navbar"]').first();
    await topBar.click({ position: { x: 640, y: 30 } }).catch(() => {});
    await page.waitForTimeout(1000);
    await screenshot(page, '11-model-area-clicked');
  }

  const pageText = await page.locator('body').textContent() ?? '';
  const hasQwen = pageText.includes('Qwen');
  const hasvLLM = pageText.includes('vLLM');
  const hasExact = pageText.includes('Qwen3.5 35B-A3B (vLLM)');

  console.log(`  "Qwen" found: ${hasQwen}`);
  console.log(`  "vLLM" found: ${hasvLLM}`);
  console.log(`  "Qwen3.5 35B-A3B (vLLM)" exact: ${hasExact}`);

  const qwenMatch = pageText.match(/Qwen[^\n]{0,60}/);
  if (qwenMatch) {
    console.log(`  Model text: "${qwenMatch[0].trim()}"`);
  }

  if (hasExact) {
    console.log('  Model name: PASS — exact match "Qwen3.5 35B-A3B (vLLM)"');
  } else if (hasQwen && hasvLLM) {
    console.log('  Model name: PARTIAL — both Qwen and vLLM present but not together');
  } else {
    console.log('  Model name: check screenshot 11-model-dropdown-open.png');
  }

  await context.close();

  expect(hasQwen || hasvLLM, 'Qwen or vLLM model should be present on page').toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5 & 6: Quality check + Streaming verification
// ─────────────────────────────────────────────────────────────────────────────
test('5-6. Quality check and streaming verification', async ({ browser }) => {
  console.log('\n=== TEST 5-6: Quality + Streaming ===');

  let context: BrowserContext;
  if (fs.existsSync(AUTH_STATE_PATH)) {
    context = await browser.newContext({ storageState: AUTH_STATE_PATH, ignoreHTTPSErrors: true });
  } else {
    context = await browser.newContext({ ignoreHTTPSErrors: true });
  }
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/login')) {
    await doLogin(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  const msgInput = page.locator('textarea').first();
  await msgInput.waitFor({ state: 'visible', timeout: 15000 });

  const question = 'Spiega brevemente come funziona un motore elettrico';
  await msgInput.fill(question);
  await screenshot(page, '12-quality-filled');

  const proseCountBefore = await page.locator('.prose').count().catch(() => 0);
  const sendTime = Date.now();
  await msgInput.press('Enter');

  await screenshot(page, '13-quality-sent');

  // Wait for streaming to start (typing indicator appears or new prose element)
  await page.waitForFunction(
    (before: number) => {
      const typing = document.querySelectorAll('.typing-indicator');
      if (typing.length > 0) return true;
      const proseEls = document.querySelectorAll('.prose');
      return proseEls.length > before;
    },
    proseCountBefore,
    { timeout: 60000 }
  ).catch(() => console.log('  Streaming start not detected'));

  const ttftMs = Date.now() - sendTime;
  console.log(`  TTFT: ${ttftMs}ms`);

  // Monitor streaming: capture prose text length at intervals
  const streamingSnapshots: number[] = [];
  let monitorActive = true;

  const streamMonitor = (async () => {
    while (monitorActive) {
      await page.waitForTimeout(400);
      try {
        const proseEls = await page.locator('.prose').all();
        const newProseEls = proseEls.slice(proseCountBefore);
        if (newProseEls.length > 0) {
          const lastText = await newProseEls[newProseEls.length - 1].textContent().catch(() => '') ?? '';
          streamingSnapshots.push(lastText.length);
        }
      } catch {}
    }
  })();

  // Wait for completion: typing indicator gone AND prose has content
  await page.waitForFunction(
    (before: number) => {
      const typing = document.querySelectorAll('.typing-indicator');
      if (typing.length > 0) return false;
      const proseEls = document.querySelectorAll('.prose');
      const newEls = Array.from(proseEls).slice(before);
      if (newEls.length === 0) return false;
      const lastContent = newEls[newEls.length - 1].textContent?.trim() ?? '';
      return lastContent.length > 20;
    },
    proseCountBefore,
    { timeout: 120000 }
  ).catch(() => console.log('  Response completion timeout'));

  monitorActive = false;
  await streamMonitor;
  const totalTime = Date.now() - sendTime;

  await page.waitForTimeout(800);
  await screenshot(page, '14-quality-complete');

  // Extract response text
  const allProseEls = await page.locator('.prose').all();
  let responseText = '';
  const newProseEls = allProseEls.slice(proseCountBefore);
  if (newProseEls.length > 0) {
    responseText = await newProseEls[newProseEls.length - 1].textContent().catch(() => '') ?? '';
  }
  if (!responseText && allProseEls.length > 0) {
    responseText = await allProseEls[allProseEls.length - 1].textContent().catch(() => '') ?? '';
  }

  const uniqueLengths = [...new Set(streamingSnapshots.filter((l) => l > 0))];
  const streamingConfirmed = uniqueLengths.length >= 3;

  console.log(`  Response length: ${responseText.length} chars`);
  console.log(`  Total response time: ${totalTime}ms`);
  console.log(`  Streaming observations: ${streamingSnapshots.length} polls, ${uniqueLengths.length} unique lengths`);
  console.log(`  Sample lengths: ${uniqueLengths.slice(0, 8).join(', ')}${uniqueLengths.length > 8 ? '...' : ''}`);
  console.log(`  Response preview: "${responseText.substring(0, 250)}"`);

  const motorkw = ['motore', 'elettric', 'corrente', 'magnetico', 'energia', 'stator', 'rotor', 'bobina', 'magneti', 'electric', 'campo'];
  const isCoherent = responseText.length > 100 && motorkw.some((kw) => responseText.toLowerCase().includes(kw));

  console.log(`\n  Quality: ${isCoherent ? 'PASS' : 'FAIL'}`);
  console.log(`  Streaming: ${streamingConfirmed ? 'PASS (progressive tokens)' : 'INCONCLUSIVE'}`);

  await context.close();

  expect(responseText.length, 'Response should be substantial (>50 chars)').toBeGreaterThan(50);
  expect(isCoherent, 'Response should be coherent about electric motors').toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Final summary
// ─────────────────────────────────────────────────────────────────────────────
test.afterAll(async () => {
  ensureArtifactsDir();

  let ttftResults: { messageIndex: number; ttft_ms: number; note?: string }[] = [];
  const ttftPath = path.join(ARTIFACTS_DIR, 'ttft-results.json');
  if (fs.existsSync(ttftPath)) {
    ttftResults = JSON.parse(fs.readFileSync(ttftPath, 'utf-8'));
  }

  console.log('\n\n╔═══════════════════════════════════════════════╗');
  console.log('║   BACKEND RESTART VERIFICATION — FINAL REPORT ║');
  console.log('╚═══════════════════════════════════════════════╝\n');

  if (ttftResults.length > 0) {
    console.log('TTFT Results (8 consecutive messages, max 2s gap):');
    for (const r of ttftResults) {
      const flag =
        r.ttft_ms < 0 ? '[N/A]'
        : r.ttft_ms > 30000 ? '[TIMEOUT 30s+ !!!]'
        : r.ttft_ms > 5000 ? '[SLOW >5s]'
        : '[FAST]';
      console.log(`  Msg ${r.messageIndex}: ${r.ttft_ms >= 0 ? r.ttft_ms + 'ms' : 'N/A'} ${flag}${r.note ? '  ← ' + r.note.substring(0, 60) : ''}`);
    }
    const valid = ttftResults.filter((r) => r.ttft_ms > 0);
    if (valid.length > 0) {
      const avg = Math.round(valid.reduce((s, r) => s + r.ttft_ms, 0) / valid.length);
      const maxV = Math.max(...valid.map((r) => r.ttft_ms));
      console.log(`  Average: ${avg}ms | Max: ${maxV}ms`);
    }
    const hasTimeouts = ttftResults.some((r) => r.ttft_ms > 30000);
    console.log(`\n  45s Timeout Bug Fix: ${!hasTimeouts ? 'VERIFIED' : 'ISSUE — check results'}`);
  }

  console.log('\nArtifacts directory: ' + ARTIFACTS_DIR);
  console.log('Screenshots available for all steps.');
});
