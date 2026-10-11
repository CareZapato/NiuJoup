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

export const scenarios = {
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
    const leaderBefore = await G(page, () => window.__legends.leaderId);
    await page.getByLabel('Tab', { exact: true }).click();
    await page.waitForTimeout(200);
    const leaderAfter = await G(page, () => window.__legends.leaderId);
    check(leaderAfter !== leaderBefore, `toque rápido en Tab cambia de líder (${leaderBefore} -> ${leaderAfter})`, R);
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
    await page.getByLabel('≡').click();
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
      await page.getByLabel('J', { exact: true }).click();
      await page.waitForTimeout(250);
    }
    const started = await G(page, () => {
      clearInterval(window.__mt);
      return [...window.__startedMoves];
    });
    check(started.includes('light_1'), `botón táctil J lanza ataques en combate (${started.join(', ')})`, R);
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
    check(learned === 1, '14 AP gastados: Kaien aprende "Combo físico" (desbloquea Patada lanzadora)', R);
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
