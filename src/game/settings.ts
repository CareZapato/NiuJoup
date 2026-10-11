import type { ButtonId } from './content/types';

export type BindAction =
  | ButtonId
  | 'stickUp'
  | 'stickDown'
  | 'stickLeft'
  | 'stickRight'
  | 'camLeft'
  | 'camRight'
  | 'nextAlly'
  | 'nextTarget'
  | 'menu'
  | 'debug';

export const BIND_LABELS: Record<BindAction, string> = {
  stickUp: 'Mover arriba',
  stickDown: 'Mover abajo',
  stickLeft: 'Mover izquierda',
  stickRight: 'Mover derecha',
  light: 'Ataque ligero / Interactuar',
  heavy: 'Ataque fuerte',
  ki: 'Ki',
  guard: 'Defender',
  charge: 'Cargar Ki',
  dash: 'Dash / Correr',
  up: 'Saltar / Ascender',
  down: 'Descender',
  camLeft: 'Cámara izquierda',
  camRight: 'Cámara derecha',
  nextAlly: 'Siguiente aliado',
  nextTarget: 'Siguiente objetivo',
  special: 'Especial (Meteo)',
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
  camLeft: 'KeyQ',
  camRight: 'KeyE',
  nextAlly: 'Tab',
  nextTarget: 'KeyR',
  special: 'KeyF',
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
  F3: 'debug',
};

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
    for (const k of Object.keys(DEFAULT_BINDINGS) as BindAction[]) {
      const v = (r.bindings as Record<string, unknown>)[k];
      if (typeof v === 'string') s.bindings[k] = v;
    }
  }
  return s;
}
