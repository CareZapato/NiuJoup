import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, type GestureResponderEvent, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { UiSlot, UiSnapshot } from '../../game/Game';
import { BALANCE } from '../../game/content/balance';
import { type BindAction, keyCaption } from '../../game/settings';
import { Txt } from '../components/primitives';
import { useGameUi, useServices } from '../GameContext';
import { COLORS } from '../theme';
import { layoutControls, type PlacedControl } from './controlLayout';
import { type IconName, PixelIcon, techniqueIcon } from './PixelIcon';

type Kind = 'button' | 'slot' | 'limit' | 'focus';

interface Control {
  key: string;
  kind: Kind;
  action: BindAction;
  x: number;
  y: number;
  r: number;
  icon: IconName | null;
  color: string;
  slot?: UiSlot;
}

interface StickState {
  pointer: string | null;
  cx: number;
  cy: number;
  kx: number;
  ky: number;
}

const HOLDER = 'touch:';

function hasFinePointer(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}

const BUTTON_ICON: Record<string, { icon: IconName; color: string }> = {
  light: { icon: 'fist', color: COLORS.gold },
  ki: { icon: 'blast', color: COLORS.ki },
  dash: { icon: 'dash', color: COLORS.text },
  charge: { icon: 'aura', color: COLORS.ki },
  heavy: { icon: 'heavy', color: COLORS.enemy },
  guard: { icon: 'shield', color: COLORS.good },
  up: { icon: 'up', color: COLORS.dim },
  down: { icon: 'down', color: COLORS.dim },
  focus: { icon: 'focus', color: '#d8d8ff' },
  limit: { icon: 'limit', color: COLORS.gold },
  nextAlly: { icon: 'swap', color: COLORS.player },
  nextTarget: { icon: 'target', color: COLORS.enemy },
  camLeft: { icon: 'camLeft', color: COLORS.dim },
  camRight: { icon: 'camRight', color: COLORS.dim },
  menu: { icon: 'menu', color: COLORS.text },
};

function decorate(p: PlacedControl, ui: UiSnapshot): Control {
  const slot = p.slotIndex !== undefined ? ui.slots[p.slotIndex] : undefined;
  const face = p.kind === 'slot' ? { icon: techniqueIcon(slot?.moveId ?? null), color: COLORS.ki } : BUTTON_ICON[p.key];
  return { key: p.key, kind: p.kind, action: p.action, x: p.x, y: p.y, r: p.r, icon: face?.icon ?? null, color: face?.color ?? COLORS.text, slot };
}

const ControlFace = memo(function ControlFace({
  c,
  pressed,
  caption,
  rage,
  limitReady,
  focus,
  charging,
}: {
  c: Control;
  pressed: boolean;
  caption: string | null;
  rage: number;
  limitReady: boolean;
  focus: UiSnapshot['focus'] | null;
  charging: boolean;
}) {
  const d = c.r * 2;
  const s = c.slot;
  const empty = c.kind === 'slot' && !s?.moveId;
  let dim = false;
  let lock = false;
  let noKi = false;
  let cdFrac = 0;
  let cdText = '';
  if (s && s.moveId) {
    noKi = !s.affordable;
    lock = !s.usable && !noKi && s.cooldown <= 0;
    dim = lock || noKi || s.cooldown > 0;
    if (s.cooldown > 0 && s.cooldownMax > 0) {
      cdFrac = Math.min(1, s.cooldown / s.cooldownMax);
      cdText = s.cooldown >= 10 ? `${Math.ceil(s.cooldown)}` : s.cooldown.toFixed(1);
    }
  }
  if (c.kind === 'focus' && focus && !focus.ready) {
    cdFrac = Math.min(1, focus.cooldown / (BALANCE.focus.cooldownTicks / 60));
    cdText = focus.cooldown.toFixed(1);
    dim = true;
  }
  if (c.kind === 'limit') dim = !limitReady;
  const active = (c.kind === 'focus' && focus?.active) || (c.action === 'charge' && charging);
  const border = empty ? COLORS.borderDim : noKi ? COLORS.hpLow : active ? '#ffffff' : c.kind === 'limit' && limitReady ? COLORS.gold : c.color;
  const iconSize = d * 0.62;
  return (
    <View
      pointerEvents="none"
      testID={`ctl-${c.key}`}
      style={[
        styles.face,
        {
          left: c.x - c.r,
          top: c.y - c.r,
          width: d,
          height: d,
          borderRadius: c.r,
          borderColor: border,
          borderStyle: empty ? 'dashed' : 'solid',
          borderWidth: c.kind === 'limit' && limitReady ? 3 : 2,
          backgroundColor: pressed || active ? 'rgba(255,255,255,0.32)' : 'rgba(8,10,28,0.5)',
        },
      ]}
    >
      {c.kind === 'limit' && <View style={[styles.rageFill, { height: `${rage}%`, backgroundColor: limitReady ? 'rgba(255,170,40,0.55)' : 'rgba(255,90,40,0.35)' }]} />}
      {c.icon && !empty && (
        <View style={{ opacity: dim ? 0.45 : 1 }}>
          <PixelIcon name={c.icon} size={iconSize} color={c.kind === 'slot' && noKi ? '#7a8aa0' : '#101018'} accent={c.kind === 'slot' && noKi ? '#9ab' : c.kind === 'limit' && limitReady ? '#ffe070' : c.color} />
        </View>
      )}
      {cdFrac > 0 && <View style={[styles.cdFill, { height: `${cdFrac * 100}%` }]} />}
      {cdText !== '' && (
        <View style={styles.center}>
          <Txt size={Math.max(16, c.r * 0.7)} color="#ffffff">
            {cdText}
          </Txt>
        </View>
      )}
      {lock && (
        <View style={styles.center}>
          <PixelIcon name="lock" size={Math.max(12, iconSize * 0.6)} color="#101018" accent="#d0d0d0" />
        </View>
      )}
      {noKi && cdText === '' && (
        <View style={styles.kiTag}>
          <Txt size={14} color={COLORS.hpLow}>
            KI
          </Txt>
        </View>
      )}
      {caption && (
        <View style={styles.caption}>
          <Txt size={14} color={COLORS.dim}>
            {caption}
          </Txt>
        </View>
      )}
    </View>
  );
});

/**
 * Single multitouch layer. Every pointer is bound on touch-down to exactly one
 * control (joystick or one button) and only that pointer can release it, so
 * moving with one thumb while attacking/blocking with the other never cancels
 * either. Web uses DOM pointer events (pointerId); native uses raw touch events
 * (identifier) without the single-responder gesture system.
 */
export function TouchControls({ touch = true }: { touch?: boolean }) {
  const ui = useGameUi();
  const visible = ui.state === 'WORLD_EXPLORATION' || ui.state === 'ACTIVE_COMBAT' || ui.state === 'ENCOUNTER_TRANSITION';
  // Unmounting (pause, menus, defeat) releases every finger in the layer's cleanup.
  return visible ? <ControlsLayer touch={touch} ui={ui} /> : null;
}

function ControlsLayer({ touch, ui }: { touch: boolean; ui: UiSnapshot }) {
  const { game } = useServices();
  const { width: w, height: h } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const input = game.input;
  const scale = game.settings.buttonScale;
  const fine = useMemo(() => hasFinePointer(), []);

  const combatUi = ui.state === 'ACTIVE_COMBAT' || ui.state === 'ENCOUNTER_TRANSITION';
  const placed = useMemo(
    () =>
      layoutControls({
        combat: combatUi,
        slotCount: ui.slots.length,
        hasLimit: combatUi && !!ui.limit,
        w,
        h,
        insets: { left: insets.left, right: insets.right, top: insets.top, bottom: insets.bottom },
        scale,
        touch,
      }),
    [combatUi, ui.slots.length, ui.limit, w, h, insets.left, insets.right, insets.top, insets.bottom, scale, touch],
  );
  const controls = useMemo(() => placed.controls.map((p) => decorate(p, ui)), [placed, ui]);
  const stickR = placed.stick?.r ?? 48;
  const stickHome = placed.stick ?? { x: insets.left + stickR, y: h - insets.bottom - stickR, r: stickR };

  const controlsRef = useRef(controls);
  const dialogueRef = useRef(!!ui.dialogue);
  const geom = useRef({ w, h, stickR });
  useLayoutEffect(() => {
    controlsRef.current = controls;
    dialogueRef.current = !!ui.dialogue;
    geom.current = { w, h, stickR };
  });

  const bound = useRef(new Map<string, Control | 'stick' | 'tap'>());
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set());
  const [stick, setStick] = useState<StickState>({ pointer: null, cx: 0, cy: 0, kx: 0, ky: 0 });

  const syncPressed = useCallback(() => {
    const keys = new Set<string>();
    for (const v of bound.current.values()) if (typeof v === 'object') keys.add(v.key);
    setPressed(keys);
  }, []);

  const releaseAllTouches = useCallback(() => {
    bound.current.clear();
    input.releaseHolders(HOLDER);
    setPressed(new Set());
    setStick({ pointer: null, cx: 0, cy: 0, kx: 0, ky: 0 });
  }, [input]);

  const stickOrigin = useRef({ x: 0, y: 0 });
  const moveStick = useCallback(
    (id: string, x: number, y: number, origin?: { x: number; y: number }) => {
      const R = geom.current.stickR;
      if (origin) stickOrigin.current = origin;
      const { x: cx, y: cy } = stickOrigin.current;
      let dx = (x - cx) / R;
      let dy = (y - cy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) {
        dx /= l;
        dy /= l;
      }
      input.setTouchStick(dx, -dy, HOLDER + id);
      setStick({ pointer: id, cx, cy, kx: dx * R * 0.6, ky: dy * R * 0.6 });
    },
    [input],
  );

  const down = useCallback(
    (id: string, x: number, y: number) => {
      if (bound.current.has(id)) return;
      let best: Control | null = null;
      let bestD = Infinity;
      for (const c of controlsRef.current) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= c.r * 1.15 && d < bestD) {
          best = c;
          bestD = d;
        }
      }
      if (best) {
        // Empty slots stay inert.
        if (best.kind === 'slot' && !best.slot?.moveId) return;
        bound.current.set(id, best);
        input.press(best.action, HOLDER + id);
        syncPressed();
        return;
      }
      const { w: W, h: H, stickR: R } = geom.current;
      if (touch && x < W * 0.42 && !input.touchStickOwner) {
        bound.current.set(id, 'stick');
        // Floating stick: centred under the thumb, kept fully on screen.
        const ox = Math.min(Math.max(x, R + 8), W * 0.42 - R * 0.5);
        const oy = Math.min(Math.max(y, R + 8), H - R - 4);
        moveStick(id, x, y, { x: ox, y: oy });
        return;
      }
      if (dialogueRef.current) {
        bound.current.set(id, 'tap');
        input.tap('light');
      }
    },
    [input, moveStick, syncPressed, touch],
  );

  const move = useCallback(
    (id: string, x: number, y: number) => {
      if (bound.current.get(id) === 'stick') moveStick(id, x, y);
    },
    [moveStick],
  );

  const up = useCallback(
    (id: string) => {
      const b = bound.current.get(id);
      if (!b) return;
      bound.current.delete(id);
      if (b === 'stick') {
        if (input.touchStickOwner === HOLDER + id) input.setTouchStick(0, 0, null);
        setStick({ pointer: null, cx: 0, cy: 0, kx: 0, ky: 0 });
      } else if (b !== 'tap') {
        input.release(b.action, HOLDER + id);
        syncPressed();
      }
    },
    [input, syncPressed],
  );

  // Losing focus releases every finger; so does unmounting the layer.
  useEffect(() => {
    const map = bound.current;
    return () => {
      map.clear();
      input.releaseHolders(HOLDER);
    };
  }, [input]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') releaseAllTouches();
    });
    if (Platform.OS !== 'web' || typeof window === 'undefined') return () => sub.remove();
    const onHide = (): void => {
      if (document.visibilityState !== 'visible') releaseAllTouches();
    };
    window.addEventListener('blur', releaseAllTouches);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      sub.remove();
      window.removeEventListener('blur', releaseAllTouches);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [releaseAllTouches]);

  // Web: DOM pointer events with capture, so a finger sliding off its button
  // still delivers its pointerup to us.
  const layerRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = layerRef.current as unknown as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    el.style.touchAction = 'none';
    el.style.userSelect = 'none';
    (el.style as unknown as Record<string, string>).webkitUserSelect = 'none';
    (el.style as unknown as Record<string, string>).webkitTouchCallout = 'none';
    const rect = (): DOMRect => el.getBoundingClientRect();
    const pd = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = rect();
      const id = `p${e.pointerId}`;
      down(id, e.clientX - r.left, e.clientY - r.top);
      if (bound.current.has(id)) {
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Pointer already gone.
        }
      }
    };
    const pm = (e: PointerEvent): void => {
      const id = `p${e.pointerId}`;
      if (!bound.current.has(id)) return;
      e.preventDefault();
      const r = rect();
      move(id, e.clientX - r.left, e.clientY - r.top);
    };
    const pu = (e: PointerEvent): void => up(`p${e.pointerId}`);
    const block = (e: Event): void => e.preventDefault();
    el.addEventListener('pointerdown', pd, { passive: false });
    el.addEventListener('pointermove', pm, { passive: false });
    el.addEventListener('pointerup', pu);
    el.addEventListener('pointercancel', pu);
    el.addEventListener('lostpointercapture', pu);
    el.addEventListener('contextmenu', block);
    el.addEventListener('touchstart', block, { passive: false });
    el.addEventListener('touchmove', block, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', pd);
      el.removeEventListener('pointermove', pm);
      el.removeEventListener('pointerup', pu);
      el.removeEventListener('pointercancel', pu);
      el.removeEventListener('lostpointercapture', pu);
      el.removeEventListener('contextmenu', block);
      el.removeEventListener('touchstart', block);
      el.removeEventListener('touchmove', block);
    };
  }, [down, move, up]);

  const native =
    Platform.OS === 'web'
      ? {}
      : {
          onTouchStart: (e: GestureResponderEvent) => {
            for (const t of e.nativeEvent.changedTouches) down(`t${t.identifier}`, t.pageX, t.pageY);
          },
          onTouchMove: (e: GestureResponderEvent) => {
            for (const t of e.nativeEvent.changedTouches) move(`t${t.identifier}`, t.pageX, t.pageY);
          },
          onTouchEnd: (e: GestureResponderEvent) => {
            for (const t of e.nativeEvent.changedTouches) up(`t${t.identifier}`);
          },
          onTouchCancel: (e: GestureResponderEvent) => {
            for (const t of e.nativeEvent.changedTouches) up(`t${t.identifier}`);
          },
        };

  const showCaptions = fine || !touch;
  const caption = (a: BindAction): string | null => (showCaptions ? keyCaption(game.settings.bindings[a]) : null);
  const R = stickR;
  const sc = stick.pointer ? { x: stick.cx, y: stick.cy } : stickHome;

  return (
    <View ref={layerRef} style={StyleSheet.absoluteFill} {...native} testID="touch-layer">
      {touch && (
        <View pointerEvents="none" style={[styles.stickBase, { left: sc.x - R, top: sc.y - R, width: R * 2, height: R * 2, borderRadius: R, opacity: stick.pointer ? 1 : 0.6 }]}>
          <View style={[styles.knob, { width: R * 0.9, height: R * 0.9, borderRadius: R * 0.45, transform: [{ translateX: stick.kx }, { translateY: stick.ky }] }]} />
        </View>
      )}
      {controls.map((c) => (
        <ControlFace
          key={c.key}
          c={c}
          pressed={pressed.has(c.key)}
          caption={c.kind === 'button' && touch && !fine ? null : caption(c.action)}
          rage={c.kind === 'limit' ? (ui.limit?.rage ?? 0) : 0}
          limitReady={c.kind === 'limit' && !!ui.limit?.ready}
          focus={c.kind === 'focus' ? ui.focus : null}
          charging={c.action === 'charge' && ui.status.charging}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stickBase: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(10,10,30,0.3)', alignItems: 'center', justifyContent: 'center' },
  knob: { backgroundColor: 'rgba(255,255,255,0.45)' },
  face: { position: 'absolute', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  rageFill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  cdFill: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  kiTag: { position: 'absolute', bottom: 1, alignSelf: 'center' },
  caption: { position: 'absolute', top: 0, right: 3 },
});
