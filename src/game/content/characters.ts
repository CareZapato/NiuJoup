import { BALANCE } from './balance';
import type { AppearanceDef, CharacterDef, EnemyDef } from './types';

const BASIC_MOVES = ['light_1', 'light_2', 'heavy_finisher', 'heavy', 'ki_blast'];
const KI = BALANCE.ki.baseMax;

/**
 * Playable heroes. Internal ids are stable save keys from earlier builds and
 * never shown to the player: kaien = Goku, oren = Krillin, suri = Yamcha.
 * Visible names come only from `name`.
 */
export const CHARACTERS: Record<string, CharacterDef> = {
  kaien: {
    id: 'kaien',
    name: 'Goku',
    archetype: 'Luchador Saiyajin',
    description: 'Discípulo de la Escuela Tortuga. Equilibrado, con el Kamehameha desde el principio.',
    baseStats: { maxHp: 120, maxKi: KI, physicalAttack: 14, kiAttack: 13, physicalDefense: 10, kiDefense: 10, speed: 11, technique: 10, criticalRate: 0.08, evasion: 0.05, stamina: 100 },
    growth: { maxHp: 12, maxKi: 5, physicalAttack: 1.6, kiAttack: 1.5, physicalDefense: 1.2, kiDefense: 1.2, speed: 0.3, technique: 0.4 },
    appearance: {
      palette: { skin: 0xf6c49a, hair: 0x14121a, outfit: 0xf07a1e, outfitDark: 0xb8500e, accent: 0x2346a8, boots: 0x1f3a8c, aura: 0xfff07a },
      hairStyle: 'goku',
      build: 'normal',
      // 175 cm de referencia. Krillin y Yamcha se apartan de esta escala.
      scale: 1,
      hero: 'goku',
    },
    innateMoves: BASIC_MOVES,
    skillTree: 'goku',
    aiStyle: 'balanced',
    meteoMoveId: 'meteo_strike',
    jointPartners: [],
    transformations: [],
    startingSlots: ['kamehameha', null, null, null],
    limitMoveId: 'ki_volley',
    mandatoryTechniques: ['kamehameha'],
  },
  oren: {
    id: 'oren',
    name: 'Krillin',
    archetype: 'Especialista en técnicas',
    description: 'Compañero de Goku en la Escuela Tortuga. Bajo y compacto; domina el Kienzan y el Taiyōken.',
    baseStats: { maxHp: 105, maxKi: KI, physicalAttack: 11, kiAttack: 15, physicalDefense: 9, kiDefense: 12, speed: 11, technique: 13, criticalRate: 0.1, evasion: 0.07, stamina: 95 },
    growth: { maxHp: 10, maxKi: 6, physicalAttack: 1.2, kiAttack: 1.8, physicalDefense: 1, kiDefense: 1.3, speed: 0.3, technique: 0.6 },
    appearance: {
      palette: { skin: 0xf3c29c, hair: 0x000000, outfit: 0xf07a1e, outfitDark: 0xb8500e, accent: 0x2346a8, boots: 0x1f3a8c, aura: 0xfff4c0 },
      hairStyle: 'krillin',
      build: 'short',
      // 153 cm. Más bajo que el 87% real: con la cabeza grande, si no, se confunde con Goku.
      scale: 0.76,
      hero: 'krillin',
    },
    innateMoves: BASIC_MOVES,
    skillTree: 'krillin',
    aiStyle: 'zoner',
    meteoMoveId: 'meteo_strike',
    jointPartners: [],
    transformations: [],
    startingSlots: ['kienzan', null, null, null],
    limitMoveId: 'renzoku_kienzan',
    mandatoryTechniques: ['kienzan', 'taiyoken'],
  },
  suri: {
    id: 'suri',
    name: 'Yamcha',
    archetype: 'Luchador veloz',
    description: 'Antiguo bandido del desierto. Rápido y agresivo; ataca con el Rōgafūfūken y guía el Sōkidan.',
    baseStats: { maxHp: 110, maxKi: KI, physicalAttack: 14, kiAttack: 11, physicalDefense: 9, kiDefense: 9, speed: 13, technique: 12, criticalRate: 0.13, evasion: 0.09, stamina: 110 },
    growth: { maxHp: 11, maxKi: 5, physicalAttack: 1.6, kiAttack: 1.2, physicalDefense: 1, kiDefense: 1, speed: 0.4, technique: 0.5 },
    appearance: {
      palette: { skin: 0xeab48c, hair: 0x14121a, outfit: 0xf07a1e, outfitDark: 0xb8500e, accent: 0x2346a8, boots: 0x1f3a8c, aura: 0xc8f0ff },
      hairStyle: 'yamcha',
      build: 'normal',
      // 183 cm. Un poco más alto que Goku, sin dejar de ser el mismo tipo de sprite.
      scale: 1.12,
      hero: 'yamcha',
    },
    innateMoves: BASIC_MOVES,
    skillTree: 'yamcha',
    aiStyle: 'rushdown',
    meteoMoveId: 'meteo_strike',
    jointPartners: [],
    transformations: [],
    startingSlots: ['rogafufuken', null, null, null],
    limitMoveId: 'shin_rogafufuken',
    mandatoryTechniques: ['rogafufuken', 'sokidan'],
  },
};

/** Ids that existed in earlier saves but are no longer playable. */
export const RETIRED_CHARACTERS = ['toren'];

export const ENEMIES: Record<string, EnemyDef> = {
  sprout: {
    id: 'sprout',
    name: 'Brote salvaje',
    level: 1,
    baseStats: { maxHp: 150, maxKi: 60, physicalAttack: 10, kiAttack: 7, physicalDefense: 7, kiDefense: 5, speed: 8, technique: 6, criticalRate: 0.03, evasion: 0.02, stamina: 80 },
    appearance: {
      palette: { skin: 0x6ac24a, hair: 0x3a8a2a, outfit: 0x4a9a3a, outfitDark: 0x2a6a22, accent: 0xf26a8a, boots: 0x2a4a1a, aura: 0xaaff7a },
      hairStyle: 'leaf',
      build: 'slim',
      scale: 0.85,
    },
    moves: ['light_1', 'light_2', 'heavy', 'ki_blast'],
    aiStyle: 'rushdown',
    xp: 30,
    ap: 1,
    money: 8,
    lootTable: 'sprout',
    detectRadius: 6,
    persistentDefeat: false,
    respawnSeconds: 90,
  },
  bandit: {
    id: 'bandit',
    name: 'Bandido del valle',
    level: 3,
    baseStats: { maxHp: 220, maxKi: 80, physicalAttack: 12, kiAttack: 9, physicalDefense: 9, kiDefense: 7, speed: 9, technique: 8, criticalRate: 0.06, evasion: 0.04, stamina: 100 },
    appearance: {
      palette: { skin: 0xe0a87a, hair: 0x2a2a2a, outfit: 0x8a3a3a, outfitDark: 0x5a2222, accent: 0xd83a3a, boots: 0x2a2a2a, aura: 0xff6a4a },
      hairStyle: 'bandana',
      build: 'normal',
      scale: 1,
    },
    moves: ['light_1', 'light_2', 'heavy_finisher', 'heavy', 'ki_blast', 'launcher'],
    aiStyle: 'balanced',
    xp: 55,
    ap: 2,
    money: 20,
    lootTable: 'bandit',
    detectRadius: 7,
    persistentDefeat: false,
    respawnSeconds: 120,
  },
  golem: {
    id: 'golem',
    name: 'Dinosaurio del risco',
    level: 5,
    baseStats: { maxHp: 700, maxKi: 120, physicalAttack: 17, kiAttack: 11, physicalDefense: 15, kiDefense: 10, speed: 7, technique: 9, criticalRate: 0.05, evasion: 0, stamina: 200 },
    appearance: {
      palette: { skin: 0x8a8a96, hair: 0x5a5a66, outfit: 0x6a6a76, outfitDark: 0x45454f, accent: 0x6af2ff, boots: 0x3a3a44, aura: 0x6af2ff },
      hairStyle: 'stone',
      build: 'huge',
      // El atlas lo deja a la altura de un héroe. Esta escala lo pone al doble que Goku.
      scale: 2,
    },
    moves: ['light_1', 'light_2', 'heavy_finisher', 'heavy', 'ki_blast', 'meteor_impact', 'ki_wave'],
    aiStyle: 'brute',
    xp: 300,
    ap: 5,
    money: 150,
    lootTable: 'golem',
    detectRadius: 7,
    persistentDefeat: true,
    respawnSeconds: 0,
  },
};

export const STARTING_PARTY = ['kaien', 'oren', 'suri'];

export const NPC_APPEARANCES: Record<string, AppearanceDef> = {
  master: {
    palette: { skin: 0xe8b890, hair: 0xf0f0f0, outfit: 0xc84a3a, outfitDark: 0x8a2a22, accent: 0xf2d24a, boots: 0x4a3a2a, aura: 0xffffff },
    hairStyle: 'bald',
    build: 'normal',
    scale: 0.92,
  },
  villager: {
    palette: { skin: 0xf2c69a, hair: 0x8a5a2a, outfit: 0x5a8ac8, outfitDark: 0x3a5a8a, accent: 0xf2f2f2, boots: 0x5a3a2a, aura: 0xffffff },
    hairStyle: 'ponytail',
    build: 'slim',
    scale: 0.9,
  },
  smith: {
    palette: { skin: 0xc68a5e, hair: 0x3a2a1a, outfit: 0x7a5a3a, outfitDark: 0x4a3a22, accent: 0x9a9aa2, boots: 0x2a2a2a, aura: 0xffffff },
    hairStyle: 'spiky',
    build: 'broad',
    scale: 1,
  },
};
