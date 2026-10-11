// Serves the static web export and drives it with a real browser (Edge/Chrome via
// playwright-core). Usage: node scripts/web-smoke.mjs [scenario] [outDir]
// Scenarios live in scripts/smoke-scenarios.mjs. Fails on page errors.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { scenarios } from './smoke-scenarios.mjs';

const root = resolve('dist-web');
const scenarioName = process.argv[2] ?? 'boot';
const outDir = resolve(process.argv[3] ?? 'smoke-output');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.ttf': 'font/ttf' };

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(root, url === '/' ? 'index.html' : url);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    const body = await readFile(join(root, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  }
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
await mkdir(outDir, { recursive: true });

let browser;
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    console.log(`browser: ${channel}`);
    break;
  } catch {
    /* try next */
  }
}
if (!browser) throw new Error('No Edge/Chrome found for smoke test');

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.text().startsWith('[smoke]')) console.log(m.text());
});

await page.goto(`http://localhost:${port}/`);
const scenario = scenarios[scenarioName];
if (!scenario) throw new Error(`Unknown scenario ${scenarioName}`);
let failed = false;
try {
  await scenario({ page, shot: (name) => page.screenshot({ path: join(outDir, `${name}.png`) }), log: console.log });
} catch (e) {
  failed = true;
  console.error('SCENARIO FAILED:', e);
  await page.screenshot({ path: join(outDir, 'failure.png') });
}
if (errors.length) {
  console.error('PAGE ERRORS:\n' + errors.join('\n'));
  failed = true;
}
await browser.close();
server.close();
console.log(failed ? 'SMOKE: FAIL' : 'SMOKE: OK');
process.exit(failed ? 1 : 0);
