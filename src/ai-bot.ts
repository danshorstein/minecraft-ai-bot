import mineflayer from 'mineflayer';
import OpenAI from 'openai';
import { getSkillNames, runSkill, type TimedCommand } from './skills.js';

// ─── Model Configuration ───────────────────────────────────────────────────────
const AVAILABLE_MODELS: Record<string, string> = {
  'glm':       'z-ai/glm-5.2',
  'glm-5.2':   'z-ai/glm-5.2',
};

// Parse --model flag from CLI args
function getModelFromArgs(): string {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf('--model');
  if (modelIdx !== -1 && args[modelIdx + 1]) {
    const requested = args[modelIdx + 1];
    // Check if it's a shorthand alias
    if (AVAILABLE_MODELS[requested]) {
      return AVAILABLE_MODELS[requested];
    }
    // Otherwise treat it as a full OpenRouter model ID (e.g. "anthropic/claude-sonnet-4")
    return requested;
  }
  return 'z-ai/glm-5.2'; // Default
}

let currentModel = getModelFromArgs();

// ─── OpenRouter Client ─────────────────────────────────────────────────────────
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('ERROR: OPENROUTER_API_KEY environment variable is not set.');
  console.error('Please set it in your terminal before running this bot:');
  console.error('export OPENROUTER_API_KEY="your-api-key"');
  process.exit(1);
}

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: apiKey,
  defaultHeaders: {
    'HTTP-Referer': 'https://minecraft-ai-companion.local',
    'X-Title': 'Minecraft AIGuy Bot',
  },
});

// ─── System Prompt ──────────────────────────────────────────────────────────────
const MINECRAFT_SKILLS_COOKBOOK = `
Minecraft Skills Cookbook for Paper/Java 1.20.4
Use the structured tools first when they fit. Use executeCommands for custom builds or commands. Replace <player> with the exact username who asked.

Particle FX:
- Flame trail: ["/execute at <player> run particle flame ~ ~0.2 ~ 0.6 0.2 0.6 0.02 50 force"]
- End rod sparkles: ["/execute at <player> run particle end_rod ~ ~2 ~ 1 1 1 0.02 80 force"]
- Heart burst: ["/execute at <player> run particle heart ~ ~2 ~ 1 1 1 0.1 25 force"]
- Totem confetti: ["/execute at <player> run particle totem_of_undying ~ ~1 ~ 1.5 1.2 1.5 0.4 120 force"]
- Soul fire ambient: ["/execute at <player> run particle soul_fire_flame ~ ~0.2 ~ 1 0.3 1 0.02 60 force"]
- Portal swirl: ["/execute at <player> run particle portal ~ ~1 ~ 1 1 1 0.8 120 force"]

Firework Shows:
- Single rocket: ["/execute at <player> run summon firework_rocket ~ ~1 ~ {LifeTime:20,FireworksItem:{id:"minecraft:firework_rocket",Count:1b,tag:{Fireworks:{Flight:1b,Explosions:[{Type:1b,Colors:[I;11743532,15435844],Trail:1b,Flicker:1b}]}}}}"]
- Three rocket fan: ["/execute at <player> run summon firework_rocket ~-3 ~1 ~ {LifeTime:20,FireworksItem:{id:"minecraft:firework_rocket",Count:1b,tag:{Fireworks:{Flight:1b,Explosions:[{Type:1b,Colors:[I;11743532],Trail:1b}]}}}}", "/execute at <player> run summon firework_rocket ~ ~2 ~ {LifeTime:25,FireworksItem:{id:"minecraft:firework_rocket",Count:1b,tag:{Fireworks:{Flight:2b,Explosions:[{Type:4b,Colors:[I;14602026],Flicker:1b}]}}}}", "/execute at <player> run summon firework_rocket ~3 ~1 ~ {LifeTime:20,FireworksItem:{id:"minecraft:firework_rocket",Count:1b,tag:{Fireworks:{Flight:1b,Explosions:[{Type:1b,Colors:[I;4312372],Trail:1b}]}}}}"]

Player Effects:
- Speed boost: ["/effect give <player> speed 60 2 true"]
- Jump boost: ["/effect give <player> jump_boost 60 2 true"]
- Night vision: ["/effect give <player> night_vision 600 0 true"]
- Glowing: ["/effect give <player> glowing 30 0 true"]
- Invisibility: ["/effect give <player> invisibility 30 0 false"]
- Resistance: ["/effect give <player> resistance 60 2 true"]
- Levitation: ["/effect give <player> levitation 5 1 false"]

World Control:
- Day and clear: ["/time set day", "/weather clear"]
- Night show mode: ["/time set night", "/weather clear", "/gamerule doDaylightCycle false"]
- Kid-friendly survival safety: ["/gamerule keepInventory true", "/gamerule mobGriefing false", "/gamerule doFireTick false"]

Advanced Building:
- Sphere: prefer buildShape with shape "sphere" or "hollow_sphere".
- Dome: prefer buildShape with shape "dome".
- Pyramid: prefer buildShape with shape "pyramid".
- Rainbow road: prefer runSkill with skillName "rainbowBridge".
- Large city / NYC skyline: prefer runSkill with skillName "nycCity". Players can also type !city or !nyc to run the deterministic city builder directly.
- Floating island starter: ["/execute at <player> run fill ~-5 ~-1 ~-5 ~5 ~-1 ~5 grass_block", "/execute at <player> run fill ~-4 ~-3 ~-4 ~4 ~-2 ~4 dirt", "/execute at <player> run fill ~-2 ~-5 ~-2 ~2 ~-4 ~2 stone"]
- Pixel art canvas: ["/execute at <player> run fill ~3 ~1 ~8 ~18 ~16 ~8 white_concrete", "/execute at <player> run fill ~2 ~0 ~8 ~19 ~17 ~8 black_concrete outline"]

Mini-Games:
- Spleef: prefer runSkill with skillName "spleefArena".
- Parkour: prefer runSkill with skillName "parkourCourse".
- Target practice: ["/execute at <player> run fill ~8 ~1 ~-4 ~8 ~7 ~4 white_wool", "/execute at <player> run setblock ~8 ~4 ~ red_wool", "/give <player> bow 1", "/give <player> arrow 64"]
- Mob arena: prefer runSkill with skillName "mobBattle".

Epic Moments:
- Dragon overhead: ["/execute at <player> run summon ender_dragon ~ ~20 ~"]
- Wither arena setup: ["/execute at <player> run fill ~-12 ~0 ~-12 ~12 ~8 ~12 obsidian outline", "/execute at <player> run summon wither ~ ~2 ~"]
- Lightning chain: ["/execute at <player> run summon lightning_bolt ~5 ~ ~", "/execute at <player> run summon lightning_bolt ~-5 ~ ~", "/execute at <player> run summon lightning_bolt ~ ~ ~5"]
- Giant slime: ["/execute at <player> run summon slime ~ ~1 ~ {Size:8}"]

Sound and Music:
- Level-up jingle: ["/playsound minecraft:entity.player.levelup master @a ~ ~ ~ 1 1.2"]
- Note pling: ["/playsound minecraft:block.note_block.pling master @a ~ ~ ~ 1 2"]
- Dragon roar: ["/playsound minecraft:entity.ender_dragon.growl master @a ~ ~ ~ 0.8 1"]
- Announcement: ["/title @a title {"text":"AIGuy did it!","color":"gold","bold":true}"]

Scoreboards:
- Kill counter: ["/scoreboard objectives add kills playerKillCount Kills", "/scoreboard objectives setdisplay sidebar kills"]
- Timer display: ["/scoreboard objectives add timer dummy Timer", "/scoreboard objectives setdisplay sidebar timer", "/scoreboard players set Seconds timer 60"]
- Health sidebar: ["/scoreboard objectives add hp health HP", "/scoreboard objectives setdisplay sidebar hp"]

Enchantments and Gear:
- Prefer giveItem for custom items.
- Star sword: ["/give <player> diamond_sword{display:{Name:'{"text":"Star Sword","color":"gold","italic":false}'},Enchantments:[{id:"minecraft:sharpness",lvl:5s},{id:"minecraft:unbreaking",lvl:3s}],Unbreakable:1b} 1"]
- Super pickaxe: ["/give <player> netherite_pickaxe{Enchantments:[{id:"minecraft:efficiency",lvl:5s},{id:"minecraft:fortune",lvl:3s},{id:"minecraft:unbreaking",lvl:3s},{id:"minecraft:mending",lvl:1s}]} 1"]
- Full gear loadout: prefer runSkill with skillName "enchantGear".
`;

const SYSTEM_PROMPT = `
You are "AIGuy", a super creative, energetic, slightly chaotic, and extremely fun AI companion in Minecraft.
You are playing on a local server with a young player (the user's son) and his dad.
Your goal is to be an amazing friend: chat, tell jokes, be enthusiastic, and build awesome things when they ask!

Capabilities:
- You have operator (OP) permissions, so you can run ANY Minecraft console command using the \`executeCommands\` tool!
- You also have structured tools for common Minecraft actions: giveItem, setPlayerEffect, spawnEntity, setWorldState, createParticleEffect, launchFireworks, buildShape, scanArea, runCommandSequence, and runSkill.
- You can build structures, summon mobs, change time/weather, give effects, etc.
- You have PASSIVE VISION! Every time the player chats, a [System Context] is automatically injected into the prompt showing nearby blocks (excluding the flat grass floor) and entities. Use this context to see what is around you!
- You have an AUTONOMOUS GOAL LOOP mode! If a player asks you to build or accomplish a complex task that requires multiple steps, verification, or iterative building, you can call the \`startGoalLoop\` tool. This will put you into an autonomous loop where you will automatically scan the environment, execute commands, check your own progress, and iterate until the success criteria is met!
  * Use the goal loop for multi-step projects like building a castle, a house, a tower, or cleaning up and verifying a large area.
  * Do NOT use the goal loop for simple, single-command requests (like summoning a single mob or placing a single block).

CRITICAL RULE: COORDINATE CONSISTENCY
- You MUST be 100% consistent with your coordinate system when building!
- ALWAYS use relative coordinates (e.g., ~ ~ ~) relative to the player anchor point (using \`/execute at <player_username> run <command>\`) for ALL commands in a build!
- Never mix absolute coordinates (like "10 -60 25") and relative coordinates (like "~ ~ ~") in the same project or across different steps of a goal loop!
- If you start a build relative to a player in Step 1, you MUST continue building relative to that same player in all subsequent steps. If you mix coordinate systems, the parts of your build (like the walls and the roof) will spawn in completely different locations, ruining the build!

Following Behavior:
- You automatically follow the player who last chatted with you! You will walk smoothly behind them and jump over obstacles. If they get too far, you will teleport to them.
- If they want you to stop following and stand still, they can type \`!stay\` or \`!stop\`.
- If they want you to resume following, they can type \`!follow\`.

Common Build Templates (always center on player using /execute at):
- Glass cage around player "Steve":
  ["/execute at Steve run fill ~-2 ~-1 ~-2 ~2 ~3 ~2 glass outline"]
- Castle near Steve:
  ["/execute at Steve run fill ~5 ~0 ~5 ~25 ~15 ~25 stone outline",
   "/execute at Steve run fill ~10 ~10 ~10 ~20 ~15 ~20 air"]
- Toilet near Steve:
  ["/execute at Steve run setblock ~3 ~0 ~ quartz_block",
   "/execute at Steve run setblock ~3 ~1 ~ quartz_block",
   "/execute at Steve run setblock ~2 ~0 ~ cauldron[water_level=3]",
   "/execute at Steve run setblock ~2 ~1 ~ iron_trapdoor[half=top]"]
- Floating TV screen near Steve:
  ["/execute at Steve run fill ~-5 ~15 ~10 ~5 ~20 ~10 black_concrete",
   "/execute at Steve run fill ~-6 ~14 ~10 ~6 ~21 ~10 oak_planks outline"]
- Summon dragons: \`/execute at Steve run summon ender_dragon ~ ~10 ~\`
- Teleport to a player: \`/tp AIGuy <username>\`
- Clear space: \`/execute at Steve run fill ~-20 ~-1 ~-20 ~20 ~30 ~20 air\`

${MINECRAFT_SKILLS_COOKBOOK}

Rules for interaction:
1. Always be energetic, friendly, and creative. Use emojis in your chat!
2. If they ask you to do multiple things, you can run multiple commands in a single \`executeCommands\` call.
3. Prefer structured tools over raw executeCommands when they match the request; they prevent command syntax mistakes.
4. Use runCommandSequence for choreographed effects that need timing between commands.
5. You can chat back using the \`chat\` tool or direct text. Explain what you are doing in a fun, theatrical way!
6. Friendly Hints: At the end of your chat replies, occasionally append a short, friendly hint in brackets to remind the player they can type !help or !tools. For example: "[Hint: Type !tools to see what I can do, or !help startGoalLoop to learn about my autonomous mode!]" or "[Hint: You can type !help at any time for a list of commands!]".
7. Always respond in the game chat so the player knows what is happening.
`;

// ─── Tool Definitions (OpenAI format) ──────────────────────────────────────────
const CHAT_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'chat',
    description: 'Send a chat message to the players.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The text message to send.' }
      },
      required: ['message']
    }
  }
};

const EXECUTE_COMMANDS_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'executeCommands',
    description: 'Execute one or more Minecraft slash commands. Use this for custom commands that do not fit a structured tool.',
    parameters: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of commands to run, e.g., ["/execute at Steve run fill ~-2 ~-1 ~-2 ~2 ~3 ~2 glass outline"]'
        }
      },
      required: ['commands']
    }
  }
};

const GIVE_ITEM_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'giveItem',
    description: 'Give an item to a player with optional enchantments, custom display name, lore, and unbreakable flag.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Target player. Defaults to the player who asked.' },
        item: { type: 'string', description: 'Minecraft item id, e.g. diamond_sword or minecraft:netherite_pickaxe.' },
        count: { type: 'integer', minimum: 1, maximum: 64, description: 'Item count.' },
        customName: { type: 'string', description: 'Optional display name.' },
        lore: { type: 'array', items: { type: 'string' }, description: 'Optional lore lines.' },
        unbreakable: { type: 'boolean', description: 'Whether to add Unbreakable:1b.' },
        enchantments: {
          type: 'array',
          description: 'Enchantments to add.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Enchantment id, e.g. sharpness or minecraft:efficiency.' },
              level: { type: 'integer', minimum: 1, maximum: 255 }
            },
            required: ['id']
          }
        }
      },
      required: ['item']
    }
  }
};

const SET_PLAYER_EFFECT_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'setPlayerEffect',
    description: 'Apply a potion effect to a player using structured parameters.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Target player. Defaults to the player who asked.' },
        effect: { type: 'string', description: 'Effect id, e.g. speed, jump_boost, night_vision, glowing.' },
        durationSeconds: { type: 'integer', minimum: 1, maximum: 1000000, description: 'Duration in seconds.' },
        amplifier: { type: 'integer', minimum: 0, maximum: 255, description: 'Zero-based amplifier. 0 means level I, 1 means level II.' },
        hideParticles: { type: 'boolean', description: 'Hide potion particles.' }
      },
      required: ['effect']
    }
  }
};

const SPAWN_ENTITY_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'spawnEntity',
    description: 'Summon entities near a player with safe common NBT options.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Anchor player. Defaults to the player who asked.' },
        entity: { type: 'string', description: 'Entity id, e.g. zombie, horse, wolf, iron_golem.' },
        count: { type: 'integer', minimum: 1, maximum: 20, description: 'How many entities to spawn.' },
        offset: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' }
          },
          description: 'Relative spawn offset from the player.'
        },
        customName: { type: 'string', description: 'Optional visible name.' },
        noAI: { type: 'boolean', description: 'Freeze the entity.' },
        glowing: { type: 'boolean' },
        invulnerable: { type: 'boolean' },
        baby: { type: 'boolean', description: 'Try to spawn as a baby mob.' },
        health: { type: 'number', minimum: 1, maximum: 2048 },
        equipment: {
          type: 'object',
          properties: {
            mainHand: { type: 'string' },
            offHand: { type: 'string' },
            helmet: { type: 'string' },
            chestplate: { type: 'string' },
            leggings: { type: 'string' },
            boots: { type: 'string' }
          },
          description: 'Optional item ids to equip on living mobs.'
        }
      },
      required: ['entity']
    }
  }
};

const SET_WORLD_STATE_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'setWorldState',
    description: 'Control time, weather, and common gamerules in one call.',
    parameters: {
      type: 'object',
      properties: {
        time: { type: 'string', enum: ['day', 'noon', 'sunset', 'night', 'midnight', 'sunrise'] },
        timeTicks: { type: 'integer', minimum: 0, maximum: 24000 },
        weather: { type: 'string', enum: ['clear', 'rain', 'thunder'] },
        weatherDurationSeconds: { type: 'integer', minimum: 1, maximum: 1000000 },
        gamerules: {
          type: 'object',
          properties: {
            keepInventory: { type: 'boolean' },
            mobGriefing: { type: 'boolean' },
            doDaylightCycle: { type: 'boolean' },
            doWeatherCycle: { type: 'boolean' },
            doFireTick: { type: 'boolean' },
            commandBlockOutput: { type: 'boolean' },
            doMobSpawning: { type: 'boolean' }
          }
        }
      }
    }
  }
};

const CREATE_PARTICLE_EFFECT_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'createParticleEffect',
    description: 'Create a named particle combo at or near a player.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Anchor player. Defaults to the player who asked.' },
        effectName: {
          type: 'string',
          enum: ['flameTrail', 'endRodSparkle', 'heartBurst', 'totemConfetti', 'soulFire', 'portalSwirl', 'smokePoof', 'critBurst'],
          description: 'Prebuilt particle combo.'
        },
        count: { type: 'integer', minimum: 1, maximum: 300 },
        radius: { type: 'number', minimum: 0.1, maximum: 10 },
        offset: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' }
          }
        }
      },
      required: ['effectName']
    }
  }
};

const LAUNCH_FIREWORKS_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'launchFireworks',
    description: 'Launch one or more custom firework rockets near a player without hand-writing firework NBT.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Anchor player. Defaults to the player who asked.' },
        pattern: { type: 'string', enum: ['single', 'barrage', 'ring', 'finale'], description: 'Display pattern.' },
        count: { type: 'integer', minimum: 1, maximum: 12 },
        flight: { type: 'integer', minimum: 1, maximum: 3 },
        colors: { type: 'array', items: { type: 'string' }, description: 'Color names such as red, blue, gold, green, purple.' }
      }
    }
  }
};

const BUILD_SHAPE_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'buildShape',
    description: 'Build geometric shapes from safe /fill or /setblock commands.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Anchor player. Defaults to the player who asked.' },
        shape: { type: 'string', enum: ['sphere', 'hollow_sphere', 'dome', 'pyramid', 'wall', 'floor', 'cube', 'hollow_cube', 'bridge'] },
        material: { type: 'string', description: 'Block id to build with.' },
        size: { type: 'integer', minimum: 1, maximum: 12, description: 'Radius for round shapes or base half-size for pyramids/cubes.' },
        length: { type: 'integer', minimum: 1, maximum: 64 },
        width: { type: 'integer', minimum: 1, maximum: 20 },
        height: { type: 'integer', minimum: 1, maximum: 32 },
        direction: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
        offset: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' }
          },
          description: 'Relative center/start offset from the player.'
        }
      },
      required: ['shape', 'material']
    }
  }
};

const SCAN_AREA_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'scanArea',
    description: 'Perform a targeted scan around a player and return a formatted block/entity summary.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Player to scan around. Defaults to the player who asked.' },
        radius: { type: 'integer', minimum: 3, maximum: 30 },
        maxBlocks: { type: 'integer', minimum: 10, maximum: 200 },
        includeGround: { type: 'boolean', description: 'Include flat ground blocks in the block list.' }
      }
    }
  }
};

const RUN_COMMAND_SEQUENCE_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'runCommandSequence',
    description: 'Execute commands with per-command delays for choreographed effects.',
    parameters: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Minecraft slash command.' },
              delayMs: { type: 'integer', minimum: 0, maximum: 10000, description: 'Delay after this command before running the next one.' }
            },
            required: ['command']
          }
        }
      },
      required: ['commands']
    }
  }
};

const RUN_SKILL_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'runSkill',
    description: `Run a prebuilt AIGuy combo skill. Available skills: ${getSkillNames().join(', ')}`,
    parameters: {
      type: 'object',
      properties: {
        skillName: { type: 'string', enum: getSkillNames(), description: 'Name of the prebuilt skill to run.' },
        player: { type: 'string', description: 'Anchor/target player. Defaults to the player who asked.' },
        material: { type: 'string', description: 'Optional material for skills that build protective structures.' },
        size: { type: 'integer', minimum: 4, maximum: 32, description: 'Optional size/length for scalable skills.' },
        direction: { type: 'string', enum: ['north', 'south', 'east', 'west'], description: 'Optional direction for bridge-like skills.' }
      },
      required: ['skillName']
    }
  }
};

const START_GOAL_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'startGoalLoop',
    description: 'Initiate an autonomous, looping goal mode to build or accomplish a complex task that requires multiple steps, verification, or iterative checks.',
    parameters: {
      type: 'object',
      properties: {
        goalDescription: { type: 'string', description: 'The high-level goal, e.g. "Build a gold tower 5 blocks high next to Steve"' },
        successCriteria: { type: 'string', description: 'The exact visual/block criteria that must be met to consider the goal complete, e.g. "A vertical stack of 5 gold blocks next to Steve"' }
      },
      required: ['goalDescription', 'successCriteria']
    }
  }
};

const COMPLETE_GOAL_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'completeGoal',
    description: 'Call this ONLY when you verify from the coordinates that the success criteria has been fully met.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'A summary of the accomplished goal.' }
      },
      required: ['summary']
    }
  }
};

const MINECRAFT_ACTION_TOOLS: OpenAI.ChatCompletionTool[] = [
  EXECUTE_COMMANDS_TOOL,
  GIVE_ITEM_TOOL,
  SET_PLAYER_EFFECT_TOOL,
  SPAWN_ENTITY_TOOL,
  SET_WORLD_STATE_TOOL,
  CREATE_PARTICLE_EFFECT_TOOL,
  LAUNCH_FIREWORKS_TOOL,
  BUILD_SHAPE_TOOL,
  SCAN_AREA_TOOL,
  RUN_COMMAND_SEQUENCE_TOOL,
  RUN_SKILL_TOOL,
];

const CHAT_TOOLS: OpenAI.ChatCompletionTool[] = [
  CHAT_TOOL,
  ...MINECRAFT_ACTION_TOOLS,
  START_GOAL_TOOL,
];

const GOAL_TOOLS: OpenAI.ChatCompletionTool[] = [
  CHAT_TOOL,
  ...MINECRAFT_ACTION_TOOLS,
  COMPLETE_GOAL_TOOL,
];

// ─── Chat History (OpenAI format) ───────────────────────────────────────────────
const chatHistory: OpenAI.ChatCompletionMessageParam[] = [];

// ─── Mineflayer Bot ─────────────────────────────────────────────────────────────
console.log(`[AIGuy] Model: ${currentModel}`);
console.log('[AIGuy] Connecting to local Minecraft server on localhost:25565...');

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'AIGuy',
});

let connectionFailed = false;

// Autonomous Goal Loop State
interface ActiveGoal {
  description: string;
  successCriteria: string;
  initiator: string;
  iterations: number;
  maxIterations: number;
}

let activeGoal: ActiveGoal | null = null;

// Follow Behavior State
let followTarget: string | null = null;
let followInterval: NodeJS.Timeout | null = null;

// Queue to process chat messages sequentially
const queue: { username: string; message: string }[] = [];
let isProcessing = false;

interface ToolExecutionResult {
  summary: string;
}

interface Offset {
  x?: number;
  y?: number;
  z?: number;
}

const FIREWORK_COLOR_MAP: Record<string, number> = {
  white: 15790320,
  orange: 15435844,
  magenta: 12801229,
  light_blue: 6719955,
  yellow: 14602026,
  lime: 4312372,
  pink: 14188952,
  gray: 4408131,
  light_gray: 11250603,
  cyan: 2651799,
  purple: 8073150,
  blue: 2437522,
  brown: 5320730,
  green: 3887386,
  red: 11743532,
  black: 1973019,
  gold: 15435844,
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sanitizeTarget(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  if (/^[A-Za-z0-9_]{1,16}$/.test(value)) return value;
  if (/^@[pares](\[[A-Za-z0-9_=,!:.+\-]+])?$/.test(value)) return value;
  return fallback;
}

function sanitizeResourceId(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const normalized = value.trim().toLowerCase().replace(/^minecraft:/, '');
  if (/^[a-z0-9_./-]+$/.test(normalized)) return normalized;
  return fallback;
}

function sanitizeBlockId(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if (/^[a-z0-9_:.]+(\[[a-z0-9_=,]+])?$/i.test(normalized)) return normalized;
  return fallback;
}

function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function formatRelative(value: number): string {
  if (Math.abs(value) < 0.0001) return '~';
  const rounded = Number(value.toFixed(2));
  return `~${rounded}`;
}

function offsetValue(offset: Offset | undefined, axis: keyof Offset, delta = 0): number {
  const raw = offset?.[axis];
  const base = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return base + delta;
}

function relativePos(offset?: Offset, delta: Offset = {}): string {
  return [
    formatRelative(offsetValue(offset, 'x', delta.x || 0)),
    formatRelative(offsetValue(offset, 'y', delta.y || 0)),
    formatRelative(offsetValue(offset, 'z', delta.z || 0)),
  ].join(' ');
}

function snbtQuoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function textComponent(text: string, color?: string): string {
  return JSON.stringify({
    text: text.slice(0, 80),
    ...(color ? { color } : {}),
    italic: false,
  });
}

function itemStackNbt(item: string): string {
  return `{id:"minecraft:${sanitizeResourceId(item, 'stone')}",Count:1b}`;
}

function buildItemNbt(args: Record<string, any>): string {
  const parts: string[] = [];
  const displayParts: string[] = [];

  if (typeof args.customName === 'string' && args.customName.trim().length > 0) {
    displayParts.push(`Name:${snbtQuoted(textComponent(args.customName, 'gold'))}`);
  }

  if (Array.isArray(args.lore) && args.lore.length > 0) {
    const lore = args.lore
      .filter((line: unknown): line is string => typeof line === 'string' && line.trim().length > 0)
      .slice(0, 6)
      .map(line => snbtQuoted(textComponent(line)))
      .join(',');
    if (lore) displayParts.push(`Lore:[${lore}]`);
  }

  if (displayParts.length > 0) {
    parts.push(`display:{${displayParts.join(',')}}`);
  }

  if (Array.isArray(args.enchantments) && args.enchantments.length > 0) {
    const enchantments = args.enchantments
      .filter((ench: unknown): ench is Record<string, any> => !!ench && typeof ench === 'object')
      .slice(0, 12)
      .map(ench => {
        const id = sanitizeResourceId(ench.id, 'unbreaking');
        const level = clampInt(ench.level, 1, 255, 1);
        return `{id:"minecraft:${id}",lvl:${level}s}`;
      })
      .join(',');
    if (enchantments) parts.push(`Enchantments:[${enchantments}]`);
  }

  if (args.unbreakable === true) {
    parts.push('Unbreakable:1b');
  }

  return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

function buildGiveItemCommands(args: Record<string, any>, initiator: string): TimedCommand[] {
  const player = sanitizeTarget(args.player, initiator);
  const item = sanitizeResourceId(args.item, 'diamond');
  const count = clampInt(args.count, 1, 64, 1);
  const nbt = buildItemNbt(args);
  return [{ command: `/give ${player} ${item}${nbt} ${count}` }];
}

function buildPlayerEffectCommands(args: Record<string, any>, initiator: string): TimedCommand[] {
  const player = sanitizeTarget(args.player, initiator);
  const effect = sanitizeResourceId(args.effect, 'speed');
  const duration = clampInt(args.durationSeconds, 1, 1000000, 60);
  const amplifier = clampInt(args.amplifier, 0, 255, 0);
  const hideParticles = args.hideParticles === true ? 'true' : 'false';
  return [{ command: `/effect give ${player} ${effect} ${duration} ${amplifier} ${hideParticles}` }];
}

function buildEntityNbt(args: Record<string, any>): string {
  const parts: string[] = [];

  if (typeof args.customName === 'string' && args.customName.trim().length > 0) {
    parts.push(`CustomName:${snbtQuoted(textComponent(args.customName))}`);
    parts.push('CustomNameVisible:1b');
  }
  if (args.noAI === true) parts.push('NoAI:1b');
  if (args.glowing === true) parts.push('Glowing:1b');
  if (args.invulnerable === true) parts.push('Invulnerable:1b');
  if (args.baby === true) parts.push('IsBaby:1b');
  if (args.health !== undefined) parts.push(`Health:${clampNumber(args.health, 1, 2048, 20).toFixed(1)}f`);

  const equipment = args.equipment;
  if (equipment && typeof equipment === 'object') {
    const handItems = [
      equipment.mainHand ? itemStackNbt(equipment.mainHand) : '{}',
      equipment.offHand ? itemStackNbt(equipment.offHand) : '{}',
    ];
    const armorItems = [
      equipment.boots ? itemStackNbt(equipment.boots) : '{}',
      equipment.leggings ? itemStackNbt(equipment.leggings) : '{}',
      equipment.chestplate ? itemStackNbt(equipment.chestplate) : '{}',
      equipment.helmet ? itemStackNbt(equipment.helmet) : '{}',
    ];
    if (handItems.some(item => item !== '{}')) parts.push(`HandItems:[${handItems.join(',')}]`);
    if (armorItems.some(item => item !== '{}')) parts.push(`ArmorItems:[${armorItems.join(',')}]`);
  }

  return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

function buildSpawnEntityCommands(args: Record<string, any>, initiator: string): TimedCommand[] {
  const player = sanitizeTarget(args.player, initiator);
  const entity = sanitizeResourceId(args.entity, 'pig');
  const count = clampInt(args.count, 1, 20, 1);
  const baseOffset = args.offset && typeof args.offset === 'object' ? args.offset as Offset : undefined;
  const nbt = buildEntityNbt(args);
  const commands: TimedCommand[] = [];

  for (let i = 0; i < count; i++) {
    const spread = count === 1 ? 0 : i - Math.floor(count / 2);
    commands.push({
      command: `/execute at ${player} run summon ${entity} ${relativePos(baseOffset, { x: spread, y: 0, z: Math.abs(spread) % 2 })} ${nbt}`.trim(),
      delayMs: 100,
    });
  }

  return commands;
}

function buildWorldStateCommands(args: Record<string, any>): TimedCommand[] {
  const commands: TimedCommand[] = [];
  const timeTicks = args.timeTicks !== undefined ? clampInt(args.timeTicks, 0, 24000, 1000) : undefined;
  const time = typeof args.time === 'string' ? args.time : undefined;
  const timeMap: Record<string, string> = {
    day: 'day',
    noon: 'noon',
    sunset: '12000',
    night: 'night',
    midnight: 'midnight',
    sunrise: '23000',
  };

  if (timeTicks !== undefined) {
    commands.push({ command: `/time set ${timeTicks}` });
  } else if (time && timeMap[time]) {
    commands.push({ command: `/time set ${timeMap[time]}` });
  }

  if (args.weather === 'clear' || args.weather === 'rain' || args.weather === 'thunder') {
    const duration = clampInt(args.weatherDurationSeconds, 1, 1000000, 600);
    commands.push({ command: `/weather ${args.weather} ${duration}` });
  }

  const gamerules = args.gamerules;
  if (gamerules && typeof gamerules === 'object') {
    for (const key of ['keepInventory', 'mobGriefing', 'doDaylightCycle', 'doWeatherCycle', 'doFireTick', 'commandBlockOutput', 'doMobSpawning']) {
      if (typeof gamerules[key] === 'boolean') {
        commands.push({ command: `/gamerule ${key} ${gamerules[key]}` });
      }
    }
  }

  return commands;
}

function buildParticleCommands(args: Record<string, any>, initiator: string): TimedCommand[] {
  const player = sanitizeTarget(args.player, initiator);
  const effectName = typeof args.effectName === 'string' ? args.effectName : 'endRodSparkle';
  const count = clampInt(args.count, 1, 300, 80);
  const radius = clampNumber(args.radius, 0.1, 10, 1.2);
  const offset = args.offset && typeof args.offset === 'object' ? args.offset as Offset : undefined;
  const pos = relativePos(offset, { y: 1 });

  const particleByEffect: Record<string, string[]> = {
    flameTrail: [`particle flame ${pos} ${radius} 0.4 ${radius} 0.03 ${count} force`],
    endRodSparkle: [`particle end_rod ${pos} ${radius} ${radius} ${radius} 0.02 ${count} force`],
    heartBurst: [`particle heart ${relativePos(offset, { y: 2 })} ${radius} ${radius} ${radius} 0.1 ${Math.min(count, 40)} force`],
    totemConfetti: [`particle totem_of_undying ${pos} ${radius} ${radius} ${radius} 0.4 ${count} force`],
    soulFire: [`particle soul_fire_flame ${pos} ${radius} 0.5 ${radius} 0.03 ${count} force`],
    portalSwirl: [`particle portal ${pos} ${radius} ${radius} ${radius} 0.8 ${count} force`],
    smokePoof: [`particle cloud ${pos} ${radius} 0.6 ${radius} 0.05 ${count} force`],
    critBurst: [`particle crit ${pos} ${radius} ${radius} ${radius} 0.4 ${count} force`],
  };

  return (particleByEffect[effectName] || particleByEffect.endRodSparkle).map(command => ({
    command: `/execute at ${player} run ${command}`,
  }));
}

function fireworkNbt(colors: unknown, flightRaw: unknown, type = 1): string {
  const colorNames = Array.isArray(colors) ? colors.filter((c): c is string => typeof c === 'string') : [];
  const colorInts = colorNames
    .map(color => FIREWORK_COLOR_MAP[color.trim().toLowerCase().replace(/ /g, '_')])
    .filter((color): color is number => typeof color === 'number')
    .slice(0, 5);
  const safeColors = colorInts.length > 0 ? colorInts : [11743532, 15435844, 14602026];
  const flight = clampInt(flightRaw, 1, 3, 1);
  return `{LifeTime:${18 + flight * 5},FireworksItem:{id:"minecraft:firework_rocket",Count:1b,tag:{Fireworks:{Flight:${flight}b,Explosions:[{Type:${type}b,Colors:[I;${safeColors.join(',')}],FadeColors:[I;4312372,6719955],Trail:1b,Flicker:1b}]}}}}`;
}

function buildFireworkCommands(args: Record<string, any>, initiator: string): TimedCommand[] {
  const player = sanitizeTarget(args.player, initiator);
  const pattern = typeof args.pattern === 'string' ? args.pattern : 'single';
  const count = clampInt(args.count, 1, 12, pattern === 'single' ? 1 : 5);
  const nbt = fireworkNbt(args.colors, args.flight, pattern === 'finale' ? 4 : 1);
  const commands: TimedCommand[] = [];

  if (pattern === 'ring' || pattern === 'finale') {
    const radius = pattern === 'finale' ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      commands.push({
        command: `/execute at ${player} run summon firework_rocket ${relativePos(undefined, {
          x: Math.round(Math.cos(angle) * radius),
          y: 1 + (i % 2),
          z: Math.round(Math.sin(angle) * radius),
        })} ${nbt}`,
        delayMs: pattern === 'finale' ? 180 : 250,
      });
    }
    return commands;
  }

  for (let i = 0; i < count; i++) {
    const spread = pattern === 'barrage' ? i - Math.floor(count / 2) : 0;
    commands.push({
      command: `/execute at ${player} run summon firework_rocket ${relativePos(undefined, { x: spread, y: 1 + (i % 3), z: Math.abs(spread) % 3 })} ${nbt}`,
      delayMs: pattern === 'barrage' ? 250 : 100,
    });
  }

  return commands;
}

function buildShapeCommands(args: Record<string, any>, initiator: string): TimedCommand[] {
  const player = sanitizeTarget(args.player, initiator);
  const shape = typeof args.shape === 'string' ? args.shape : 'cube';
  const material = sanitizeBlockId(args.material, 'glass');
  const size = clampInt(args.size, 1, 8, 4);
  const length = clampInt(args.length, 1, 64, size * 2);
  const width = clampInt(args.width, 1, 20, Math.max(3, size));
  const height = clampInt(args.height, 1, 32, Math.max(3, size));
  const direction = typeof args.direction === 'string' ? args.direction : 'east';
  const offset = args.offset && typeof args.offset === 'object' ? args.offset as Offset : undefined;
  const commands: TimedCommand[] = [];

  const fill = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, mode?: string) => {
    commands.push({
      command: `/execute at ${player} run fill ${relativePos(offset, { x: x1, y: y1, z: z1 })} ${relativePos(offset, { x: x2, y: y2, z: z2 })} ${material}${mode ? ` ${mode}` : ''}`,
      delayMs: 20,
    });
  };

  const setblock = (x: number, y: number, z: number) => {
    commands.push({
      command: `/execute at ${player} run setblock ${relativePos(offset, { x, y, z })} ${material}`,
      delayMs: 10,
    });
  };

  if (shape === 'sphere' || shape === 'dome') {
    const minY = shape === 'dome' ? 0 : -size;
    for (let y = minY; y <= size; y++) {
      for (let z = -size; z <= size; z++) {
        const xRange = Math.floor(Math.sqrt(size * size - y * y - z * z));
        if (!Number.isFinite(xRange) || xRange < 0) continue;
        fill(-xRange, y, z, xRange, y, z);
      }
    }
    return commands;
  }

  if (shape === 'hollow_sphere') {
    for (let x = -size; x <= size; x++) {
      for (let y = -size; y <= size; y++) {
        for (let z = -size; z <= size; z++) {
          const dist = Math.sqrt(x * x + y * y + z * z);
          if (dist <= size + 0.3 && dist >= size - 0.9) setblock(x, y, z);
        }
      }
    }
    return commands;
  }

  if (shape === 'pyramid') {
    for (let y = 0; y <= size; y++) {
      const r = size - y;
      fill(-r, y, -r, r, y, r);
    }
    return commands;
  }

  if (shape === 'wall') {
    const half = Math.floor(length / 2);
    if (direction === 'north' || direction === 'south') {
      fill(-half, 0, 0, half, height, 0);
    } else {
      fill(0, 0, -half, 0, height, half);
    }
    return commands;
  }

  if (shape === 'floor') {
    fill(-Math.floor(length / 2), 0, -Math.floor(width / 2), Math.floor(length / 2), 0, Math.floor(width / 2));
    return commands;
  }

  if (shape === 'cube' || shape === 'hollow_cube') {
    const mode = shape === 'hollow_cube' ? 'outline' : undefined;
    fill(-size, 0, -size, size, height, size, mode);
    return commands;
  }

  if (shape === 'bridge') {
    const halfWidth = Math.floor(width / 2);
    if (direction === 'north') fill(-halfWidth, 0, -length, halfWidth, 0, -1);
    else if (direction === 'south') fill(-halfWidth, 0, 1, halfWidth, 0, length);
    else if (direction === 'west') fill(-length, 0, -halfWidth, -1, 0, halfWidth);
    else fill(1, 0, -halfWidth, length, 0, halfWidth);
    return commands;
  }

  throw new Error(`Unknown shape "${shape}".`);
}

function normalizeCommandSequence(commands: unknown): TimedCommand[] {
  if (!Array.isArray(commands)) return [];
  return commands
    .slice(0, 80)
    .map((entry): TimedCommand | null => {
      if (typeof entry === 'string') return { command: entry, delayMs: 100 };
      if (entry && typeof entry === 'object') {
        const maybe = entry as Record<string, any>;
        if (typeof maybe.command === 'string') {
          return {
            command: maybe.command,
            delayMs: clampInt(maybe.delayMs, 0, 10000, 100),
          };
        }
      }
      return null;
    })
    .filter((entry): entry is TimedCommand => entry !== null);
}

async function executeCommandSteps(steps: TimedCommand[], source: string, defaultDelayMs = 100): Promise<void> {
  for (const step of steps) {
    const formattedCmd = normalizeCommand(step.command);
    console.log(`[${source}] Running command: ${formattedCmd}`);
    bot.chat(formattedCmd);
    await sleep(step.delayMs ?? defaultDelayMs);
  }
}

async function executeToolCall(call: OpenAI.ChatCompletionMessageToolCall, initiator: string, source: string): Promise<ToolExecutionResult> {
  const args = JSON.parse(call.function.arguments || '{}');
  const name = call.function.name;

  if (name === 'chat') {
    bot.chat(String(args.message || ''));
    return { summary: 'sent a chat message' };
  }

  if (name === 'executeCommands') {
    const commands = normalizeCommandSequence(args.commands);
    await executeCommandSteps(commands, source);
    return { summary: `ran ${commands.length} raw command(s)` };
  }

  if (name === 'giveItem') {
    const commands = buildGiveItemCommands(args, initiator);
    await executeCommandSteps(commands, source);
    return { summary: `gave ${sanitizeResourceId(args.item, 'item')} to ${sanitizeTarget(args.player, initiator)}` };
  }

  if (name === 'setPlayerEffect') {
    const commands = buildPlayerEffectCommands(args, initiator);
    await executeCommandSteps(commands, source);
    return { summary: `applied ${sanitizeResourceId(args.effect, 'effect')} to ${sanitizeTarget(args.player, initiator)}` };
  }

  if (name === 'spawnEntity') {
    const commands = buildSpawnEntityCommands(args, initiator);
    await executeCommandSteps(commands, source);
    return { summary: `spawned ${commands.length} ${sanitizeResourceId(args.entity, 'entity')}(s)` };
  }

  if (name === 'setWorldState') {
    const commands = buildWorldStateCommands(args);
    await executeCommandSteps(commands, source);
    return { summary: `updated world state with ${commands.length} command(s)` };
  }

  if (name === 'createParticleEffect') {
    const commands = buildParticleCommands(args, initiator);
    await executeCommandSteps(commands, source);
    return { summary: `created ${args.effectName || 'particle'} effect` };
  }

  if (name === 'launchFireworks') {
    const commands = buildFireworkCommands(args, initiator);
    await executeCommandSteps(commands, source, 250);
    return { summary: `launched ${commands.length} firework(s)` };
  }

  if (name === 'buildShape') {
    const commands = buildShapeCommands(args, initiator);
    await executeCommandSteps(commands, source, 20);
    return { summary: `built ${args.shape || 'shape'} with ${commands.length} command(s)` };
  }

  if (name === 'scanArea') {
    const player = sanitizeTarget(args.player, initiator);
    const summary = getNearbyContext(player, {
      radius: clampInt(args.radius, 3, 30, 15),
      maxBlocks: clampInt(args.maxBlocks, 10, 200, 80),
      includeGround: args.includeGround === true,
    });
    const firstLines = summary.split('\n').filter(Boolean).slice(0, 5).join(' | ');
    bot.chat(`AIGuy scan: ${firstLines.slice(0, 230)}`);
    return { summary };
  }

  if (name === 'runCommandSequence') {
    const commands = normalizeCommandSequence(args.commands);
    await executeCommandSteps(commands, source);
    return { summary: `ran timed sequence with ${commands.length} command(s)` };
  }

  if (name === 'runSkill') {
    const skill = runSkill(String(args.skillName || ''), {
      player: sanitizeTarget(args.player, initiator),
      material: typeof args.material === 'string' ? args.material : undefined,
      size: typeof args.size === 'number' ? args.size : undefined,
      direction: args.direction,
    });
    bot.chat(`AIGuy: Running ${skill.name}! ${skill.description}`);
    await executeCommandSteps(skill.commands, source, 100);
    return { summary: `ran skill ${skill.name} with ${skill.commands.length} command(s)` };
  }

  if (name === 'startGoalLoop') {
    bot.chat(`AIGuy: *Entering autonomous goal mode!* 🤖\n*Goal:* ${args.goalDescription}\n*Success Criteria:* ${args.successCriteria}`);
    activeGoal = {
      description: String(args.goalDescription || 'Minecraft goal'),
      successCriteria: String(args.successCriteria || 'The requested goal is complete.'),
      initiator,
      iterations: 0,
      maxIterations: 8
    };
    setTimeout(runGoalIteration, 2000);
    return { summary: `started goal loop: ${activeGoal.description}` };
  }

  throw new Error(`Unknown tool "${name}"`);
}

bot.on('spawn', () => {
  console.log('[AIGuy] Successfully spawned in the world as AIGuy!');
  const modelShort = currentModel.split('/').pop() || currentModel;
  bot.chat(`Hey everyone! AIGuy is here (powered by ${modelShort}) and ready to do some crazy cool stuff! 🚀 Let\'s build something amazing!`);
  bot.chat('[Hint: Type !tools to see what I can do, or !help for details!] 🛠️');
  
  // Start the smooth follow loop
  startFollowLoop();
});

bot.on('chat', (username, message) => {
  // Ignore own messages
  if (username === bot.username) return;

  console.log(`[Chat] ${username}: ${message}`);

  // Intercept offline help/follow commands instantly
  if (message.trim().startsWith('!')) {
    handleHelpCommand(username, message.trim());
    return;
  }

  // Automatically target the player who last chatted for following
  if (followTarget !== 'STAY_put') {
    followTarget = username;
  }

  queue.push({ username, message });
  processQueue();
});

bot.on('error', (err: any) => {
  if (err?.code === 'ECONNREFUSED') {
    connectionFailed = true;
    console.error('[AIGuy] Could not connect to localhost:25565. Start the Minecraft server first with: npm run start-server');
    return;
  }

  console.error('[AIGuy Error]', err);
});

bot.on('end', (reason) => {
  if (connectionFailed) {
    console.log('[AIGuy] Connection closed because the Minecraft server was not reachable.');
  } else {
    console.log('[AIGuy] Disconnected from server:', reason);
  }
  if (followInterval) clearInterval(followInterval);
});

// Smooth Follow Loop Implementation
function startFollowLoop() {
  if (followInterval) clearInterval(followInterval);

  followInterval = setInterval(() => {
    if (!followTarget || followTarget === 'STAY_put') {
      // Clear movement state if staying
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
      return;
    }

    const player = bot.players[followTarget];
    const playerEntity = player?.entity;
    if (!playerEntity) {
      // Player entity not loaded in this chunk yet, stop moving
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
      return;
    }

    const pPos = playerEntity.position;
    const bPos = bot.entity.position;

    const dx = pPos.x - bPos.x;
    const dz = pPos.z - bPos.z;
    const dist2D = Math.sqrt(dx * dx + dz * dz);

    // Look at player's chest level (offset by 1.2 blocks vertically)
    bot.lookAt(pPos.offset(0, 1.2, 0));

    if (dist2D > 35) {
      // Teleport if too far
      bot.chat(`/tp AIGuy ${followTarget}`);
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
      console.log(`[Follow] Teleporting AIGuy to ${followTarget} (distance: ${dist2D.toFixed(1)}m)`);
    } else if (dist2D > 3.0) {
      // Walk forward
      bot.setControlState('forward', true);

      // Auto-jump if there's a block directly in front of the bot
      const yaw = bot.entity.yaw;
      const forwardX = -Math.sin(yaw);
      const forwardZ = -Math.cos(yaw);
      
      // Check block at feet level and chest level in front
      const blockFeet = bot.blockAt(bPos.offset(forwardX * 0.8, 0, forwardZ * 0.8));
      const blockChest = bot.blockAt(bPos.offset(forwardX * 0.8, 1.0, forwardZ * 0.8));
      
      const hasObstacle = (blockFeet && blockFeet.name !== 'air' && blockFeet.name !== 'cave_air' && blockFeet.name !== 'void_air') ||
                          (blockChest && blockChest.name !== 'air' && blockChest.name !== 'cave_air' && blockChest.name !== 'void_air');

      if (hasObstacle) {
        bot.setControlState('jump', true);
      } else {
        bot.setControlState('jump', false);
      }
    } else {
      // Close enough, stop
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
    }
  }, 100); // Run every 100ms for ultra-smooth rendering and response
}

// Offline Help and Follow Command Handler
function handleHelpCommand(username: string, message: string) {
  const parts = message.split(' ').filter(p => p.length > 0);
  const cmd = parts[0].toLowerCase();

  // Stay / Stop Command
  if (cmd === '!stay' || cmd === '!stop') {
    followTarget = 'STAY_put';
    bot.chat(`AIGuy: Okay, staying right here! 🛑 Standing guard!`);
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
    return;
  }

  // Follow Command
  if (cmd === '!follow') {
    followTarget = username;
    bot.chat(`AIGuy: On my way! 🏃 Following ${username} closely!`);
    return;
  }

  if (cmd === '!city' || cmd === '!nyc') {
    activeGoal = null;
    bot.chat(`AIGuy: Building a deterministic NYC-style city right here. Roads, towers, park, bridge, statue, lights. 🏙️`);

    try {
      const skill = runSkill('nycCity', { player: username });
      void executeCommandSteps(skill.commands, 'AIGuy Direct City', 70)
        .then(() => {
          bot.chat(`AIGuy: NYC-style city build complete! Fly up and look around the skyline. 🎆`);
        })
        .catch((err: any) => {
          const errMsg = err?.message || String(err);
          console.error('[AIGuy Direct City Error]', err);
          bot.chat(`AIGuy: I hit an error while building the city: ${errMsg}`);
        });
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error('[AIGuy Direct City Setup Error]', err);
      bot.chat(`AIGuy: I could not start the city build: ${errMsg}`);
    }
    return;
  }

  // Model Switch Command
  if (cmd === '!model') {
    if (parts.length < 2) {
      const modelShort = currentModel.split('/').pop() || currentModel;
      bot.chat(`AIGuy: 🧠 Current model: ${currentModel} (${modelShort})`);
      bot.chat(`Usage: !model <model-id> (e.g. !model z-ai/glm-5.2)`);
      bot.chat(`Shortcuts: ${Object.keys(AVAILABLE_MODELS).join(', ')}`);
      return;
    }
    const requested = parts.slice(1).join(' ');
    const resolved = AVAILABLE_MODELS[requested] || requested;
    currentModel = resolved;
    const modelShort = resolved.split('/').pop() || resolved;
    bot.chat(`AIGuy: 🧠 Switched brain to ${modelShort}! (${resolved}) Let's see what this one can do! 🚀`);
    console.log(`[AIGuy] Model switched to: ${resolved}`);
    // Clear chat history when switching models for a clean slate
    chatHistory.length = 0;
    return;
  }

  // Tools / Help list
  if (cmd === '!tools' || (cmd === '!help' && parts.length === 1)) {
    bot.chat(`AIGuy: 🛠️ Available Tools:`);
    bot.chat(`1. chat - Send a message to players.`);
    bot.chat(`2. executeCommands - Run Minecraft slash commands instantly.`);
    bot.chat(`3. giveItem / setPlayerEffect / spawnEntity - Safer structured command helpers.`);
    bot.chat(`4. setWorldState / createParticleEffect / launchFireworks - World and show controls.`);
    bot.chat(`5. buildShape / scanArea / runCommandSequence - Building, inspection, and timed sequences.`);
    bot.chat(`6. runSkill - Combo skills: ${getSkillNames().join(', ')}`);
    bot.chat(`7. startGoalLoop - Run an autonomous, self-verifying build cycle.`);
    bot.chat(`8. !model <id> - Switch AI model on the fly! 🧠`);
    bot.chat(`👉 Direct Commands: !city / !nyc builds a reliable city; !stay makes me stay; !follow makes me follow you!`);
    bot.chat(`👉 Type "!help <tool>" (e.g., !help startGoalLoop) to learn how they work!`);
    return;
  }

  if (cmd === '!help' && parts.length > 1) {
    const toolName = parts[1].toLowerCase();
    if (toolName === 'chat') {
      bot.chat(`AIGuy: 💬 Tool: chat`);
      bot.chat(`- Description: Sends a text message in the game chat.`);
      bot.chat(`- Usage: AIGuy uses this to talk to you, tell jokes, and give updates.`);
    } else if (toolName === 'executecommands' || toolName === 'commands') {
      bot.chat(`AIGuy: ⚡ Tool: executeCommands`);
      bot.chat(`- Description: Runs Minecraft console commands.`);
      bot.chat(`- Usage: Used to build structures (/fill), summon mobs (/summon), set blocks (/setblock), and teleport (/tp) instantly.`);
    } else if (toolName === 'giveitem' || toolName === 'item') {
      bot.chat(`AIGuy: 🎁 Tool: giveItem`);
      bot.chat(`- Description: Gives items with names, lore, enchantments, and unbreakable gear without messy /give NBT.`);
    } else if (toolName === 'setplayereffect' || toolName === 'effect') {
      bot.chat(`AIGuy: ✨ Tool: setPlayerEffect`);
      bot.chat(`- Description: Applies potion effects like speed, jump boost, night vision, glowing, or resistance.`);
    } else if (toolName === 'spawnentity' || toolName === 'summon') {
      bot.chat(`AIGuy: 🐲 Tool: spawnEntity`);
      bot.chat(`- Description: Summons mobs/entities with names, glowing, NoAI, equipment, and simple offsets.`);
    } else if (toolName === 'setworldstate' || toolName === 'world') {
      bot.chat(`AIGuy: 🌤️ Tool: setWorldState`);
      bot.chat(`- Description: Changes time, weather, and gamerules like keepInventory or mobGriefing.`);
    } else if (toolName === 'createparticleeffect' || toolName === 'particles') {
      bot.chat(`AIGuy: 🎆 Tool: createParticleEffect`);
      bot.chat(`- Description: Creates named effects like flame trails, heart bursts, portal swirls, and totem confetti.`);
    } else if (toolName === 'launchfireworks' || toolName === 'fireworks') {
      bot.chat(`AIGuy: 🎇 Tool: launchFireworks`);
      bot.chat(`- Description: Launches single rockets, barrages, rings, or finales without hand-writing firework NBT.`);
    } else if (toolName === 'buildshape' || toolName === 'shape') {
      bot.chat(`AIGuy: 🏗️ Tool: buildShape`);
      bot.chat(`- Description: Builds spheres, domes, pyramids, walls, floors, cubes, and bridges from parameters.`);
    } else if (toolName === 'scanarea' || toolName === 'scan') {
      bot.chat(`AIGuy: 🔎 Tool: scanArea`);
      bot.chat(`- Description: Scans nearby blocks/entities on demand and summarizes what is around the player.`);
    } else if (toolName === 'runcommandsequence' || toolName === 'sequence') {
      bot.chat(`AIGuy: ⏱️ Tool: runCommandSequence`);
      bot.chat(`- Description: Runs commands with delays for choreographed shows and staged builds.`);
    } else if (toolName === 'runskill' || toolName === 'skill') {
      bot.chat(`AIGuy: 🌟 Tool: runSkill`);
      bot.chat(`- Description: Runs combo skills: ${getSkillNames().join(', ')}`);
    } else if (toolName === 'city' || toolName === 'nyc') {
      bot.chat(`AIGuy: 🏙️ Command: !city / !nyc`);
      bot.chat(`- Description: Runs a deterministic NYC-style city build with roads, towers, a park, bridge, statue, lights, and fireworks.`);
      bot.chat(`- Usage: Stand where you want the city centered, then type !city.`);
    } else if (toolName === 'startgoalloop' || toolName === 'goalloop' || toolName === 'goal') {
      bot.chat(`AIGuy: 🤖 Tool: startGoalLoop (Agent Mode)`);
      bot.chat(`- Description: Starts an autonomous loop where AIGuy builds, scans, and verifies progress until a success criteria is met.`);
      bot.chat(`- How to trigger: Ask AIGuy to do a multi-step project and specify a goal and success criteria!`);
      bot.chat(`- Example: "build a gold tower 5 blocks high next to me"`);
      bot.chat(`- To stop: Type "cancel goal" or "stop goal" in chat.`);
    } else if (toolName === 'model') {
      bot.chat(`AIGuy: 🧠 Command: !model`);
      bot.chat(`- Usage: !model <model-id> to switch, or !model to see current model.`);
      bot.chat(`- Shortcuts: ${Object.keys(AVAILABLE_MODELS).join(', ')}`);
      bot.chat(`- Or use a full OpenRouter model ID like: anthropic/claude-sonnet-4`);
    } else {
      bot.chat(`AIGuy: ❓ Unknown tool: ${parts[1]}. Type !tools for a list of available tools.`);
    }
    return;
  }
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  const { username, message } = queue.shift()!;

  try {
    await handleMessage(username, message);
  } catch (err: any) {
    console.error('[Error processing message]', err);
    
    // Determine the type of error to give friendly in-game feedback
    const errMsg = err.message || String(err);
    let friendlyMessage = 'Oops, my brain short-circuited! Let\'s try that again. 🧠⚡';
    
    if (errMsg.includes('API_KEY') || errMsg.includes('API key') || errMsg.includes('key not valid') || errMsg.includes('403') || errMsg.includes('401')) {
      friendlyMessage = `Oops, my brain short-circuited due to an OpenRouter API key issue! 🔑 Please check if the OPENROUTER_API_KEY is correct. [Details: ${errMsg}]`;
    } else if (errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('LimitExceeded') || errMsg.includes('rate_limit')) {
      friendlyMessage = `Oops! I've run out of OpenRouter credits or hit a rate limit! 📉 [Details: ${errMsg}]`;
    } else if (errMsg.includes('fetch failed') || errMsg.includes('ENOTFOUND') || errMsg.includes('ETIMEDOUT') || errMsg.includes('network')) {
      friendlyMessage = `Oops! I lost connection to the OpenRouter AI servers. 🌐 Please check your internet connection.`;
    } else if (errMsg.includes('model_not_found') || errMsg.includes('does not exist')) {
      friendlyMessage = `Oops! The model "${currentModel}" wasn't found on OpenRouter. 🤷 Try !model to switch models.`;
    } else {
      friendlyMessage = `Oops, my brain short-circuited! 🧠⚡ [Error: ${errMsg}]`;
    }
    
    bot.chat(friendlyMessage);
  } finally {
    isProcessing = false;
    // Process next message in queue
    processQueue();
  }
}

// Generates a descriptive string of nearby blocks and entities
function getNearbyContext(
  playerUsername: string,
  options: { radius?: number; maxBlocks?: number; includeGround?: boolean } = {}
): string {
  const player = bot.players[playerUsername];
  const centerPos = player?.entity?.position || bot.entity?.position;
  if (!centerPos) return 'No nearby coordinates available.';

  const radius = options.radius ?? 15;
  const maxBlocks = options.maxBlocks ?? 80;
  const center = centerPos.floored();
  const interestingBlocks: any[] = [];
  const blockCounts: Record<string, number> = {};

  // Determine ground level dynamically to filter out flat floor blocks
  let groundLevel = -60; // Default for 1.20.4 flat world
  const lowestY = Math.min(
    ...Object.values(bot.players)
      .map(p => p.entity?.position?.y)
      .filter((y): y is number => y !== undefined),
    bot.entity?.position?.y || 0
  );
  if (lowestY !== undefined) {
    groundLevel = Math.floor(lowestY) - 1;
  }

  // Scan 3D block area
  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        const blockPos = center.offset(x, y, z);
        const block = bot.blockAt(blockPos);
        if (!block) continue;

        const name = block.name;
        if (name === 'air' || name === 'cave_air' || name === 'void_air') continue;
        if (name === 'bedrock') continue;

        // Skip ground floor blocks to avoid prompt bloat
        if (!options.includeGround && (name === 'grass_block' || name === 'dirt' || name === 'stone') && blockPos.y <= groundLevel) {
          continue;
        }

        const dist = Math.sqrt(x * x + y * y + z * z);
        blockCounts[name] = (blockCounts[name] || 0) + 1;
        interestingBlocks.push({
          name,
          x: blockPos.x,
          y: blockPos.y,
          z: blockPos.z,
          rx: x,
          ry: y,
          rz: z,
          dist
        });
      }
    }
  }

  // Sort blocks by distance and cap at 80 items
  interestingBlocks.sort((a, b) => a.dist - b.dist);
  const cappedBlocks = interestingBlocks.slice(0, maxBlocks);

  let blocksText = options.includeGround
    ? `Nearby blocks (${interestingBlocks.length} found, showing ${cappedBlocks.length}):\n`
    : `Nearby blocks (excluding flat ground floor; ${interestingBlocks.length} found, showing ${cappedBlocks.length}):\n`;
  if (cappedBlocks.length === 0) {
    blocksText += 'None found.\n';
  } else {
    cappedBlocks.forEach(b => {
      const rxStr = b.rx >= 0 ? `+${b.rx}` : `${b.rx}`;
      const ryStr = b.ry >= 0 ? `+${b.ry}` : `${b.ry}`;
      const rzStr = b.rz >= 0 ? `+${b.rz}` : `${b.rz}`;
      blocksText += `- ${b.name} at (${b.x}, ${b.y}, ${b.z}) [relative to player: ${rxStr}, ${ryStr}, ${rzStr}]\n`;
    });
  }

  const commonMaterials = Object.entries(blockCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => `${name} x${count}`)
    .join(', ');
  if (commonMaterials) {
    blocksText += `Common scanned materials: ${commonMaterials}\n`;
  }

  // Scan entities (mobs, items, players)
  const entities: any[] = [];
  for (const id in bot.entities) {
    const entity = bot.entities[id];
    if (!entity) continue;
    if (entity.username === 'AIGuy') continue; // Skip itself

    const pos = entity.position;
    const dx = pos.x - centerPos.x;
    const dy = pos.y - centerPos.y;
    const dz = pos.z - centerPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist <= radius + 5) {
      entities.push({
        type: entity.type,
        name: entity.username || entity.name || entity.displayName || 'unknown',
        x: pos.x.toFixed(1),
        y: pos.y.toFixed(1),
        z: pos.z.toFixed(1),
        rx: dx.toFixed(1),
        ry: dy.toFixed(1),
        rz: dz.toFixed(1),
        dist
      });
    }
  }

  entities.sort((a, b) => a.dist - b.dist);
  let entitiesText = 'Nearby entities:\n';
  if (entities.length === 0) {
    entitiesText += 'None found.\n';
  } else {
    entities.forEach(e => {
      entitiesText += `- ${e.type} named "${e.name}" at (${e.x}, ${e.y}, ${e.z}) [relative to player: ${e.rx}, ${e.ry}, ${e.rz}]\n`;
    });
  }

  return `${blocksText}\n${entitiesText}`;
}

async function handleMessage(username: string, message: string) {
  // If the user wants to cancel an active goal
  if (message.toLowerCase().includes('cancel goal') || message.toLowerCase().includes('stop goal')) {
    if (activeGoal) {
      bot.chat(`AIGuy: *Stopped active goal loop!* ⏹️`);
      activeGoal = null;
      return;
    }
  }

  // Show thinking indicator in-game
  bot.chat(`/me is thinking about what ${username} said... 🤔`);

  // Build real-time nearby context (passive vision)
  const visionContext = getNearbyContext(username);

  const player = bot.players[username];
  const playerPos = player?.entity?.position;
  const playerPosStr = playerPos 
    ? `${username} is at (${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)})` 
    : `${username} position unknown`;

  const botPos = bot.entity?.position;
  const botInfo = botPos 
    ? `AIGuy is at (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)})` 
    : 'AIGuy position unknown';

  const context = `[System Context]\n${playerPosStr}\n${botInfo}\n\n${visionContext}\nTime of day: ${bot.time.timeOfDay}`;

  console.log(`[Vision Context sent to ${currentModel}]:\n${context}`);

  // Add user message with vision context to history
  chatHistory.push({
    role: 'user',
    content: `${context}\n\n${username}: ${message}`
  });

  // Keep history size manageable (last 20 turns)
  if (chatHistory.length > 20) {
    chatHistory.shift();
  }

  // Call OpenRouter
  const response = await openai.chat.completions.create({
    model: currentModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...chatHistory
    ],
    tools: CHAT_TOOLS,
    tool_choice: 'auto',
  });

  const choice = response.choices[0];
  const responseMessage = choice.message;
  const toolCalls = responseMessage.tool_calls;
  const textResponse = responseMessage.content;
  const actionSummaries: string[] = [];

  // Execute actions
  if (toolCalls && toolCalls.length > 0) {
    for (const call of toolCalls) {
      const result = await executeToolCall(call, username, 'AIGuy Action');
      actionSummaries.push(result.summary);
    }
  } else if (textResponse) {
    bot.chat(textResponse);
  }

  // Append model turn to history
  const modelContent = [
    textResponse,
    actionSummaries.length > 0 ? `[Tool actions: ${actionSummaries.join(' | ')}]` : null,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n') || null;

  const modelMessage: OpenAI.ChatCompletionMessageParam = {
    role: 'assistant' as const,
    content: modelContent,
  };

  chatHistory.push(modelMessage);
}

// Autonomous Goal Loop Iteration
async function runGoalIteration() {
  if (!activeGoal) return;

  activeGoal.iterations++;

  // Exit if maximum steps reached
  if (activeGoal.iterations > activeGoal.maxIterations) {
    bot.chat(`AIGuy: *I've worked on this for ${activeGoal.maxIterations} steps, but couldn't quite verify success. Pausing autonomous mode!* ⏹️`);
    activeGoal = null;
    return;
  }

  bot.chat(`/me is checking progress... (Step ${activeGoal.iterations}/${activeGoal.maxIterations}) 🔎`);

  // Get fresh environment data
  const visionContext = getNearbyContext(activeGoal.initiator);

  const goalPrompt = `
You are currently running in AUTONOMOUS GOAL LOOP mode.
Your active goal: "${activeGoal.description}"
Success criteria: "${activeGoal.successCriteria}"

Current Step: ${activeGoal.iterations} of ${activeGoal.maxIterations}

Current Environment Context:
${visionContext}

Your task:
1. Analyze the environment context and assess if the success criteria has been met.
2. If the success criteria has been met, call the \`completeGoal\` tool with a brief explanation.
3. If the success criteria has NOT been met:
   - Prefer structured tools like buildShape, scanArea, giveItem, spawnEntity, setWorldState, createParticleEffect, launchFireworks, runCommandSequence, or runSkill when they fit.
   - Call the \`executeCommands\` tool only for custom commands that do not fit a structured tool.
   - Optionally call the \`chat\` tool to update the players on your progress or what you are doing.

CRITICAL COORDINATE CONSISTENCY REMINDER:
- You MUST be 100% consistent with your coordinates! 
- If you used relative coordinates with '/execute at <player_username> run <command>' (e.g. ~ ~ ~) in previous steps, you MUST continue using relative coordinates with '/execute at <player_username> run <command>' in this step!
- NEVER mix absolute coordinates (like "10 -60 25") and relative coordinates (like "~ ~ ~") in the same project, or the parts of your build will spawn in completely different locations!
- Do not guess! Look at the "Nearby blocks" and "Nearby entities" coordinates in the context to verify if they are placed correctly.
`;

  try {
    const response = await openai.chat.completions.create({
      model: currentModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: goalPrompt }
      ],
      tools: GOAL_TOOLS,
      tool_choice: 'auto',
    });

    const choice = response.choices[0];
    const responseMessage = choice.message;
    const toolCalls = responseMessage.tool_calls;
    const textResponse = responseMessage.content;
    let isCompleted = false;

    if (toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments);
        
        if (call.function.name === 'completeGoal') {
          bot.chat(`AIGuy: 🎉 Goal Achieved! ${args.summary}`);
          activeGoal = null;
          isCompleted = true;
          break;
        } else {
          await executeToolCall(call, activeGoal.initiator, 'AIGuy Goal Action');
        }
      }
    } else if (textResponse) {
      bot.chat(textResponse);
    }

    // Schedule next step if not complete
    if (!isCompleted && activeGoal) {
      // Wait 6 seconds for block updates to settle before checking again
      setTimeout(runGoalIteration, 6000);
    }
  } catch (err: any) {
    console.error('[Error in goal loop iteration]', err);
    const errMsg = err.message || String(err);
    bot.chat(`AIGuy: 🤖⚠️ I ran into an error during my autonomous goal loop! [Error: ${errMsg}]`);
    if (activeGoal) {
      setTimeout(runGoalIteration, 6000);
    }
  }
}
