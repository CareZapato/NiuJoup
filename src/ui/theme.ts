export const FONT = {
  body: 'VT323_400Regular',
  title: 'PressStart2P_400Regular',
};

export const COLORS = {
  panel: 'rgba(12, 14, 34, 0.82)',
  panelSolid: '#0c0e22',
  border: '#f2c84a',
  borderDim: '#5a5a8a',
  text: '#f4f0e0',
  dim: '#9a9ab8',
  hp: '#4ad86a',
  hpLow: '#e8443a',
  ki: '#4ab8f2',
  xp: '#c89aff',
  rage: '#ff7a2a',
  player: '#4ab8ff',
  enemy: '#ff5a4a',
  gold: '#f2c84a',
  good: '#8aff8a',
  warn: '#ff8a6a',
  quest: '#ffe07a',
};

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
