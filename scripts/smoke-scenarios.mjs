// Browser smoke scenarios. All gameplay is driven with real keyboard/mouse
// input; window.__legends (the Game instance) is only READ to assert state,
// except where a step is explicitly logged as "[assist]".

const G = (page, fn, arg) => page.evaluate(fn, arg);

const state = (page) => G(page, () => window.__legends?.fsm.state ?? 'NONE');

async function waitState(page, wanted, timeout = 20000) {
  const list = Array.isArray(wanted) ? wanted : [wanted];
  const t0 = Date.now();
  let s = '';
  while (Date.now() - t0 < timeout) {
    s = await state(page);
    if (list.includes(s)) return s;
    await page.waitForTimeout(100);
  }
  throw new Error(`timeout waiting for ${list.join('|')} (last: ${s})`);
}

const leaderPos = (page) =>
  G(page, () => {
    const g = window.__legends;
    const p = g.leader().transform.pos;
    return { x: p.x, y: p.y, z: p.z };
  });

function check(cond, label, results) {
  results.push({ label, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

/** Steers the leader toward a world point with WASD (exploration camera looks north). */
async function walkTo(page, tx, tz, { timeout = 15000, stopWhen } = {}) {
  const t0 = Date.now();
  const held = new Set();
  const set = async (k, on) => {
    if (on && !held.has(k)) {
      await page.keyboard.down(k);
      held.add(k);
    } else if (!on && held.has(k)) {
      await page.keyboard.up(k);
      held.delete(k);
    }
  };
  try {
    while (Date.now() - t0 < timeout) {
      if (stopWhen && (await stopWhen())) return true;
      const p = await leaderPos(page);
      const dx = tx - p.x;
      const dz = tz - p.z;
      if (Math.hypot(dx, dz) < 0.8) return true;
      await set('KeyD', dx > 0.4);
      await set('KeyA', dx < -0.4);
      await set('KeyS', dz > 0.4);
      await set('KeyW', dz < -0.4);
      await set('ShiftLeft', true);
      await page.waitForTimeout(80);
    }
    return false;
  } finally {
    for (const k of held) await page.keyboard.up(k);
  }
}

/** Test-side navigation only: BFS over walkable tiles, returns tile-centre waypoints. */
function findPath(page, tx, tz) {
  return G(
    page,
    ({ tx, tz }) => {
      const g = window.__legends;
      const map = g.map.tiles;
      const p = g.leader().transform.pos;
      const sx = Math.floor(p.x);
      const sz = Math.floor(p.z);
      const gx = Math.floor(tx);
      const gz = Math.floor(tz);
      const W = map.width;
      const ok = (x, z) => map.inBounds(x, z) && !map.isLiquid(x + 0.5, z + 0.5) && map.canOccupy(x + 0.5, z + 0.5, 0, 0.45, 0.55, false);
      const prev = new Int32Array(W * map.height).fill(-1);
      const q = [sz * W + sx];
      prev[q[0]] = q[0];
      while (q.length) {
        const c = q.shift();
        const cx = c % W;
        const cz = (c - cx) / W;
        if (cx === gx && cz === gz) break;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const nz = cz + dz;
          const n = nz * W + nx;
          if (!ok(nx, nz) || prev[n] !== -1) continue;
          prev[n] = c;
          q.push(n);
        }
      }
      const goal = gz * W + gx;
      if (prev[goal] === -1) return null;
      const path = [];
      for (let c = goal; c !== prev[c]; c = prev[c]) path.push({ x: (c % W) + 0.5, z: Math.floor(c / W) + 0.5 });
      return path.reverse().filter((_, i, a) => i % 2 === 1 || i === a.length - 1);
    },
    { tx, tz },
  );
}

async function navigate(page, tx, tz, opts = {}) {
  const path = await findPath(page, tx, tz);
  if (!path) throw new Error(`no path to ${tx},${tz}`);
  for (const wp of path) {
    if (opts.stopWhen && (await opts.stopWhen())) return true;
    await walkTo(page, wp.x, wp.z, { timeout: 4000, stopWhen: opts.stopWhen });
  }
  return walkTo(page, tx, tz, opts);
}

async function tap(page, key, ms = 60) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function newGame(page, shot) {
  await page.getByTestId('btn-new').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await shot('01-main-menu');
  await page.getByTestId('btn-new').click();
  await page.getByTestId('pick-kaien').click();
  await waitState(page, 'WORLD_EXPLORATION');
  await page.waitForTimeout(1200);
}

/** [assist] Moves the whole party next to a map position (diagnostics only). */
function placeParty(page, x, z) {
  return G(
    page,
    ({ x, z }) => {
      const g = window.__legends;
      g.heroes().forEach((h, i) => {
        h.transform.pos.x = h.transform.prev.x = x + i * 0.4;
        h.transform.pos.z = h.transform.prev.z = z + i * 0.4;
        h.transform.pos.y = h.transform.prev.y = g.map.tiles.heightAt(h.transform.pos.x, h.transform.pos.z);
      });
    },
    { x, z },
  );
}

/** Real multitouch through CDP: each finger has its own id and can be released independently. */
async function touchDriver(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const points = new Map();
  const list = () => [...points].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 }));
  const send = (type, touchPoints = list()) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  return {
    async down(id, x, y) {
      points.set(id, { x, y });
      await send('touchStart');
    },
    async move(id, x, y) {
      points.set(id, { x, y });
      await send('touchMove');
    },
    async up(id) {
      // Chromium releases exactly the points listed in touchEnd; the others stay down.
      const p = points.get(id);
      points.delete(id);
      await send('touchEnd', [{ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 }]);
    },
  };
}

async function center(page, testId) {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`control ${testId} not visible`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const held = (page) => G(page, () => window.__legends.input.heldActions());
const stickNow = (page) => G(page, () => ({ ...window.__legends.input.touchStick }));

/** [assist] Freeze every engaged combatant except the controlled one (keeps timing checks deterministic). */
function freezeOthers(page) {
  return G(page, () => {
    const g = window.__legends;
    const me = g.controlled();
    for (const e of g.world.query('combatant')) if (e.combatant.engaged && e !== me) e.combatant.confusedTicks = 1e7;
  });
}

export const scenarios = {
  /** Multitouch, simultaneous keys, key repeat, blur release and the focus window timing. */
  async controls({ page, shot }) {
    const R = [];
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => localStorage.setItem('legends.settings', JSON.stringify({ touchControls: 'on' })));
    await page.reload();
    await newGame(page, shot);
    const touch = await touchDriver(page);
    await shot('c1-touch-exploration');

    // Exploration: finger 1 on the joystick, finger 2 holds "up"; releasing one keeps the other.
    const p0 = await leaderPos(page);
    await touch.down(1, 120, 300);
    for (let i = 1; i <= 6; i++) await touch.move(1, 120 + i * 10, 300);
    const up = await center(page, 'ctl-up');
    await touch.down(2, up.x, up.y);
    await page.waitForTimeout(250);
    let h = await held(page);
    let st = await stickNow(page);
    check(h.includes('up') && st.x > 0.5, `multitáctil: joystick (x=${st.x.toFixed(2)}) y botón "subir" a la vez (${h.join(',')})`, R);
    await touch.up(2);
    await page.waitForTimeout(150);
    h = await held(page);
    st = await stickNow(page);
    check(!h.includes('up') && st.x > 0.5, 'soltar el botón no suelta el joystick', R);
    await page.waitForTimeout(600);
    await touch.up(1);
    await page.waitForTimeout(150);
    const p1 = await leaderPos(page);
    st = await stickNow(page);
    check(p1.x - p0.x > 1 && st.x === 0 && st.y === 0, `el joystick movió al líder (${p0.x.toFixed(1)} -> ${p1.x.toFixed(1)}) y vuelve a reposo al soltar`, R);

    // Technique loadout editor in the pause menu (UI clicks), saved through SaveManager.
    await tap(page, 'Escape');
    await waitState(page, 'PAUSED');
    await page.getByTestId('tab-techniques').click();
    await page.getByTestId('slot-1').click();
    const savedBefore = await G(page, () => window.__legends.saveManager.lastSavedAt);
    const target = await G(page, () => window.__legends.techniquesOf(window.__legends.leaderId)[0]?.id ?? null);
    await page.getByTestId(`assign-${target}`).click();
    await page.waitForFunction((t) => window.__legends.saveManager.lastSavedAt > t && window.__legends.saveManager.lastSaveOk === true, savedBefore, { timeout: 5000 });
    const slotsNow = await G(page, () => window.__legends.roster[window.__legends.leaderId].slots);
    const stored = await G(page, () => {
      const g = window.__legends;
      const env = JSON.parse(localStorage.getItem('legends.save.main') ?? '{}');
      return JSON.parse(env.payload ?? '{}').roster?.[g.leaderId]?.slots ?? null;
    });
    check(slotsNow[1] === target && JSON.stringify(stored) === JSON.stringify(slotsNow), `editor de técnicas: ${target} en la ranura 2 y guardado verificado (${JSON.stringify(slotsNow)})`, R);
    await shot('c1b-techniques-tab');
    await page.getByTestId('btn-resume').click();
    await waitState(page, 'WORLD_EXPLORATION');

    // Combat: joystick + guard held simultaneously, independent release.
    console.log('[assist] debugEncounter()');
    await G(page, () => window.__legends.debugEncounter());
    await waitState(page, 'ACTIVE_COMBAT', 6000);
    await freezeOthers(page);
    await page.waitForTimeout(400);
    await shot('c2-touch-combat');
    const guard = await center(page, 'ctl-guard');
    await touch.down(3, 110, 300);
    await touch.move(3, 170, 300);
    await touch.down(4, guard.x, guard.y);
    await page.waitForTimeout(200);
    h = await held(page);
    st = await stickNow(page);
    check(h.includes('guard') && st.x > 0.5, `combate: moverse y defender con dos dedos (${h.join(',')}, stick ${st.x.toFixed(2)})`, R);
    await touch.up(3);
    await page.waitForTimeout(120);
    h = await held(page);
    st = await stickNow(page);
    check(h.includes('guard') && st.x === 0, 'soltar el joystick mantiene la defensa', R);
    await touch.up(4);
    await page.waitForTimeout(120);
    check(!(await held(page)).includes('guard'), 'soltar el dedo de defensa la suelta', R);

    // Keyboard: simultaneous keys, repeat ignored, blur releases everything.
    await page.keyboard.down('KeyD');
    await page.keyboard.down('KeyU');
    await page.waitForTimeout(150);
    h = await held(page);
    check(h.includes('stickRight') && h.includes('guard'), `teclado: D + U a la vez (${h.join(',')})`, R);
    const before = await G(page, () => window.__legends.input.pressCount('light'));
    await page.keyboard.down('KeyJ');
    await page.keyboard.down('KeyJ');
    await page.keyboard.down('KeyJ');
    const after = await G(page, () => window.__legends.input.pressCount('light'));
    check(after - before === 1, `la repetición automática de tecla no genera pulsaciones (${after - before})`, R);
    await G(page, () => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(100);
    h = await held(page);
    check(h.length === 0, `perder el foco de la ventana suelta todas las teclas (${h.join(',') || 'ninguna'})`, R);
    await page.keyboard.up('KeyJ');
    await page.keyboard.up('KeyU');
    await page.keyboard.up('KeyD');

    // Focus: 0.2x world, gray filter, exactly 3 real seconds.
    await page.waitForTimeout(300);
    await tap(page, 'KeyF', 40);
    const t0 = Date.now();
    await page.waitForFunction(() => window.__legends.focus.active, null, { timeout: 2000 });
    await page.waitForTimeout(400);
    const mid = await G(page, () => ({ ts: window.__legends.timeScale, filter: window.__legends.focusFilter }));
    await shot('c3-focus-filter');
    check(mid.ts === 0.2 && mid.filter > 0.9, `concentración: mundo a x${mid.ts} y filtro gris ${mid.filter.toFixed(2)}`, R);
    await page.waitForFunction(() => !window.__legends.focus.active, null, { timeout: 6000 });
    const secs = (Date.now() - t0) / 1000;
    check(secs > 2.7 && secs < 3.7, `la ventana dura ~3 s reales (${secs.toFixed(2)} s medidos con sondeo)`, R);
    await page.waitForTimeout(400);
    const end = await G(page, () => ({ ts: window.__legends.timeScale, filter: window.__legends.focusFilter, confused: window.__legends.controlled().combatant.confusedTicks }));
    check(end.ts === 1 && end.filter < 0.05, `al terminar se restaura el tiempo (x${end.ts}) y el filtro (${end.filter.toFixed(2)})`, R);
    check(end.confused > 0, `agotar la ventana sin secuencia aplica "Confundido" (${end.confused} ticks)`, R);
    await shot('c4-after-focus');

    const failed = R.filter((r) => !r.ok);
    console.log(`\nRESUMEN: ${R.length - failed.length}/${R.length} comprobaciones OK`);
    if (failed.length) throw new Error(`Fallaron: ${failed.map((f) => f.label).join('; ')}`);
  },

  /** Edges on a phone-sized landscape viewport. */
  async edgesMobile(ctx) {
    await ctx.page.setViewportSize({ width: 844, height: 390 });
    await scenarios.edges(ctx);
  },

  /** Diagnostic: the camera at the four map corners, exploring and fighting. */
  async edges({ page, shot }) {
    await newGame(page, shot);
    const corners = [
      ['nw', 3.5, 3.5],
      ['ne', 59.5, 17.5],
      ['sw', 3.5, 44.5],
      ['se', 61.5, 46.5],
    ];
    for (const [name, x, z] of corners) {
      console.log(`[assist] party -> ${name} (${x}, ${z})`);
      await placeParty(page, x, z);
      await page.waitForTimeout(1500);
      const cam = await G(page, () => ({ ...window.__legends.camera.pose.focus, d: window.__legends.camera.pose.distance }));
      console.log(`      camera focus (${cam.x.toFixed(1)}, ${cam.z.toFixed(1)}) dist ${cam.d.toFixed(1)}`);
      await shot(`edge-${name}`);
    }
    console.log('[assist] combat at the north-west corner');
    await placeParty(page, 3.5, 3.5);
    await page.waitForTimeout(800);
    await G(page, () => window.__legends.debugEncounter());
    await page.waitForTimeout(300);
    await shot('edge-nw-transition');
    await waitState(page, 'ACTIVE_COMBAT', 8000);
    await page.waitForTimeout(800);
    await shot('edge-nw-combat');
  },

  /** Diagnostic: AI-only encounter timeline (player idle). */
  async combatlog({ page, shot }) {
    await newGame(page, shot);
    console.log('[assist] debugEncounter()');
    await G(page, () => {
      const g = window.__legends;
      window.__log = [];
      g.events.on('hit', (h) => window.__log.push(`t${g.loop.tick} HIT ${g.world.get(h.attackerId)?.combatant?.name}->${g.world.get(h.defenderId)?.combatant?.name} ${h.moveId} ${h.damage}${h.blocked ? ' (bloq)' : ''}`));
      g.debugEncounter();
      window.__timer = setInterval(() => {
        const row = g.world
          .query('combatant')
          .filter((e) => e.combatant.engaged)
          .map((e) => `${e.combatant.name}:${e.combatant.state}/${e.combatant.ai.action}/${Math.ceil(e.combatant.hp)}`)
          .join(' | ');
        window.__log.push(`t${g.loop.tick} ${g.fsm.state} ${row}`);
      }, 250);
    });
    await page.waitForTimeout(12000);
    const log = await G(page, () => {
      clearInterval(window.__timer);
      return window.__log;
    });
    for (const l of log) console.log(l);
    await shot('combatlog');
  },

  /** Phone-sized landscape viewport with touch controls forced on; drags the virtual joystick. */
  async mobile({ page, shot }) {
    const R = [];
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => localStorage.setItem('legends.settings', JSON.stringify({ touchControls: 'on' })));
    await page.reload();
    await newGame(page, shot);
    await shot('m1-touch-hud');
    const touch = await touchDriver(page);
    const tapControl = async (id) => {
      const c = await center(page, id);
      await touch.down(9, c.x, c.y);
      await page.waitForTimeout(60);
      await touch.up(9);
    };
    const leaderBefore = await G(page, () => window.__legends.leaderId);
    await tapControl('ctl-nextAlly');
    await page.waitForTimeout(200);
    const leaderAfter = await G(page, () => window.__legends.leaderId);
    check(leaderAfter !== leaderBefore, `toque rápido en "cambiar personaje" cambia de líder (${leaderBefore} -> ${leaderAfter})`, R);
    const p0 = await leaderPos(page);
    const box = { x: 8 + 56 * 1.3, y: 390 - 8 - 56 * 1.3 };
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + i * 6, box.y, { steps: 2 });
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const p1 = await leaderPos(page);
    check(p1.x - p0.x > 1, `joystick virtual mueve al líder (${p0.x.toFixed(1)} -> ${p1.x.toFixed(1)})`, R);
    const stick = await G(page, () => ({ ...window.__legends.input.touchStick }));
    check(stick.x === 0 && stick.y === 0, 'al soltar el joystick vuelve a reposo', R);
    await tapControl('ctl-menu');
    await waitState(page, 'PAUSED', 3000);
    check(true, 'botón táctil de menú abre la pausa', R);
    await shot('m2-touch-pause');
    await page.getByTestId('btn-resume').click();
    await waitState(page, 'WORLD_EXPLORATION', 3000);
    console.log('[assist] debugEncounter()');
    await G(page, () => window.__legends.debugEncounter());
    await waitState(page, 'ACTIVE_COMBAT', 5000);
    await G(page, () => {
      const g = window.__legends;
      window.__touchMoves = [];
      g.events.on('hit', (h) => {
        if (g.world.get(h.attackerId)?.combatant?.playerControlled) window.__touchMoves.push(h.moveId);
      });
      window.__startedMoves = new Set();
      window.__mt = setInterval(() => {
        const c = g.controlled()?.combatant;
        if (c?.moveId) window.__startedMoves.add(c.moveId);
      }, 10);
    });
    for (let i = 0; i < 6; i++) {
      await tapControl('ctl-light');
      await page.waitForTimeout(250);
    }
    const started = await G(page, () => {
      clearInterval(window.__mt);
      return [...window.__startedMoves];
    });
    check(started.includes('light_1'), `botón táctil de puño lanza ataques en combate (${started.join(', ')})`, R);
    await shot('m3-touch-combat');
    const failed = R.filter((r) => !r.ok);
    if (failed.length) throw new Error(`Fallaron: ${failed.map((f) => f.label).join('; ')}`);
  },

  async boot({ page, shot }) {
    await page.getByTestId('btn-new').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot('boot');
  },

  async slice({ page, shot }) {
    const R = [];
    const t0 = Date.now();
    check(true, '01 arranca en navegador (web export)', R);
    await newGame(page, shot);
    await shot('02-exploration');

    // 02/03 WASD + camera follow
    const p0 = await leaderPos(page);
    const cam0 = await G(page, () => ({ ...window.__legends.camera.pose.focus }));
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyS');
    await page.waitForTimeout(400);
    const p1 = await leaderPos(page);
    const cam1 = await G(page, () => ({ ...window.__legends.camera.pose.focus }));
    check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1.5, `02 movimiento WASD (${p0.x.toFixed(1)},${p0.z.toFixed(1)}) -> (${p1.x.toFixed(1)},${p1.z.toFixed(1)})`, R);
    check(Math.hypot(cam1.x - cam0.x, cam1.z - cam0.z) > 1, '03 la cámara sigue al jugador', R);
    await shot('03-moved');

    // 04 visible enemy
    const enemy = await G(page, () => {
      const e = window.__legends.world.getStable('e_sprout_1');
      return e ? { x: e.transform.pos.x, z: e.transform.pos.z, visible: e.sprite.visible } : null;
    });
    check(enemy && enemy.visible, '04 enemigo visible en el mapa (e_sprout_1)', R);

    // 05 walk to it; detection + contact starts the encounter
    await navigate(page, enemy.x, enemy.z, { timeout: 8000, stopWhen: async () => (await state(page)) !== 'WORLD_EXPLORATION' });
    const s5 = await waitState(page, ['ENCOUNTER_TRANSITION', 'ACTIVE_COMBAT'], 8000);
    check(true, `05 encuentro iniciado al contactar (${s5})`, R);
    const encStart = Date.now();
    await page.waitForTimeout(250);
    await shot('04-transition-zoom');
    const mid = await G(page, () => ({ mode: window.__legends.camera.mode, blend: window.__legends.camera.blendProgress, pitch: window.__legends.camera.pose.pitch }));
    check(mid.mode === 'EncounterCamera' || mid.mode === 'CombatCamera', `06 zoom/inclinación de cámara (modo ${mid.mode}, pitch ${mid.pitch.toFixed(2)})`, R);
    await G(page, () => {
      const g = window.__legends;
      window.__smokeHits = { player: 0, enemy: 0, moves: {} };
      g.events.on('hit', (h) => {
        const a = g.world.get(h.attackerId);
        if (a?.combatant?.playerControlled) {
          window.__smokeHits.player++;
          window.__smokeHits.moves[h.moveId] = (window.__smokeHits.moves[h.moveId] ?? 0) + 1;
        }
        if (a?.combatant?.team === 'enemy') window.__smokeHits.enemy++;
      });
      window.__enemyStates = new Set();
      window.__enemyMoves = new Set();
      window.__stateTimer = setInterval(() => {
        for (const e of g.world.query('combatant')) {
          if (!e.combatant.engaged || e.combatant.team !== 'enemy') continue;
          window.__enemyStates.add(e.combatant.state);
          if (e.combatant.moveId) window.__enemyMoves.add(e.combatant.moveId);
        }
      }, 15);
    });
    await waitState(page, 'ACTIVE_COMBAT', 5000);
    const continuity = Date.now() - encStart;
    check(continuity < 2500, `07 continuidad sin pantalla de carga (${continuity} ms hasta control en combate)`, R);
    await shot('05-combat');

    // 08-11 real-time combat with keyboard
    const hp0 = await G(page, () => window.__legends.world.getStable('e_sprout_1').combatant.stats.maxHp);
    let enemyActed = false;
    let heroDamaged = false;
    const cT = Date.now();
    let shotTaken = false;
    while (Date.now() - cT < 60000) {
      const s = await state(page);
      if (s !== 'ACTIVE_COMBAT') break;
      const info = await G(page, () => {
        const g = window.__legends;
        const me = g.controlled();
        const t = g.world.get(me.combatant.targetId);
        const e = g.world.getStable('e_sprout_1');
        const heroes = g.heroes().map((h) => h.combatant);
        const dx = t ? t.transform.pos.x - me.transform.pos.x : 0;
        const dz = t ? t.transform.pos.z - me.transform.pos.z : 0;
        const yaw = g.camera.pose.yaw;
        return {
          d: t ? Math.hypot(dx, dz) : 99,
          // Screen-space direction to the target (camera forward = (-sin yaw, -cos yaw)).
          sx: dx * Math.cos(yaw) - dz * Math.sin(yaw),
          sy: -dx * Math.sin(yaw) - dz * Math.cos(yaw),
          dy: t ? t.transform.pos.y - me.transform.pos.y : 0,
          enemyState: e.combatant.state,
          heroHurt: heroes.some((c) => c.hp < c.stats.maxHp),
        };
      });
      if (info.heroHurt) heroDamaged = true;
      if (info.d > 1.8) {
        const l = Math.hypot(info.sx, info.sy) || 1;
        const keys = [];
        if (info.sx / l > 0.38) keys.push('KeyD');
        if (info.sx / l < -0.38) keys.push('KeyA');
        if (info.sy / l > 0.38) keys.push('KeyW');
        if (info.sy / l < -0.38) keys.push('KeyS');
        if (info.dy > 0.6) keys.push('Space');
        if (info.dy < -0.6) keys.push('ControlLeft');
        for (const k of keys) await page.keyboard.down(k);
        await page.waitForTimeout(120);
        for (const k of keys) await page.keyboard.up(k);
      } else {
        await tap(page, 'KeyJ');
        await page.waitForTimeout(90);
        await tap(page, 'KeyJ');
        await page.waitForTimeout(90);
        await tap(page, 'KeyK');
        await page.waitForTimeout(200);
      }
      if (!shotTaken && Date.now() - cT > 2500) {
        await shot('06-combat-action');
        shotTaken = true;
      }
    }
    const hp1 = await G(page, () => window.__legends.world.getStable('e_sprout_1')?.combatant.hp ?? 0);
    const hits = await G(page, () => window.__smokeHits);
    const { seen, enemyMoves } = await G(page, () => {
      clearInterval(window.__stateTimer);
      return { seen: [...window.__enemyStates], enemyMoves: [...window.__enemyMoves] };
    });
    enemyActed = enemyMoves.length > 0;
    console.log(`      estados enemigos observados: ${seen.join(', ')}`);
    check(hits.player > 0, `08 ataques en tiempo real con teclado conectan (${hits.player} golpes del jugador: ${JSON.stringify(hits.moves)})`, R);
    check(enemyActed || hits.enemy > 0, `09 la IA enemiga ataca (movimientos: ${enemyMoves.join(', ') || 'ninguno'}; golpes conectados: ${hits.enemy}; aliados heridos: ${heroDamaged})`, R);
    check(hp1 < hp0, `10 colisión hitbox/hurtbox y daño (PV enemigo ${Math.ceil(hp0)} -> ${Math.ceil(hp1)})`, R);
    console.log(`      duración del combate: ${((Date.now() - cT) / 1000).toFixed(1)} s`);

    const sV = await waitState(page, ['COMBAT_VICTORY', 'RETURN_TO_WORLD', 'WORLD_EXPLORATION'], 10000);
    check(sV !== 'COMBAT_DEFEAT', `11 enemigo derrotado (${sV})`, R);
    await page.waitForTimeout(500);
    await shot('07-victory');
    const prog = await G(page, () => {
      const m = window.__legends.roster.kaien;
      return { xp: m.xp, ap: m.ap, level: m.level };
    });
    check(prog.xp > 0 || prog.level > 1, `12 XP ganada (xp ${prog.xp}, nivel ${prog.level})`, R);
    check(prog.ap > 0, `12 AP ganados (${prog.ap})`, R);
    await waitState(page, 'WORLD_EXPLORATION', 10000);
    await page.waitForTimeout(600);
    const backMode = await G(page, () => window.__legends.camera.mode);
    check(backMode === 'ExplorationCamera', `13 la cámara vuelve a exploración (${backMode})`, R);
    const gone = await G(page, () => !window.__legends.world.getStable('e_sprout_1'));
    check(gone, '13 el enemigo derrotado desaparece del mundo', R);
    await shot('08-back-to-world');

    // 14 spend AP in the skill tree (UI clicks)
    await tap(page, 'Escape');
    await waitState(page, 'PAUSED');
    await page.getByTestId('tab-skills').click();
    await page.waitForTimeout(300);
    await shot('09-skill-tree');
    const savedBefore = await G(page, () => window.__legends.saveManager.lastSavedAt);
    await page.getByTestId('skill-combo_basics').click();
    await page.waitForTimeout(300);
    const learned = await G(page, () => window.__legends.roster.kaien.skills.combo_basics ?? 0);
    check(learned === 1, '14 AP gastados: Goku aprende "Combo físico" (desbloquea Patada lanzadora)', R);
    await shot('10-skill-learned');

    // 15 the purchase itself triggers the autosave (no manual save); "saved" only after the verified write
    await page.waitForFunction((t) => window.__legends.saveManager.lastSavedAt > t && window.__legends.saveManager.lastSaveOk === true, savedBefore, { timeout: 5000 });
    const saveUi = await G(page, () => window.__legends.getUi().save.status);
    const raw = await G(page, () => localStorage.getItem('legends.save.main'));
    check(!!raw && raw.includes('combo_basics') && saveUi === 'saved', `15 autoguardado tras comprar la habilidad, verificado en almacenamiento (indicador: ${saveUi})`, R);
    await page.getByTestId('tab-party').click();
    await page.getByTestId('btn-resume').click();
    await waitState(page, 'WORLD_EXPLORATION');

    // 16 reload page -> continue -> progress persists
    const before = await G(page, () => ({ xp: window.__legends.roster.kaien.xp, level: window.__legends.roster.kaien.level }));
    await page.reload();
    await page.getByTestId('btn-continue').waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    await page.getByTestId('btn-continue').click();
    await waitState(page, 'WORLD_EXPLORATION');
    await page.waitForTimeout(800);
    const after = await G(page, () => {
      const g = window.__legends;
      return { xp: g.roster.kaien.xp, level: g.roster.kaien.level, skill: g.roster.kaien.skills.combo_basics ?? 0, sprout: !!g.world.getStable('e_sprout_1'), moves: g.leader().combatant.unlockedMoves };
    });
    check(after.xp === before.xp && after.level === before.level && after.skill === 1, `16 progreso persiste tras recargar (xp ${after.xp}, nivel ${after.level}, habilidad ${after.skill})`, R);
    check(after.moves.includes('launcher'), '16 la técnica desbloqueada está disponible tras recargar', R);
    check(!after.sprout, '16 el enemigo derrotado sigue ausente tras recargar', R);
    await shot('11-after-reload');

    const failed = R.filter((r) => !r.ok);
    console.log(`\nRESUMEN: ${R.length - failed.length}/${R.length} comprobaciones OK en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (failed.length) throw new Error(`Fallaron: ${failed.map((f) => f.label).join('; ')}`);
  },
};
