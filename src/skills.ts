export interface TimedCommand {
  command: string;
  delayMs?: number;
}

export interface SkillRunOptions {
  player: string;
  material?: string;
  size?: number;
  direction?: 'north' | 'south' | 'east' | 'west';
}

export interface SkillDefinition {
  name: string;
  description: string;
  commands: TimedCommand[];
}

export const SKILL_DESCRIPTIONS: Record<string, string> = {
  partyMode: 'Fireworks, particles, sounds, and celebration titles.',
  spleefArena: 'Builds a snow spleef platform over a pit, gives shovels, and announces the rules.',
  mobBattle: 'Builds a small arena and summons two sides for a quick spectacle.',
  parkourCourse: 'Creates a short randomized floating parkour path.',
  rainbowBridge: 'Builds a colored glass bridge from the player position.',
  nycCity: 'Builds a New York-inspired city with roads, skyscrapers, a park, bridge, lights, and a statue.',
  castleLair: 'Builds a large castle with walls, towers, gate, throne room, and a secret underground lair.',
  enchantGear: 'Gives max-enchanted armor, tools, food, and utility items.',
  lightShow: 'Runs a choreographed sequence of particles, lightning, sounds, and fireworks.',
  protectBase: 'Creates a protective glass dome outline, lights, guards, and a simple moat.',
};

const RAINBOW_GLASS = [
  'red_stained_glass',
  'orange_stained_glass',
  'yellow_stained_glass',
  'lime_stained_glass',
  'light_blue_stained_glass',
  'blue_stained_glass',
  'purple_stained_glass',
];

const FIREWORK_NBT =
  '{LifeTime:20}';

function sanitizeTarget(player: string): string {
  if (/^[A-Za-z0-9_]{1,16}$/.test(player)) return player;
  return '@p';
}

function sanitizeMaterial(material: string | undefined, fallback: string): string {
  if (!material) return fallback;
  if (/^[a-z0-9_:.]+(\[[a-z0-9_=,]+])?$/i.test(material)) return material;
  return fallback;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}

function at(player: string, command: string, delayMs?: number): TimedCommand {
  return { command: `/execute at ${player} run ${command}`, delayMs };
}

function firework(player: string, x: number, y: number, z: number, delayMs?: number): TimedCommand {
  return at(player, `summon firework_rocket ~${x} ~${y} ~${z} ${FIREWORK_NBT}`, delayMs);
}

function buildRainbowBridge(player: string, direction: SkillRunOptions['direction'], size: number): TimedCommand[] {
  const length = clampInt(size, 8, 32, 18);
  const dir = direction || 'east';
  const commands: TimedCommand[] = [];

  for (let i = 1; i <= length; i++) {
    const block = RAINBOW_GLASS[(i - 1) % RAINBOW_GLASS.length];
    const halfWidth = 1;

    if (dir === 'east' || dir === 'west') {
      const x = dir === 'east' ? i : -i;
      commands.push(at(player, `fill ~${x} ~0 ~-${halfWidth} ~${x} ~0 ~${halfWidth} ${block}`));
      continue;
    }

    const z = dir === 'south' ? i : -i;
    commands.push(at(player, `fill ~-${halfWidth} ~0 ~${z} ~${halfWidth} ~0 ~${z} ${block}`));
  }

  commands.push(at(player, 'particle end_rod ~ ~1 ~ 2 1 2 0.01 80 force', 250));
  return commands;
}

function buildParkour(player: string, size: number): TimedCommand[] {
  const jumps = clampInt(size, 6, 18, 10);
  const blocks = ['lime_concrete', 'yellow_concrete', 'orange_concrete', 'red_concrete', 'blue_concrete'];
  const commands: TimedCommand[] = [
    at(player, 'setblock ~1 ~0 ~ emerald_block'),
    at(player, 'setblock ~1 ~1 ~ lime_concrete'),
  ];

  let x = 2;
  let z = 0;
  let y = 1;
  for (let i = 0; i < jumps; i++) {
    x += 2 + (i % 2);
    z += i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0;
    y += i % 4 === 0 ? 1 : 0;
    commands.push(at(player, `setblock ~${x} ~${y} ~${z} ${blocks[i % blocks.length]}`));
  }

  commands.push(at(player, `setblock ~${x + 3} ~${y} ~${z} diamond_block`));
  commands.push(at(player, `summon firework_rocket ~${x + 3} ~${y + 1} ~${z} ${FIREWORK_NBT}`, 300));
  return commands;
}

function buildNycCity(player: string): TimedCommand[] {
  const commands: TimedCommand[] = [
    { command: '/time set night' },
    { command: '/weather clear' },
    { command: '/gamerule doDaylightCycle false' },
    { command: '/title @a title {"text":"AIGuy City Build","color":"gold","bold":true}' },
    { command: '/title @a subtitle {"text":"Roads, towers, park, bridge, and skyline incoming","color":"white"}' },
    at(player, 'fill ~-55 ~-1 ~-55 ~55 ~-1 ~55 grass_block'),
  ];

  const avenues = [-50, -35, -20, -5, 10, 25, 40, 55];
  for (const x of avenues) {
    commands.push(at(player, `fill ~${x - 2} ~0 ~-55 ~${x + 2} ~0 ~55 gray_concrete`));
    commands.push(at(player, `fill ~${x} ~1 ~-55 ~${x} ~1 ~55 yellow_concrete`));
  }

  const streets = [-50, -35, -20, -5, 10, 25, 40, 55];
  for (const z of streets) {
    commands.push(at(player, `fill ~-55 ~0 ~${z - 2} ~55 ~0 ~${z + 2} gray_concrete`));
    commands.push(at(player, `fill ~-55 ~1 ~${z} ~55 ~1 ~${z} yellow_concrete`));
  }

  const towers = [
    { x1: -49, z1: -49, x2: -42, z2: -42, h: 28, wall: 'deepslate_tiles', window: 'light_blue_stained_glass', roof: 'sea_lantern' },
    { x1: -31, z1: -49, x2: -23, z2: -41, h: 20, wall: 'white_concrete', window: 'cyan_stained_glass', roof: 'quartz_block' },
    { x1: -1, z1: -49, x2: 7, z2: -41, h: 36, wall: 'blackstone', window: 'yellow_stained_glass', roof: 'gold_block' },
    { x1: 15, z1: -49, x2: 23, z2: -42, h: 24, wall: 'stone_bricks', window: 'light_gray_stained_glass', roof: 'smooth_stone' },
    { x1: 31, z1: -49, x2: 39, z2: -41, h: 31, wall: 'gray_concrete', window: 'blue_stained_glass', roof: 'sea_lantern' },
    { x1: -49, z1: -31, x2: -41, z2: -23, h: 22, wall: 'light_gray_concrete', window: 'black_stained_glass', roof: 'iron_block' },
    { x1: -17, z1: -31, x2: -10, z2: -24, h: 34, wall: 'polished_deepslate', window: 'lime_stained_glass', roof: 'diamond_block' },
    { x1: 15, z1: -31, x2: 23, z2: -23, h: 29, wall: 'cut_copper', window: 'orange_stained_glass', roof: 'oxidized_copper' },
    { x1: 31, z1: -31, x2: 39, z2: -23, h: 18, wall: 'bricks', window: 'glass', roof: 'red_concrete' },
    { x1: -49, z1: -1, x2: -41, z2: 7, h: 26, wall: 'smooth_stone', window: 'light_blue_stained_glass', roof: 'lantern' },
    { x1: -31, z1: -1, x2: -23, z2: 7, h: 16, wall: 'quartz_block', window: 'blue_stained_glass', roof: 'sea_lantern' },
    { x1: 15, z1: -1, x2: 23, z2: 7, h: 38, wall: 'deepslate_bricks', window: 'yellow_stained_glass', roof: 'beacon' },
    { x1: 31, z1: -1, x2: 39, z2: 7, h: 21, wall: 'stone', window: 'cyan_stained_glass', roof: 'smooth_stone_slab' },
    { x1: -49, z1: 15, x2: -41, z2: 23, h: 19, wall: 'brown_concrete', window: 'glass', roof: 'spruce_planks' },
    { x1: -31, z1: 15, x2: -23, z2: 23, h: 27, wall: 'calcite', window: 'light_blue_stained_glass', roof: 'sea_lantern' },
    { x1: -1, z1: 15, x2: 7, z2: 23, h: 32, wall: 'tuff', window: 'white_stained_glass', roof: 'gold_block' },
    { x1: 15, z1: 15, x2: 23, z2: 23, h: 23, wall: 'cyan_terracotta', window: 'blue_stained_glass', roof: 'prismarine' },
    { x1: 31, z1: 15, x2: 39, z2: 23, h: 28, wall: 'nether_bricks', window: 'red_stained_glass', roof: 'glowstone' },
    { x1: -49, z1: 31, x2: -41, z2: 39, h: 25, wall: 'andesite', window: 'gray_stained_glass', roof: 'iron_block' },
    { x1: -17, z1: 31, x2: -10, z2: 39, h: 30, wall: 'black_concrete', window: 'yellow_stained_glass', roof: 'sea_lantern' },
    { x1: 15, z1: 31, x2: 23, z2: 39, h: 17, wall: 'smooth_quartz', window: 'light_blue_stained_glass', roof: 'quartz_slab' },
    { x1: 31, z1: 31, x2: 39, z2: 39, h: 35, wall: 'polished_blackstone_bricks', window: 'purple_stained_glass', roof: 'end_rod' },
  ];

  for (const tower of towers) {
    commands.push(at(player, `fill ~${tower.x1} ~1 ~${tower.z1} ~${tower.x2} ~${tower.h} ~${tower.z2} ${tower.wall}`));
    commands.push(at(player, `fill ~${tower.x1 + 1} ~2 ~${tower.z1} ~${tower.x2 - 1} ~${tower.h - 2} ~${tower.z1} ${tower.window}`));
    commands.push(at(player, `fill ~${tower.x1 + 1} ~2 ~${tower.z2} ~${tower.x2 - 1} ~${tower.h - 2} ~${tower.z2} ${tower.window}`));
    commands.push(at(player, `fill ~${tower.x1} ~${tower.h + 1} ~${tower.z1} ~${tower.x2} ~${tower.h + 1} ~${tower.z2} ${tower.roof}`));
  }

  commands.push(
    at(player, 'fill ~-18 ~1 ~-18 ~8 ~1 ~8 grass_block'),
    at(player, 'fill ~-16 ~2 ~-16 ~6 ~2 ~6 moss_block'),
    at(player, 'fill ~-14 ~2 ~-2 ~-4 ~2 ~4 water'),
    at(player, 'fill ~-2 ~2 ~-14 ~4 ~2 ~-8 dandelion'),
    at(player, 'setblock ~-15 ~3 ~-15 oak_log'),
    at(player, 'fill ~-17 ~6 ~-17 ~-13 ~8 ~-13 oak_leaves'),
    at(player, 'setblock ~5 ~3 ~-15 birch_log'),
    at(player, 'fill ~3 ~6 ~-17 ~7 ~8 ~-13 birch_leaves'),
    at(player, 'setblock ~-15 ~3 ~5 oak_log'),
    at(player, 'fill ~-17 ~6 ~3 ~-13 ~8 ~7 oak_leaves'),
    at(player, 'setblock ~5 ~3 ~5 birch_log'),
    at(player, 'fill ~3 ~6 ~3 ~7 ~8 ~7 birch_leaves'),
    at(player, 'fill ~45 ~1 ~-50 ~54 ~1 ~-41 sand'),
    at(player, 'fill ~47 ~2 ~-48 ~52 ~4 ~-43 stone_bricks'),
    at(player, 'fill ~49 ~5 ~-46 ~50 ~18 ~-45 oxidized_copper'),
    at(player, 'setblock ~49 ~19 ~-45 oxidized_copper'),
    at(player, 'setblock ~50 ~20 ~-44 glowstone'),
    at(player, 'setblock ~50 ~21 ~-44 fire'),
    at(player, 'fill ~40 ~5 ~-44 ~55 ~5 ~-39 stone_bricks'),
    at(player, 'fill ~40 ~6 ~-44 ~55 ~6 ~-44 iron_bars'),
    at(player, 'fill ~40 ~6 ~-39 ~55 ~6 ~-39 iron_bars'),
    at(player, 'fill ~41 ~1 ~-43 ~42 ~12 ~-42 stone_bricks'),
    at(player, 'fill ~52 ~1 ~-43 ~53 ~12 ~-42 stone_bricks'),
    at(player, 'fill ~-55 ~1 ~45 ~55 ~1 ~55 blue_ice'),
    at(player, 'fill ~-55 ~2 ~44 ~55 ~2 ~44 sea_lantern'),
    at(player, 'fill ~-55 ~2 ~56 ~55 ~2 ~56 sea_lantern'),
    at(player, 'particle end_rod ~ ~12 ~ 45 20 45 0.01 400 force', 250),
    firework(player, -45, 28, -45, 250),
    firework(player, 5, 38, -45, 250),
    firework(player, 19, 40, 3, 250),
    firework(player, 35, 36, 35, 250),
    { command: '/playsound minecraft:entity.firework_rocket.twinkle master @a ~ ~ ~ 1 1' },
    { command: '/title @a title {"text":"NYC Skyline Ready","color":"aqua","bold":true}' },
  );

  return commands;
}

function buildCastleLair(player: string): TimedCommand[] {
  const commands: TimedCommand[] = [
    { command: '/time set day' },
    { command: '/weather clear' },
    { command: '/title @a title {"text":"Castle Build","color":"gold","bold":true}' },
    { command: '/title @a subtitle {"text":"Walls, towers, throne room, and secret lair","color":"white"}' },
    at(player, 'fill ~-28 ~-1 ~-28 ~28 ~-1 ~28 stone_bricks'),
    at(player, 'fill ~-26 ~0 ~-26 ~26 ~12 ~26 stone_bricks outline'),
    at(player, 'fill ~-24 ~1 ~-24 ~24 ~11 ~24 air'),
    at(player, 'fill ~-30 ~0 ~-30 ~-22 ~22 ~-22 cobbled_deepslate'),
    at(player, 'fill ~22 ~0 ~-30 ~30 ~22 ~-22 cobbled_deepslate'),
    at(player, 'fill ~-30 ~0 ~22 ~-22 ~22 ~30 cobbled_deepslate'),
    at(player, 'fill ~22 ~0 ~22 ~30 ~22 ~30 cobbled_deepslate'),
    at(player, 'fill ~-28 ~23 ~-28 ~-24 ~23 ~-24 stone_brick_slab'),
    at(player, 'fill ~24 ~23 ~-28 ~28 ~23 ~-24 stone_brick_slab'),
    at(player, 'fill ~-28 ~23 ~24 ~-24 ~23 ~28 stone_brick_slab'),
    at(player, 'fill ~24 ~23 ~24 ~28 ~23 ~28 stone_brick_slab'),
    at(player, 'fill ~-4 ~0 ~-27 ~4 ~8 ~-27 air'),
    at(player, 'fill ~-5 ~0 ~-28 ~5 ~9 ~-28 dark_oak_planks'),
    at(player, 'fill ~-3 ~0 ~-29 ~3 ~5 ~-29 iron_bars'),
    at(player, 'fill ~-24 ~13 ~-24 ~24 ~13 ~-24 stone_bricks'),
    at(player, 'fill ~-24 ~13 ~24 ~24 ~13 ~24 stone_bricks'),
    at(player, 'fill ~-24 ~13 ~-24 ~-24 ~13 ~24 stone_bricks'),
    at(player, 'fill ~24 ~13 ~-24 ~24 ~13 ~24 stone_bricks'),
    at(player, 'fill ~-20 ~0 ~-18 ~20 ~8 ~12 polished_andesite outline'),
    at(player, 'fill ~-18 ~1 ~-16 ~18 ~7 ~10 air'),
    at(player, 'fill ~-18 ~0 ~-16 ~18 ~0 ~10 red_carpet'),
    at(player, 'fill ~-4 ~1 ~7 ~4 ~4 ~11 gold_block'),
    at(player, 'setblock ~0 ~5 ~11 emerald_block'),
    at(player, 'fill ~-16 ~1 ~-18 ~-16 ~5 ~12 glass_pane'),
    at(player, 'fill ~16 ~1 ~-18 ~16 ~5 ~12 glass_pane'),
    at(player, 'fill ~-12 ~0 ~15 ~12 ~7 ~23 deepslate_tiles outline'),
    at(player, 'fill ~-10 ~1 ~17 ~10 ~6 ~21 air'),
    at(player, 'setblock ~0 ~1 ~17 crafting_table'),
    at(player, 'setblock ~2 ~1 ~17 furnace'),
    at(player, 'setblock ~-2 ~1 ~17 chest'),
    at(player, 'fill ~-10 ~-4 ~-10 ~10 ~-2 ~10 deepslate_bricks outline'),
    at(player, 'fill ~-9 ~-3 ~-9 ~9 ~-2 ~9 air'),
    at(player, 'fill ~-8 ~-4 ~-8 ~8 ~-4 ~8 polished_blackstone'),
    at(player, 'fill ~-2 ~0 ~-2 ~2 ~0 ~2 dark_oak_trapdoor'),
    at(player, 'fill ~-1 ~-1 ~-1 ~1 ~-3 ~1 ladder'),
    at(player, 'setblock ~0 ~-3 ~0 lantern'),
    at(player, 'setblock ~-7 ~-3 ~-7 chest'),
    at(player, 'setblock ~7 ~-3 ~-7 enchanting_table'),
    at(player, 'fill ~5 ~-3 ~5 ~8 ~-3 ~8 redstone_block'),
    at(player, 'fill ~-8 ~-3 ~5 ~-5 ~-3 ~8 bookshelf'),
    at(player, 'setblock ~0 ~-3 ~8 blackstone'),
    at(player, 'setblock ~0 ~-2 ~8 dragon_head'),
    at(player, 'fill ~-32 ~0 ~-32 ~32 ~0 ~32 water outline'),
    at(player, 'fill ~-3 ~0 ~-34 ~3 ~0 ~-29 oak_planks'),
    at(player, 'summon iron_golem ~-18 ~1 ~-20'),
    at(player, 'summon iron_golem ~18 ~1 ~-20'),
    at(player, 'summon armor_stand ~0 ~1 ~9 {CustomName:\'{"text":"Castle Throne"}\',CustomNameVisible:1b,NoGravity:1b}'),
    at(player, 'particle happy_villager ~ ~10 ~ 18 8 18 0.05 120 force'),
    { command: '/playsound minecraft:entity.player.levelup master @a ~ ~ ~ 1 1' },
    { command: '/title @a title {"text":"Castle Ready","color":"aqua","bold":true}' },
  ];

  return commands;
}

export function getSkillNames(): string[] {
  return Object.keys(SKILL_DESCRIPTIONS);
}

export function runSkill(skillName: string, options: SkillRunOptions): SkillDefinition {
  const player = sanitizeTarget(options.player);
  const size = clampInt(options.size, 4, 32, 12);
  const material = sanitizeMaterial(options.material, 'glass');

  switch (skillName) {
    case 'partyMode':
      return {
        name: 'partyMode',
        description: SKILL_DESCRIPTIONS.partyMode,
        commands: [
          { command: '/time set night' },
          { command: '/weather clear' },
          { command: '/title @a title {"text":"PARTY MODE!","color":"gold","bold":true}' },
          { command: '/playsound minecraft:entity.player.levelup master @a ~ ~ ~ 1 1.2' },
          at(player, 'particle heart ~ ~2 ~ 1 1 1 0.2 30 force', 250),
          at(player, 'particle totem_of_undying ~ ~1 ~ 1.5 1 1.5 0.4 100 force', 400),
          firework(player, -2, 1, -2, 500),
          firework(player, 0, 2, 0, 500),
          firework(player, 2, 1, 2, 500),
          { command: '/playsound minecraft:entity.firework_rocket.twinkle master @a ~ ~ ~ 1 1' },
        ],
      };

    case 'spleefArena':
      return {
        name: 'spleefArena',
        description: SKILL_DESCRIPTIONS.spleefArena,
        commands: [
          at(player, 'fill ~-9 ~-4 ~-9 ~9 ~-1 ~9 air'),
          at(player, 'fill ~-8 ~0 ~-8 ~8 ~0 ~8 snow_block'),
          at(player, 'fill ~-9 ~1 ~-9 ~9 ~4 ~9 glass outline'),
          at(player, 'fill ~-7 ~-3 ~-7 ~7 ~-3 ~7 water'),
          { command: '/give @a diamond_shovel{Enchantments:[{id:"minecraft:efficiency",lvl:5s}],Unbreakable:1b} 1' },
          { command: '/title @a title {"text":"SPLEEF!","color":"aqua","bold":true}' },
          { command: '/title @a subtitle {"text":"Break the snow. Last player standing wins!","color":"white"}' },
        ],
      };

    case 'mobBattle':
      return {
        name: 'mobBattle',
        description: SKILL_DESCRIPTIONS.mobBattle,
        commands: [
          at(player, 'fill ~-10 ~0 ~-10 ~10 ~4 ~10 stone_bricks outline'),
          at(player, 'fill ~-9 ~1 ~-9 ~9 ~3 ~9 air'),
          at(player, 'summon iron_golem ~-5 ~1 ~ {CustomName:\'{"text":"Team Golem"}\',CustomNameVisible:1b}', 300),
          at(player, 'summon iron_golem ~-6 ~1 ~2 {CustomName:\'{"text":"Team Golem"}\',CustomNameVisible:1b}', 300),
          at(player, 'summon zombie ~5 ~1 ~ {CustomName:\'{"text":"Team Zombie"}\',CustomNameVisible:1b,PersistenceRequired:1b}', 300),
          at(player, 'summon zombie ~6 ~1 ~2 {CustomName:\'{"text":"Team Zombie"}\',CustomNameVisible:1b,PersistenceRequired:1b}', 300),
          { command: '/playsound minecraft:entity.ender_dragon.growl master @a ~ ~ ~ 0.7 1.4' },
        ],
      };

    case 'parkourCourse':
      return {
        name: 'parkourCourse',
        description: SKILL_DESCRIPTIONS.parkourCourse,
        commands: buildParkour(player, size),
      };

    case 'rainbowBridge':
      return {
        name: 'rainbowBridge',
        description: SKILL_DESCRIPTIONS.rainbowBridge,
        commands: buildRainbowBridge(player, options.direction, size),
      };

    case 'nycCity':
      return {
        name: 'nycCity',
        description: SKILL_DESCRIPTIONS.nycCity,
        commands: buildNycCity(player),
      };

    case 'castleLair':
      return {
        name: 'castleLair',
        description: SKILL_DESCRIPTIONS.castleLair,
        commands: buildCastleLair(player),
      };

    case 'enchantGear':
      return {
        name: 'enchantGear',
        description: SKILL_DESCRIPTIONS.enchantGear,
        commands: [
          { command: `/give ${player} netherite_helmet{Enchantments:[{id:"minecraft:protection",lvl:4s},{id:"minecraft:unbreaking",lvl:3s},{id:"minecraft:mending",lvl:1s}]} 1` },
          { command: `/give ${player} netherite_chestplate{Enchantments:[{id:"minecraft:protection",lvl:4s},{id:"minecraft:unbreaking",lvl:3s},{id:"minecraft:mending",lvl:1s}]} 1` },
          { command: `/give ${player} netherite_leggings{Enchantments:[{id:"minecraft:protection",lvl:4s},{id:"minecraft:unbreaking",lvl:3s},{id:"minecraft:mending",lvl:1s}]} 1` },
          { command: `/give ${player} netherite_boots{Enchantments:[{id:"minecraft:protection",lvl:4s},{id:"minecraft:feather_falling",lvl:4s},{id:"minecraft:unbreaking",lvl:3s},{id:"minecraft:mending",lvl:1s}]} 1` },
          { command: `/give ${player} netherite_sword{display:{Name:'{"text":"AIGuy Star Blade","color":"gold","italic":false}'},Enchantments:[{id:"minecraft:sharpness",lvl:5s},{id:"minecraft:looting",lvl:3s},{id:"minecraft:unbreaking",lvl:3s},{id:"minecraft:mending",lvl:1s}],Unbreakable:1b} 1` },
          { command: `/give ${player} bow{Enchantments:[{id:"minecraft:power",lvl:5s},{id:"minecraft:infinity",lvl:1s},{id:"minecraft:flame",lvl:1s},{id:"minecraft:unbreaking",lvl:3s}]} 1` },
          { command: `/give ${player} arrow 64` },
          { command: `/give ${player} golden_apple 16` },
        ],
      };

    case 'lightShow':
      return {
        name: 'lightShow',
        description: SKILL_DESCRIPTIONS.lightShow,
        commands: [
          { command: '/time set night' },
          { command: '/weather clear' },
          at(player, 'particle end_rod ~ ~3 ~ 4 2 4 0.01 140 force', 250),
          at(player, 'particle portal ~ ~1 ~ 3 2 3 0.6 180 force', 450),
          at(player, 'particle flame ~ ~1 ~ 2 2 2 0.03 120 force', 450),
          at(player, 'summon lightning_bolt ~5 ~ ~', 350),
          at(player, 'summon lightning_bolt ~-5 ~ ~', 350),
          firework(player, -4, 2, 0, 500),
          firework(player, 0, 3, 0, 500),
          firework(player, 4, 2, 0, 500),
          { command: '/playsound minecraft:block.note_block.pling master @a ~ ~ ~ 1 2' },
        ],
      };

    case 'protectBase':
      return {
        name: 'protectBase',
        description: SKILL_DESCRIPTIONS.protectBase,
        commands: [
          at(player, `fill ~-${size} ~0 ~-${size} ~${size} ~${Math.ceil(size / 2)} ~${size} ${material} outline`),
          at(player, `fill ~-${size + 2} ~-1 ~-${size + 2} ~${size + 2} ~-1 ~${size + 2} water outline`),
          at(player, 'setblock ~8 ~1 ~8 sea_lantern'),
          at(player, 'setblock ~-8 ~1 ~8 sea_lantern'),
          at(player, 'setblock ~8 ~1 ~-8 sea_lantern'),
          at(player, 'setblock ~-8 ~1 ~-8 sea_lantern'),
          at(player, 'summon iron_golem ~4 ~1 ~4 {CustomName:\'{"text":"Base Guard"}\',CustomNameVisible:1b}', 250),
          at(player, 'summon iron_golem ~-4 ~1 ~-4 {CustomName:\'{"text":"Base Guard"}\',CustomNameVisible:1b}', 250),
          at(player, 'particle happy_villager ~ ~2 ~ 5 2 5 0.05 80 force'),
        ],
      };

    default:
      throw new Error(`Unknown skill "${skillName}". Available skills: ${getSkillNames().join(', ')}`);
  }
}
