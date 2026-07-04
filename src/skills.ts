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
  '{LifeTime:20,FireworksItem:{id:"minecraft:firework_rocket",Count:1b,tag:{Fireworks:{Flight:1b,Explosions:[{Type:1b,Colors:[I;11743532,15435844,14602026],FadeColors:[I;4312372,6719955],Trail:1b,Flicker:1b}]}}}}';

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
