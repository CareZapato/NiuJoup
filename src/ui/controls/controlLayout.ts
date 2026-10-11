import { SLOT_ACTIONS, type BindAction } from '../../game/settings';

export type ControlKind = 'button' | 'slot' | 'limit' | 'focus';

export interface PlacedControl {
  key: string;
  kind: ControlKind;
  action: BindAction;
  x: number;
  y: number;
  r: number;
  /** Index into the technique slot list, when `kind === 'slot'`. */
  slotIndex?: number;
}

export interface ControlLayout {
  controls: PlacedControl[];
  /** Resting joystick. Null when the on-screen stick is hidden (keyboard). */
  stick: { x: number; y: number; r: number } | null;
}

export interface LayoutInput {
  combat: boolean;
  slotCount: number;
  hasLimit: boolean;
  w: number;
  h: number;
  insets: { left: number; right: number; top: number; bottom: number };
  /** Player preference. The layout shrinks below this so buttons never overlap. */
  scale: number;
  touch: boolean;
}

interface AttackCell {
  key: string;
  action: BindAction;
  col: number;
  row: number;
}

const GAP_U = 0.28;
const STICK_U = 1.22;
const SLOT_U = 0.9;
const UTIL_U = 0.58;
const FLY_U = 0.74;

/** True when two circles (plus padding) intersect. */
export function controlsOverlap(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }, pad = 4): boolean {
  const need = a.r + b.r + pad;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy < need * need;
}

function attackCells(combat: boolean, cols: number): AttackCell[] {
  if (cols === 3) {
    return combat
      ? [
          { key: 'dash', action: 'dash', col: 0, row: 0 },
          { key: 'heavy', action: 'heavy', col: 1, row: 0 },
          { key: 'light', action: 'light', col: 2, row: 0 },
          { key: 'charge', action: 'charge', col: 0, row: 1 },
          { key: 'guard', action: 'guard', col: 1, row: 1 },
          { key: 'ki', action: 'ki', col: 2, row: 1 },
        ]
      : [
          { key: 'dash', action: 'dash', col: 0, row: 0 },
          { key: 'up', action: 'up', col: 1, row: 0 },
          { key: 'light', action: 'light', col: 2, row: 0 },
          { key: 'charge', action: 'charge', col: 0, row: 1 },
          { key: 'ki', action: 'ki', col: 2, row: 1 },
        ];
  }
  return combat
    ? [
        { key: 'dash', action: 'dash', col: 0, row: 0 },
        { key: 'light', action: 'light', col: 1, row: 0 },
        { key: 'heavy', action: 'heavy', col: 0, row: 1 },
        { key: 'ki', action: 'ki', col: 1, row: 1 },
        { key: 'charge', action: 'charge', col: 0, row: 2 },
        { key: 'guard', action: 'guard', col: 1, row: 2 },
      ]
    : [
        { key: 'dash', action: 'dash', col: 0, row: 0 },
        { key: 'light', action: 'light', col: 1, row: 0 },
        { key: 'up', action: 'up', col: 0, row: 1 },
        { key: 'ki', action: 'ki', col: 1, row: 1 },
        { key: 'charge', action: 'charge', col: 0, row: 2 },
      ];
}

interface RowItem {
  key: string;
  kind: ControlKind;
  action: BindAction;
  slotIndex?: number;
}

function techniqueRow(combat: boolean, slotCount: number, hasLimit: boolean): RowItem[] {
  const row: RowItem[] = [];
  if (combat) row.push({ key: 'focus', kind: 'focus', action: 'focus' });
  for (let i = 0; i < slotCount; i++) row.push({ key: `slot${i}`, kind: 'slot', action: SLOT_ACTIONS[i] ?? 'slot1', slotIndex: i });
  if (combat && hasLimit) row.push({ key: 'limit', kind: 'limit', action: 'special' });
  return row;
}

function placeRow(items: RowItem[], right: number, y: number, r: number, gap: number): PlacedControl[] {
  const step = r * 2 + gap;
  const width = items.length * step - gap;
  const left = right - width;
  return items.map((item, i) => ({
    key: item.key,
    kind: item.kind,
    action: item.action,
    slotIndex: item.slotIndex,
    x: left + r + i * step,
    y,
    r,
  }));
}

/**
 * On-screen controls for keyboard, landscape and portrait.
 * Every radius is derived from one size that is capped by the free space, so
 * circles keep a gap on a phone held either way and on a wide desktop window.
 */
export function layoutControls(input: LayoutInput): ControlLayout {
  const { combat, slotCount, hasLimit, w, h, insets, scale, touch } = input;
  const safeL = insets.left + 8;
  const safeR = Math.max(safeL + 80, w - insets.right - 8);
  const safeB = Math.max(insets.top + 80, h - insets.bottom - 8);
  const portrait = h > w;
  const row = techniqueRow(combat, slotCount, hasLimit);

  if (!touch) {
    const availW = safeR - safeL;
    const gap = 10;
    const fit = row.length > 0 ? (availW - gap * (row.length - 1)) / (row.length * 2) : 36;
    const r = Math.max(16, Math.min(36 * scale, fit));
    return { controls: placeRow(row, safeR, safeB - r, r, gap), stick: null };
  }

  const cols = portrait ? 2 : 3;
  const attacks = attackCells(combat, cols);
  const rows = Math.max(...attacks.map((a) => a.row)) + 1;
  const gridWU = cols * 2 + (cols - 1) * GAP_U;
  const gridHU = rows * 2 + (rows - 1) * GAP_U;
  const flyHU = combat ? GAP_U + FLY_U * 4 + GAP_U : 0;
  const leftHU = STICK_U * 2 + flyHU;
  const bottomHU = Math.max(gridHU, leftHU);
  const slotsWU = row.length * 2 * SLOT_U + Math.max(0, row.length - 1) * GAP_U;
  const clusterWU = STICK_U * 2 + GAP_U + gridWU;
  const widthU = Math.max(clusterWU, slotsWU, 1);
  const utilCount = combat ? 5 : 2;
  const utilWU = utilCount * 2 * UTIL_U + (utilCount - 1) * GAP_U;
  const heightU = bottomHU + GAP_U + SLOT_U * 2 + GAP_U + UTIL_U * 2;

  const availW = Math.max(1, safeR - safeL);
  // Keep the stack in the lower part of the screen, under the party panel and the minimap.
  const topCut = Math.max(insets.top + 8, portrait ? h * 0.46 : h * 0.52);
  const availH = Math.max(1, safeB - topCut);
  const fit = Math.min(availW / Math.max(widthU, utilWU), availH / heightU);
  const ar = Math.max(14, Math.min(36 * scale, fit));
  const gap = GAP_U * ar;
  const stickR = STICK_U * ar;
  const slotR = SLOT_U * ar;
  const utilR = UTIL_U * ar;
  const flyR = FLY_U * ar;

  const gridW = cols * 2 * ar + (cols - 1) * gap;
  const gridH = rows * 2 * ar + (rows - 1) * gap;
  const gridLeft = safeR - gridW;
  const stick = { x: safeL + stickR, y: safeB - stickR, r: stickR };

  const controls: PlacedControl[] = attacks.map((a) => ({
    key: a.key,
    kind: 'button' as const,
    action: a.action,
    x: gridLeft + ar + a.col * (2 * ar + gap),
    y: safeB - ar - a.row * (2 * ar + gap),
    r: ar,
  }));

  let blockTop = safeB - gridH;
  if (combat) {
    const downY = stick.y - stick.r - gap - flyR;
    const upY = downY - gap - 2 * flyR;
    controls.push(
      { key: 'down', kind: 'button', action: 'down', x: stick.x, y: downY, r: flyR },
      { key: 'up', kind: 'button', action: 'up', x: stick.x, y: upY, r: flyR },
    );
    blockTop = Math.min(blockTop, upY - flyR);
  } else {
    blockTop = Math.min(blockTop, stick.y - stick.r);
  }

  const slotY = blockTop - gap - slotR;
  controls.push(...placeRow(row, safeR, slotY, slotR, gap));

  const util: RowItem[] = [
    { key: 'nextAlly', kind: 'button', action: 'nextAlly' },
    ...(combat
      ? ([
          { key: 'nextTarget', kind: 'button', action: 'nextTarget' },
          { key: 'camLeft', kind: 'button', action: 'camLeft' },
          { key: 'camRight', kind: 'button', action: 'camRight' },
        ] as RowItem[])
      : []),
    { key: 'menu', kind: 'button', action: 'menu' },
  ];
  const utilY = slotY - slotR - gap - utilR;
  controls.push(...placeRow(util, safeR, utilY, utilR, gap));

  return { controls, stick };
}
