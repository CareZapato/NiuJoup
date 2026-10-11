import type { ButtonId } from './content/types';

export type BindAction =
  | ButtonId
  | 'stickUp'
  | 'stickDown'
  | 'stickLeft'
  | 'stickRight'
  | 'focus'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'camLeft'
  | 'camRight'
  | 'nextAlly'
  | 'nextTarget'
  | 'menu'
  | 'debug';

export const SLOT_ACTIONS = ['slot1', 'slot2', 'slot3', 'slot4'] as const satisfies readonly BindAction[];

export const BIND_LABELS: Record<BindAction, string> = {
  stickUp: 'Mover arriba',
  stickDown: 'Mover abajo',
  stickLeft: 'Mover izquierda',
  stickRight: 'Mover derecha',
  light: 'Golpe / Interactuar',
  heavy: 'Golpe fuerte / Patada',
  ki: 'Ráfaga de ki',
  guard: 'Defender',
  charge: 'Cargar ki',
  dash: 'Esquivar / Correr',
  up: 'Saltar / Ascender',
  down: 'Descender',
  focus: 'Concentración',
  slot1: 'Técnica 1',
  slot2: 'Técnica 2',
  slot3: 'Técnica 3',
  slot4: 'Técnica 4',
  camLeft: 'Cámara izquierda',
  camRight: 'Cámara derecha',
  nextAlly: 'Siguiente aliado',
  nextTarget: 'Siguiente objetivo',
  special: 'Límite',
  menu: 'Menú',
  debug: 'Modo debug',
};

export const DEFAULT_BINDINGS: Record<BindAction, string> = {
  stickUp: 'KeyW',
  stickDown: 'KeyS',
  stickLeft: 'KeyA',
  stickRight: 'KeyD',
  light: 'KeyJ',
  heavy: 'KeyK',
  ki: 'KeyL',
  guard: 'KeyU',
  charge: 'KeyI',
  dash: 'ShiftLeft',
  up: 'Space',
  down: 'ControlLeft',
  focus: 'KeyF',
  slot1: 'Digit1',
  slot2: 'Digit2',
  slot3: 'Digit3',
  slot4: 'Digit4',
  camLeft: 'KeyQ',
  camRight: 'KeyE',
  nextAlly: 'Tab',
  nextTarget: 'KeyR',
  special: 'KeyG',
  menu: 'Escape',
  debug: 'Backquote',
};

/** Always-on secondary keys (not remappable) for convenience. */
export const SECONDARY_BINDINGS: Record<string, BindAction> = {
  ArrowUp: 'stickUp',
  ArrowDown: 'stickDown',
  ArrowLeft: 'stickLeft',
  ArrowRight: 'stickRight',
  ShiftRight: 'dash',
  ControlRight: 'down',
  Numpad1: 'slot1',
  Numpad2: 'slot2',
  Numpad3: 'slot3',
  Numpad4: 'slot4',
  F3: 'debug',
};

/** Short key caption shown as secondary text on PC buttons ("KeyJ" -> "J"). */
export function keyCaption(code: string | undefined): string {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', Space: 'Espacio', Escape: 'Esc', Tab: 'Tab', Backquote: '`' };
  return map[code] ?? code;
}

export interface Settings {
  bindings: Record<BindAction, string>;
  touchControls: 'auto' | 'on' | 'off';
  buttonScale: number;
  joystickSensitivity: number;
  /** Multiplies command input windows (accessibility). */
  inputWindowMultiplier: number;
  reducedMotion: boolean;
  reduceFlashes: boolean;
  cameraSmoothing: number;
  quality: 'high' | 'low';
  showFps: boolean;
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  bindings: { ...DEFAULT_BINDINGS },
  touchControls: 'auto',
  buttonScale: 1,
  joystickSensitivity: 1,
  inputWindowMultiplier: 1,
  reducedMotion: false,
  reduceFlashes: false,
  cameraSmoothing: 9,
  quality: 'high',
  showFps: false,
  debug: false,
};

export function mergeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS, bindings: { ...DEFAULT_BINDINGS } };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Partial<Settings>;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (k === 'bindings') continue;
    if (r[k] !== undefined && typeof r[k] === typeof DEFAULT_SETTINGS[k]) (s as Record<string, unknown>)[k] = r[k];
  }
  if (r.bindings && typeof r.bindings === 'object') {
    const saved = r.bindings as Record<string, unknown>;
    for (const k of Object.keys(DEFAULT_BINDINGS) as BindAction[]) {
      const v = saved[k];
      if (typeof v === 'string') s.bindings[k] = v;
    }
    // Settings saved before focus existed bound F to the old Meteo special.
    if (saved.focus === undefined && saved.special === 'KeyF') s.bindings.special = DEFAULT_BINDINGS.special;
  }
  return s;
}
