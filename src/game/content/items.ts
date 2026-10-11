import type { ItemDef, LootTableDef, QuestDef } from './types';

export const ITEMS: Record<string, ItemDef> = {
  herb: { id: 'herb', name: 'Hierba curativa', type: 'consumable', description: 'Recupera 60 PV.', stackable: true, important: false, heal: { hp: 60 }, value: 10 },
  ki_capsule: { id: 'ki_capsule', name: 'Cápsula de Ki', type: 'consumable', description: 'Recupera 50 de Ki.', stackable: true, important: false, heal: { ki: 50 }, value: 15 },
  training_stone: { id: 'training_stone', name: 'Piedra de entrenamiento', type: 'quest', description: 'Piedra marcada por el maestro.', stackable: true, important: true, value: 0 },
  iron_wristbands: { id: 'iron_wristbands', name: 'Muñequeras de hierro', type: 'equipment', description: '+3 Ataque físico.', stackable: false, important: true, equip: { slot: 'hands', stats: { physicalAttack: 3 } }, value: 60 },
  reinforced_gi: { id: 'reinforced_gi', name: 'Gi reforzado', type: 'equipment', description: '+3 Def. física, +20 PV.', stackable: false, important: true, equip: { slot: 'body', stats: { physicalDefense: 3, maxHp: 20 } }, value: 80 },
  focus_amulet: { id: 'focus_amulet', name: 'Amuleto de foco', type: 'equipment', description: '+4 Ataque Ki.', stackable: false, important: true, equip: { slot: 'accessory', stats: { kiAttack: 4 } }, value: 120 },
  shrine_key: { id: 'shrine_key', name: 'Llave del santuario', type: 'key', description: 'Abre algo en el valle.', stackable: false, important: true, value: 0 },
  ancient_relic: { id: 'ancient_relic', name: 'Reliquia antigua', type: 'rare', description: 'Un objeto extraño. +5% crítico equipado.', stackable: false, important: true, equip: { slot: 'accessory', stats: { criticalRate: 0.05 } }, value: 300 },
  sprout_fiber: { id: 'sprout_fiber', name: 'Fibra de brote', type: 'material', description: 'Material vegetal resistente.', stackable: true, important: false, value: 3 },
  rock_shard: { id: 'rock_shard', name: 'Esquirla de roca', type: 'material', description: 'Fragmento del gólem.', stackable: true, important: false, value: 12 },
  valley_crystal: { id: 'valley_crystal', name: 'Cristal del valle', type: 'rare', description: 'Brilla con Ki puro.', stackable: true, important: true, value: 200 },
};

export const LOOT_TABLES: Record<string, LootTableDef> = {
  sprout: { id: 'sprout', rolls: 1, emptyWeight: 4, entries: [{ itemId: 'herb', weight: 3, min: 1, max: 1 }, { itemId: 'sprout_fiber', weight: 5, min: 1, max: 2 }] },
  bandit: {
    id: 'bandit',
    rolls: 2,
    emptyWeight: 4,
    entries: [
      { itemId: 'herb', weight: 4, min: 1, max: 2 },
      { itemId: 'ki_capsule', weight: 3, min: 1, max: 1 },
      { itemId: 'iron_wristbands', weight: 1, min: 1, max: 1 },
    ],
  },
  golem: {
    id: 'golem',
    rolls: 2,
    emptyWeight: 0,
    entries: [
      { itemId: 'valley_crystal', weight: 2, min: 1, max: 1 },
      { itemId: 'focus_amulet', weight: 2, min: 1, max: 1 },
      { itemId: 'rock_shard', weight: 4, min: 2, max: 3 },
    ],
  },
};

export const QUESTS: Record<string, QuestDef> = {
  valley_training: {
    id: 'valley_training',
    name: 'Entrenamiento en el valle',
    type: 'story',
    description: 'El maestro quiere comprobar tus progresos.',
    giverNpcId: 'master',
    objectives: [
      { kind: 'talk', npcId: 'master', text: 'Habla con el maestro' },
      { kind: 'visit', areaId: 'meadow', text: 'Recorre la pradera' },
      { kind: 'collect', itemId: 'training_stone', count: 2, text: 'Encuentra 2 piedras de entrenamiento' },
      { kind: 'defeat', enemyId: 'any', count: 3, text: 'Derrota a 3 enemigos' },
      { kind: 'earnAp', amount: 2, text: 'Gana 2 AP' },
      { kind: 'unlockSkill', text: 'Desbloquea una técnica (menú > Habilidades)' },
      { kind: 'defeatBoss', enemyId: 'golem', text: 'Vence al Gólem del risco (meseta sureste)' },
      { kind: 'talk', npcId: 'master', text: 'Regresa con el maestro' },
    ],
    rewards: { xp: 200, ap: 3, money: 100, items: [{ itemId: 'reinforced_gi', count: 1 }] },
  },
  cracked_rock: {
    id: 'cracked_rock',
    name: 'La roca agrietada',
    type: 'exploration',
    description: 'Dicen que tras una roca agrietada al noreste hay algo escondido.',
    giverNpcId: 'villager_a',
    objectives: [{ kind: 'visit', areaId: 'secret', text: 'Encuentra la zona oculta tras la roca' }],
    rewards: { xp: 80, ap: 1, money: 50, items: [] },
  },
};
