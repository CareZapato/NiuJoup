// One-off check against the running Expo web server. Not part of the suite.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const out = 'smoke-output/framing';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

function overlaps(rects) {
  const bad = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy < (a.r + b.r - 2) * (a.r + b.r - 2)) bad.push(`${a.id}~${b.id}`);
    }
  }
  return bad;
}

async function run(name, width, height, touch) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
  await page.getByTestId('btn-new').waitFor({ timeout: 30000 });
  await page.getByTestId('btn-new').click();
  await page.getByTestId('pick-kaien').click();
  await page.waitForFunction(() => window.__legends?.fsm.state === 'WORLD_EXPLORATION', null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const g = window.__legends;
    const t = g.map.tiles;
    for (const e of g.heroes()) {
      e.transform.pos.x = 2.5;
      e.transform.pos.z = t.height - 2.5;
      e.transform.prev.x = 2.5;
      e.transform.prev.z = t.height - 2.5;
    }
  });
  await page.waitForTimeout(400);
  const walk = await page.evaluate(() => {
    const g = window.__legends;
    const p = g.leader().transform.pos;
    const f = g.camera.pose.focus;
    return { dx: Math.abs(f.x - p.x), dz: Math.abs(f.z - p.z), d: g.camera.pose.distance, aspect: g.viewAspect };
  });
  await page.screenshot({ path: `${out}/${name}-walk.png` });
  const exploreD = walk.d;
  await page.evaluate(() => window.__legends.debugEncounter());
  await page.waitForTimeout(900);
  const battle = await page.evaluate(() => {
    const g = window.__legends;
    const p = (g.controlled() ?? g.leader()).transform.pos;
    const f = g.camera.pose.focus;
    return { dx: Math.abs(f.x - p.x), dz: Math.abs(f.z - p.z), d: g.camera.pose.distance, state: g.fsm.state };
  });
  await page.screenshot({ path: `${out}/${name}-battle.png` });
  const rects = await page.evaluate(() => {
    return [...document.querySelectorAll('[data-testid^="ctl-"]')].map((el) => {
      const b = el.getBoundingClientRect();
      return { id: el.getAttribute('data-testid'), x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2 };
    });
  });
  const bad = overlaps(rects);
  console.log(name, { walk, battle, exploreD, buttons: rects.length, overlaps: bad, errors });
  await context.close();
}

await run('pc', 1280, 720, false);
await run('land', 844, 390, true);
await run('port', 390, 844, true);
await browser.close();
