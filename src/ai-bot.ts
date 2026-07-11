import mineflayer from 'mineflayer';
import OpenAI from 'openai';
import { getSkillNames, runSkill, type TimedCommand } from './skills.js';
import { loadMemory, addFact, addWaypoint, getFacts, getWaypoints, memorySummaryForPrompt } from './memory.js';
import { loadPersonas, getPersona, listPersonas, savePersona, personaPromptSection, type PersonaConfig } from './personas.js';
import { loadBrainConfig, saveBrainConfig, type BrainConfig } from './config.js';
import { CrewMember } from './crew.js';

// ─── Model Configuration ───────────────────────────────────────────────────────
// Three brains, all via OpenRouter:
//  - regular:  cheap/fast, handles chat, tool calls, and goal-loop execution
//  - planner:  premium, called ONCE per goal to produce a build blueprint
//  - qaVision: independent inspector that verifies goal progress (and later,
//              screenshots) so the builder never grades its own work
const MODEL_ALIASES: Record<string, string> = {
  'glm':       'z-ai/glm-5.2',
  'glm-5.2':   'z-ai/glm-5.2',
  'cheap':     'z-ai/glm-5.2',
  'gpt55':     'openai/gpt-5.5',
  'premium':   'openai/gpt-5.5',
  'gemini':    'google/gemini-3.5-flash',
  'flash':     'google/gemini-3.5-flash',
};

function resolveModelId(requested: string): string {
  return MODEL_ALIASES[requested.toLowerCase()] || requested;
}

// Parse optional --model flag from CLI args (overrides the regular brain for this run)
function getModelFromArgs(): string | null {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf('--model');
  if (modelIdx !== -1 && args[modelIdx + 1]) {
    return resolveModelId(args[modelIdx + 1]);
  }
  return null;
}

const brains: BrainConfig = loadBrainConfig({
  regular: process.env.OPENROUTER_REGULAR_MODEL || 'z-ai/glm-5.2',
  planner: process.env.OPENROUTER_PLANNER_MODEL || 'openai/gpt-5.5',
  qaVision: process.env.OPENROUTER_QA_VISION_MODEL || 'google/gemini-3.5-flash',
});

const cliModel = getModelFromArgs();
if (cliModel) brains.regular = cliModel;

function describeBrains(): string[] {
  return [
    `- Regular: ${brains.regular}`,
    `- Planner: ${brains.planner}`,
    `- QA/Vision: ${brains.qaVision}`,
  ];
}

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
- Castle with secret lair: prefer runSkill with skillName "castleLair". Players can also type !castle, and castle requests are auto-routed to the deterministic castle builder.
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
- You have PERSISTENT MEMORY! The [Persistent Memory] section below lists facts and saved waypoints from past sessions. Call the \`rememberFact\` tool whenever a player shares something personal (favorite mob, a cool moment, an inside joke), and the \`saveWaypoint\` tool to save important places by name. To take a player back to a saved waypoint, run /tp <player> <x> <y> <z> using the saved coordinates.
- You have an AUTONOMOUS GOAL LOOP mode! If a player asks you to build or accomplish a complex task that requires multiple steps, verification, or iterative building, you can call the \`startGoalLoop\` tool. This will put you into an autonomous loop where you will automatically scan the environment, execute commands, check your own progress, and iterate until the success criteria is met!
  * Use the goal loop for multi-step projects like building a castle, a house, a tower, or cleaning up and verifying a large area.
  * Do NOT use the goal loop for simple, single-command requests (like summoning a single mob or placing a single block).
- You have an embodied BUILD CREW! During autonomous goal builds, two teammate players may pop in: "Blueprint" 📐 (surveys the site and announces the plan) and "Inspector" 🔎 (circles the build and checks the work between steps). They are part of your team — talk about them warmly if players ask. They have no OP powers; you run all the commands yourself.

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

// ─── Personas and Persistent Memory ────────────────────────────────────────────
loadMemory();
loadPersonas();
let activePersona: PersonaConfig = getPersona('aiguy')!;

function buildSystemPrompt(): string {
  const personaSection = personaPromptSection(activePersona);
  const parts = [SYSTEM_PROMPT];
  if (personaSection) {
    parts.push(`[Active Persona: ${activePersona.displayName}]\n${personaSection}`);
  }
  parts.push(`[Persistent Memory]\n${memorySummaryForPrompt()}`);
  return parts.join('\n\n');
}

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

const REMEMBER_FACT_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'rememberFact',
    description: 'Permanently remember a fact about a player (favorite things, cool moments, inside jokes). Saved to disk and recalled in future sessions.',
    parameters: {
      type: 'object',
      properties: {
        about: { type: 'string', description: 'Who the fact is about. Defaults to the player who is chatting.' },
        fact: { type: 'string', description: 'The fact to remember, e.g. "his favorite mob is the axolotl".' }
      },
      required: ['fact']
    }
  }
};

const SAVE_WAYPOINT_TOOL: OpenAI.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'saveWaypoint',
    description: 'Save a named waypoint at the current player/anchor position so you can teleport players back to it in any future session.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short memorable name, e.g. "our castle" or "spleef arena".' },
        description: { type: 'string', description: 'Optional one-line description of what is there.' },
        player: { type: 'string', description: 'Player whose position to save. Defaults to the player who asked.' }
      },
      required: ['name']
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
  REMEMBER_FACT_TOOL,
  SAVE_WAYPOINT_TOOL,
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
console.log(`[AIGuy] Brains: regular=${brains.regular}, planner=${brains.planner}, qaVision=${brains.qaVision}`);
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
  anchor?: CommandAnchor;
  iterations: number;
  maxIterations: number;
  totalCommandsIssued: number;
  totalBuildCommandsIssued: number;
  stalledIterations: number;
  lastActionSummary?: string;
  lastDebugNote?: string;
  commandLog: string[];
  plan?: string;
  lastQaCritique?: string;
}

let activeGoal: ActiveGoal | null = null;

// Busy guard: only one build stream (direct skill or goal loop) may run at a time,
// otherwise two command streams interleave into the same world.
let directBuildLabel: string | null = null;

function currentBuildActivity(): string | null {
  if (directBuildLabel) return directBuildLabel;
  if (activeGoal) return `the goal "${activeGoal.description}"`;
  return null;
}

// ─── Embodied Crew ──────────────────────────────────────────────────────────────
// The planner and QA brains get real bodies: Blueprint surveys the site while
// the plan is generated, Inspector circles the build between steps and delivers
// the verdicts. They pop in when a goal starts and leave when it ends. Only
// AIGuy has OP — the crew are ordinary players that AIGuy teleports around.
let crewEnabled = process.env.AIGUY_CREW !== 'off';
const plannerBody = new CrewMember('Blueprint', 'planner', { host: 'localhost', port: 25565 });
const inspectorBody = new CrewMember('Inspector', 'QA', { host: 'localhost', port: 25565 });
const CREW_USERNAMES = new Set([plannerBody.username, inspectorBody.username]);
let inspectorAngle = 0;

function teleportCrewMember(member: CrewMember, x: number, y: number, z: number) {
  if (!member.isOnline()) return;
  bot.chat(`/tp ${member.username} ${formatAbsoluteCoord(x)} ${formatAbsoluteCoord(y)} ${formatAbsoluteCoord(z)}`);
}

// Teleport a crew member to a spot on a circle around the anchor, facing it.
function stageCrewMemberAroundAnchor(member: CrewMember, anchor: CommandAnchor, angle: number, radius: number) {
  teleportCrewMember(
    member,
    anchor.x + Math.cos(angle) * radius,
    anchor.y,
    anchor.z + Math.sin(angle) * radius
  );
  setTimeout(() => member.lookAt(anchor.x, anchor.y + 2, anchor.z), 400);
}

function dismissCrew() {
  plannerBody.leave('Blueprint out! 📐✨');
  inspectorBody.leave('Inspection wrapped — Inspector out! 🔎');
}

// Auto-save a waypoint whenever a build completes so "take me back to the
// castle" works in any future session.
function recordBuildWaypoint(label: string, anchor: CommandAnchor) {
  try {
    const wp = addWaypoint(label, anchor.x, anchor.y, anchor.z, `Built with ${anchor.player}`);
    bot.chat(`AIGuy: 📍 Saved "${wp.name}" to my memory at (${wp.x}, ${wp.y}, ${wp.z}) — ask me to take you back anytime!`);
  } catch (err) {
    console.error('[Memory] Failed to record build waypoint:', err);
  }
}

// Follow Behavior State
let followTarget: string | null = null;
let followInterval: NodeJS.Timeout | null = null;

// Queue to process chat messages sequentially
const queue: { username: string; message: string }[] = [];
let isProcessing = false;

interface ToolExecutionResult {
  summary: string;
  commandCount: number;
  buildCommandCount: number;
  mutatingCommandCount: number;
  anchoredCommandCount: number;
  executedCommands: string[];
  chatOnly?: boolean;
  scanOnly?: boolean;
}

interface CommandExecutionStats {
  commandCount: number;
  buildCommandCount: number;
  mutatingCommandCount: number;
  anchoredCommandCount: number;
  executedCommands: string[];
}

interface CommandAnchor {
  player: string;
  x: number;
  y: number;
  z: number;
}

interface CommandExecutionOptions {
  anchor?: CommandAnchor;
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

// Commands the model must never run on a kid's server, even with OP.
const BLOCKED_COMMAND_VERBS = new Set([
  'stop',
  'op',
  'deop',
  'ban',
  'ban-ip',
  'pardon',
  'pardon-ip',
  'whitelist',
  'kick',
  'save-off',
  'reload',
]);

function botGameMode(): string {
  return (bot.game as any)?.gameMode || 'unknown';
}

function inCreativeMode(): boolean {
  return botGameMode() === 'creative';
}

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

function formatAbsoluteCoord(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function captureCommandAnchor(playerName: string): CommandAnchor | undefined {
  const player = bot.players[playerName];
  const pos = player?.entity?.position;
  if (!pos) return undefined;

  return {
    player: playerName,
    x: pos.x,
    y: pos.y,
    z: pos.z,
  };
}

/** Retry anchor capture with short delays, teleporting to the player first if needed. */
async function captureCommandAnchorWithRetry(
  playerName: string,
  retries = 5,
  delayMs = 1500
): Promise<CommandAnchor | undefined> {
  // First attempt — might already be in range
  let anchor = captureCommandAnchor(playerName);
  if (anchor) return anchor;

  // Teleport the bot to the player so their entity loads
  console.log(`[Anchor] Player entity not visible, teleporting AIGuy to ${playerName}...`);
  bot.chat(`/tp AIGuy ${playerName}`);

  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, delayMs));
    anchor = captureCommandAnchor(playerName);
    if (anchor) {
      console.log(`[Anchor] Captured after ${i + 1} retries: ${describeAnchor(anchor)}`);
      return anchor;
    }
    console.log(`[Anchor] Retry ${i + 1}/${retries} — still can't see ${playerName}'s entity`);
  }

  console.warn(`[Anchor] Failed to capture anchor for ${playerName} after ${retries} retries.`);
  return undefined;
}

function describeAnchor(anchor: CommandAnchor | undefined): string {
  if (!anchor) return 'no fixed anchor';
  return `${anchor.player} @ ${formatAbsoluteCoord(anchor.x)} ${formatAbsoluteCoord(anchor.y)} ${formatAbsoluteCoord(anchor.z)}`;
}

function anchorCommand(command: string, anchor?: CommandAnchor): { command: string; anchored: boolean } {
  const normalized = normalizeCommand(command);
  if (!anchor) return { command: normalized, anchored: false };

  // Anchor commands aimed at the requesting player, but also generic player
  // selectors (@p/@s/@a) so builds can't drift when the model uses those instead.
  const pattern = new RegExp(
    `^/execute\\s+at\\s+(?:${escapeRegex(anchor.player)}|@[psa](?:\\[[A-Za-z0-9_=,!:.+\\-]*])?)\\s+run\\s+(.+)$`,
    'i'
  );
  const match = normalized.match(pattern);
  if (!match) return { command: normalized, anchored: false };

  const innerCommand = match[1];
  return {
    command:
      `/execute positioned ${formatAbsoluteCoord(anchor.x)} ${formatAbsoluteCoord(anchor.y)} ${formatAbsoluteCoord(anchor.z)} run ${innerCommand}`,
    anchored: true,
  };
}

function isCastleBuildIntent(message: string): boolean {
  const normalized = message.toLowerCase();
  const mentionsCastle = /\b(castle|fortress)\b/.test(normalized) || normalized.includes('secret lair');
  const hasBuildVerb = /\b(build|make|create|construct)\b/.test(normalized);
  const soundsNegative = /\b(don'?t|do not|not|no|stop|cancel|never|hate)\b/.test(normalized);
  return mentionsCastle && hasBuildVerb && !soundsNegative;
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
  const size = clampInt(args.size, 1, 12, 4);
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

function getCommandVerb(command: string): string {
  const normalized = normalizeCommand(command).trim();
  const withoutSlash = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  const parts = withoutSlash.split(/\s+/);

  if (parts[0] === 'execute') {
    const runIndex = parts.indexOf('run');
    if (runIndex >= 0 && parts[runIndex + 1]) return parts[runIndex + 1].toLowerCase();
  }

  return (parts[0] || '').toLowerCase();
}

function getCommandExecutionStats(steps: TimedCommand[]): CommandExecutionStats {
  const buildVerbs = new Set(['fill', 'setblock', 'clone']);
  const mutatingVerbs = new Set([
    'fill',
    'setblock',
    'clone',
    'summon',
    'give',
    'effect',
    'time',
    'weather',
    'gamerule',
    'title',
    'playsound',
    'particle',
    'tp',
    'kill',
    'scoreboard',
  ]);

  let buildCommandCount = 0;
  let mutatingCommandCount = 0;

  for (const step of steps) {
    const verb = getCommandVerb(step.command);
    if (buildVerbs.has(verb)) buildCommandCount++;
    if (mutatingVerbs.has(verb)) mutatingCommandCount++;
  }

  return {
    commandCount: steps.length,
    buildCommandCount,
    mutatingCommandCount,
    anchoredCommandCount: 0,
    executedCommands: [],
  };
}

function toolResult(summary: string, stats: Partial<CommandExecutionStats> = {}, flags: Pick<ToolExecutionResult, 'chatOnly' | 'scanOnly'> = {}): ToolExecutionResult {
  return {
    summary,
    commandCount: stats.commandCount ?? 0,
    buildCommandCount: stats.buildCommandCount ?? 0,
    mutatingCommandCount: stats.mutatingCommandCount ?? 0,
    anchoredCommandCount: stats.anchoredCommandCount ?? 0,
    executedCommands: stats.executedCommands ?? [],
    ...flags,
  };
}

async function executeCommandSteps(
  steps: TimedCommand[],
  source: string,
  defaultDelayMs = 100,
  options: CommandExecutionOptions = {}
): Promise<CommandExecutionStats> {
  const stats = getCommandExecutionStats(steps);
  console.log(
    `[${source}] Command batch: total=${stats.commandCount}, build=${stats.buildCommandCount}, ` +
    `mutating=${stats.mutatingCommandCount}, anchor=${describeAnchor(options.anchor)}`
  );

  if (stats.mutatingCommandCount > 0 && !inCreativeMode()) {
    console.warn(`[${source}] Refusing ${stats.mutatingCommandCount} world-changing command(s): game mode is "${botGameMode()}", not creative.`);
    bot.chat(`AIGuy: I only do my building magic on creative mode servers! This world is in ${botGameMode()} mode, so I'll sit this one out. 🎨`);
    stats.commandCount = 0;
    stats.buildCommandCount = 0;
    stats.mutatingCommandCount = 0;
    return stats;
  }

  for (const step of steps) {
    const anchored = anchorCommand(step.command, options.anchor);
    const formattedCmd = anchored.command;
    const verb = getCommandVerb(formattedCmd);
    if (BLOCKED_COMMAND_VERBS.has(verb)) {
      console.warn(`[${source}] Blocked dangerous command verb "${verb}": ${formattedCmd}`);
      bot.chat(`AIGuy: Whoa, I'm not allowed to run /${verb} commands! Skipping that one. 🙅`);
      continue;
    }
    if ((verb === 'gamemode' || verb === 'defaultgamemode') && !/\bcreative\b/.test(formattedCmd)) {
      console.warn(`[${source}] Blocked game mode switch away from creative: ${formattedCmd}`);
      bot.chat(`AIGuy: I only play in creative mode, so I won't switch anyone to another game mode! 🎨`);
      continue;
    }
    if (anchored.anchored) stats.anchoredCommandCount++;
    if (formattedCmd.length > 256) {
      console.warn(`[${source}] Skipping overlong command (${formattedCmd.length} chars): ${formattedCmd.slice(0, 180)}...`);
      bot.chat(`AIGuy debug: Skipped one overlong command (${formattedCmd.length} chars) so I don't disconnect.`);
      await sleep(step.delayMs ?? defaultDelayMs);
      continue;
    }
    console.log(`[${source}] Running command: ${formattedCmd}`);
    bot.chat(formattedCmd);
    stats.executedCommands.push(formattedCmd);
    await sleep(step.delayMs ?? defaultDelayMs);
  }

  return stats;
}

async function executeToolCall(
  call: OpenAI.ChatCompletionMessageToolCall,
  initiator: string,
  source: string,
  options: CommandExecutionOptions = {}
): Promise<ToolExecutionResult> {
  const args = JSON.parse(call.function.arguments || '{}');
  const name = call.function.name;

  if (name === 'chat') {
    bot.chat(String(args.message || ''));
    return toolResult('sent a chat message', {}, { chatOnly: true });
  }

  if (name === 'executeCommands') {
    const commands = normalizeCommandSequence(args.commands);
    const stats = await executeCommandSteps(commands, source, 100, options);
    return toolResult(`ran ${commands.length} raw command(s)`, stats);
  }

  if (name === 'giveItem') {
    const commands = buildGiveItemCommands(args, initiator);
    const stats = await executeCommandSteps(commands, source, 100, options);
    return toolResult(`gave ${sanitizeResourceId(args.item, 'item')} to ${sanitizeTarget(args.player, initiator)}`, stats);
  }

  if (name === 'setPlayerEffect') {
    const commands = buildPlayerEffectCommands(args, initiator);
    const stats = await executeCommandSteps(commands, source, 100, options);
    return toolResult(`applied ${sanitizeResourceId(args.effect, 'effect')} to ${sanitizeTarget(args.player, initiator)}`, stats);
  }

  if (name === 'spawnEntity') {
    const commands = buildSpawnEntityCommands(args, initiator);
    const stats = await executeCommandSteps(commands, source, 100, options);
    return toolResult(`spawned ${commands.length} ${sanitizeResourceId(args.entity, 'entity')}(s)`, stats);
  }

  if (name === 'setWorldState') {
    const commands = buildWorldStateCommands(args);
    const stats = await executeCommandSteps(commands, source, 100, options);
    return toolResult(`updated world state with ${commands.length} command(s)`, stats);
  }

  if (name === 'createParticleEffect') {
    const commands = buildParticleCommands(args, initiator);
    const stats = await executeCommandSteps(commands, source, 100, options);
    return toolResult(`created ${args.effectName || 'particle'} effect`, stats);
  }

  if (name === 'launchFireworks') {
    const commands = buildFireworkCommands(args, initiator);
    const stats = await executeCommandSteps(commands, source, 250, options);
    return toolResult(`launched ${commands.length} firework(s)`, stats);
  }

  if (name === 'buildShape') {
    const commands = buildShapeCommands(args, initiator);
    const stats = await executeCommandSteps(commands, source, 20, options);
    return toolResult(`built ${args.shape || 'shape'} with ${commands.length} command(s)`, stats);
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
    return toolResult(summary, {}, { scanOnly: true });
  }

  if (name === 'runCommandSequence') {
    const commands = normalizeCommandSequence(args.commands);
    const stats = await executeCommandSteps(commands, source, 100, options);
    return toolResult(`ran timed sequence with ${commands.length} command(s)`, stats);
  }

  if (name === 'runSkill') {
    const skill = runSkill(String(args.skillName || ''), {
      player: sanitizeTarget(args.player, initiator),
      material: typeof args.material === 'string' ? args.material : undefined,
      size: typeof args.size === 'number' ? args.size : undefined,
      direction: args.direction,
    });
    bot.chat(`AIGuy: Running ${skill.name}! ${skill.description}`);
    const stats = await executeCommandSteps(skill.commands, source, 100, options);
    return toolResult(`ran skill ${skill.name} with ${skill.commands.length} command(s)`, stats);
  }

  if (name === 'rememberFact') {
    const about = typeof args.about === 'string' && args.about.trim() ? args.about : initiator;
    const fact = String(args.fact || '').trim();
    if (!fact) return toolResult('ignored empty fact', {}, { chatOnly: true });
    const saved = addFact(about, fact);
    console.log(`[Memory] Remembered fact about ${saved.about}: ${saved.fact}`);
    return toolResult(`remembered a fact about ${saved.about}`, {}, { chatOnly: true });
  }

  if (name === 'saveWaypoint') {
    const player = sanitizeTarget(args.player, initiator);
    const pos = options.anchor || captureCommandAnchor(player);
    if (!pos) return toolResult('could not save waypoint; no position available', {}, { chatOnly: true });
    const wp = addWaypoint(
      String(args.name || 'unnamed spot'),
      pos.x, pos.y, pos.z,
      typeof args.description === 'string' ? args.description : undefined
    );
    bot.chat(`AIGuy: 📍 Saved waypoint "${wp.name}" at (${wp.x}, ${wp.y}, ${wp.z})! I'll remember this spot even after a restart.`);
    return toolResult(`saved waypoint "${wp.name}"`, {}, { chatOnly: true });
  }

  if (name === 'startGoalLoop') {
    const busyWith = currentBuildActivity();
    if (busyWith) {
      bot.chat(`AIGuy: I'm still busy with ${busyWith}! One mega-project at a time — ask me again when I'm done (or say "cancel goal"). 🚧`);
      return toolResult(`declined new goal loop; already busy with ${busyWith}`, {}, { chatOnly: true });
    }
    bot.chat(`AIGuy: *Entering autonomous goal mode!* 🤖\n*Goal:* ${args.goalDescription}\n*Success Criteria:* ${args.successCriteria}`);

    // Ensure we have a valid anchor before starting — teleport to the player
    // and retry if their entity isn't loaded yet.
    const goalAnchor = options.anchor || await captureCommandAnchorWithRetry(initiator);
    if (!goalAnchor) {
      bot.chat(`AIGuy: I can't lock on to your position! 📍 Come a bit closer (or let me teleport to you) and ask again.`);
      return toolResult('could not capture anchor for goal; player entity not visible', {}, { chatOnly: true });
    }
    bot.chat(`AIGuy debug: Goal anchor locked at ${describeAnchor(goalAnchor)}.`);
    activeGoal = {
      description: String(args.goalDescription || 'Minecraft goal'),
      successCriteria: String(args.successCriteria || 'The requested goal is complete.'),
      initiator,
      anchor: goalAnchor,
      iterations: 0,
      maxIterations: 8,
      totalCommandsIssued: 0,
      totalBuildCommandsIssued: 0,
      stalledIterations: 0,
      commandLog: [],
    };
    void planGoalThenStart(activeGoal);
    return toolResult(`started goal loop: ${activeGoal.description}`);
  }

  throw new Error(`Unknown tool "${name}"`);
}

bot.on('spawn', () => {
  console.log('[AIGuy] Successfully spawned in the world as AIGuy!');
  const modelShort = brains.regular.split('/').pop() || brains.regular;
  bot.chat(`Hey everyone! AIGuy is here (powered by ${modelShort}) and ready to do some crazy cool stuff! 🚀 Let\'s build something amazing!`);
  bot.chat('[Hint: Type !tools to see what I can do, or !help for details!] 🛠️');

  if (!inCreativeMode()) {
    console.warn(`[AIGuy] World game mode is "${botGameMode()}", not creative. Building commands are disabled.`);
    bot.chat(`AIGuy: Heads up — this world is in ${botGameMode()} mode! I only do my building magic on creative servers, so I'll just chat and hang out. 🎨`);
  }
  
  // Start the smooth follow loop
  startFollowLoop();
});

bot.on('chat', (username, message) => {
  // Ignore own messages and the embodied crew's theater
  if (username === bot.username || CREW_USERNAMES.has(username)) return;

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

  if (isCastleBuildIntent(message)) {
    runDirectSkillCommand(username, 'castleLair', 'a huge castle with a secret underground lair', 70);
    return;
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
  dismissCrew();
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
    } else if (dist2D > (activePersona.followDistance ?? 3)) {
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
function runDirectSkillCommand(username: string, skillName: string, label: string, defaultDelayMs = 70) {
  const busyWith = currentBuildActivity();
  if (busyWith) {
    bot.chat(`AIGuy: Hang on, I'm still busy with ${busyWith}! Ask me again when it's done. 🚧`);
    return;
  }

  const anchor = captureCommandAnchor(username);
  bot.chat(`AIGuy: Building ${label} right here.`);
  bot.chat(`AIGuy debug: ${label} anchor locked at ${describeAnchor(anchor)}.`);

  try {
    const skill = runSkill(skillName, { player: username });
    directBuildLabel = label;
    void executeCommandSteps(skill.commands, `AIGuy Direct ${skill.name}`, defaultDelayMs, { anchor })
      .then((stats) => {
        bot.chat(
          `AIGuy: ${label} complete! Issued ${stats.commandCount} command(s), ` +
          `${stats.buildCommandCount} building command(s), anchored ${stats.anchoredCommandCount}.`
        );
        if (stats.buildCommandCount > 0 && anchor) {
          recordBuildWaypoint(label, anchor);
        }
      })
      .catch((err: any) => {
        const errMsg = err?.message || String(err);
        console.error(`[AIGuy Direct ${skillName} Error]`, err);
        bot.chat(`AIGuy: I hit an error while building ${label}: ${errMsg}`);
      })
      .finally(() => {
        directBuildLabel = null;
      });
  } catch (err: any) {
    directBuildLabel = null;
    const errMsg = err?.message || String(err);
    console.error(`[AIGuy Direct ${skillName} Setup Error]`, err);
    bot.chat(`AIGuy: I could not start ${label}: ${errMsg}`);
  }
}

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

  // Persona Commands
  if (cmd === '!persona') {
    if (parts.length < 2) {
      bot.chat(`AIGuy: 🎭 Current persona: ${activePersona.displayName} (${activePersona.name})`);
      bot.chat(`Available: ${listPersonas().map(p => p.name).join(', ')}`);
      bot.chat(`Usage: !persona <name> to switch, or !persona create <description> to invent a brand new one!`);
      return;
    }
    if (parts[1].toLowerCase() === 'create') {
      const description = parts.slice(2).join(' ').trim();
      if (!description) {
        bot.chat(`AIGuy: Tell me what the persona should be like! Example: !persona create a sleepy panda who builds everything out of bamboo`);
        return;
      }
      void createPersonaFromDescription(username, description);
      return;
    }
    const persona = getPersona(parts[1]);
    if (!persona) {
      bot.chat(`AIGuy: ❓ I don't know a persona called "${parts[1]}". Available: ${listPersonas().map(p => p.name).join(', ')}`);
      return;
    }
    activePersona = persona;
    chatHistory.length = 0; // Fresh voice, fresh conversation
    bot.chat(`AIGuy: 🎭 *transforms* ... ${persona.displayName} has arrived! ${persona.description} ${persona.emojiStyle || ''}`);
    return;
  }

  // Memory Command
  if (cmd === '!memory') {
    const facts = getFacts();
    const waypoints = getWaypoints();
    bot.chat(`AIGuy: 🧠 I remember ${facts.length} fact(s) and ${waypoints.length} saved place(s)!`);
    facts.slice(-5).forEach(f => bot.chat(`- ${f.about}: ${f.fact}`));
    waypoints.slice(-5).forEach(w => bot.chat(`- 📍 "${w.name}" at (${w.x}, ${w.y}, ${w.z})`));
    if (facts.length + waypoints.length > 10) {
      bot.chat(`(showing the 5 most recent of each)`);
    }
    return;
  }

  if (cmd === '!city' || cmd === '!nyc') {
    runDirectSkillCommand(username, 'nycCity', 'a deterministic NYC-style city', 70);
    return;
  }

  if (cmd === '!castle' || cmd === '!fortress') {
    runDirectSkillCommand(username, 'castleLair', 'a huge castle with a secret underground lair', 70);
    return;
  }

  // Crew Toggle Command
  if (cmd === '!crew') {
    const arg = (parts[1] || '').toLowerCase();
    if (arg === 'on') {
      crewEnabled = true;
      bot.chat(`AIGuy: 👷 Crew mode ON! Blueprint 📐 and Inspector 🔎 will show up for my next big build!`);
    } else if (arg === 'off') {
      crewEnabled = false;
      dismissCrew();
      bot.chat(`AIGuy: Crew mode OFF — I'll handle the planning and inspecting invisibly. 🧠`);
    } else {
      bot.chat(`AIGuy: 👷 Crew mode is ${crewEnabled ? 'ON' : 'OFF'}. My crew: Blueprint 📐 (surveys and plans) and Inspector 🔎 (checks my work).`);
      bot.chat(`Usage: !crew on / !crew off. They join automatically when a big autonomous build starts!`);
    }
    return;
  }

  // Brain Switch Commands
  if (cmd === '!brains') {
    bot.chat(`AIGuy brains 🧠`);
    describeBrains().forEach(line => bot.chat(line));
    bot.chat(`Switch with !model / !planner / !qa <alias-or-model-id>. Aliases: ${Object.keys(MODEL_ALIASES).join(', ')}`);
    return;
  }

  if (cmd === '!model' || cmd === '!planner' || cmd === '!qa') {
    const role: keyof BrainConfig = cmd === '!model' ? 'regular' : cmd === '!planner' ? 'planner' : 'qaVision';
    const roleLabel = role === 'regular' ? 'Regular' : role === 'planner' ? 'Planner' : 'QA/Vision';

    if (parts.length < 2) {
      bot.chat(`AIGuy: 🧠 ${roleLabel} brain: ${brains[role]}`);
      bot.chat(`Usage: ${cmd} <alias-or-model-id>. Aliases: ${Object.keys(MODEL_ALIASES).join(', ')}. Type !brains to see all three.`);
      return;
    }

    const resolved = resolveModelId(parts.slice(1).join(' '));
    brains[role] = resolved;
    saveBrainConfig(brains);
    const modelShort = resolved.split('/').pop() || resolved;
    bot.chat(`AIGuy: 🧠 ${roleLabel} brain switched to ${modelShort}! (${resolved}) Saved for next time too!`);
    console.log(`[AIGuy] ${roleLabel} brain switched to: ${resolved}`);
    if (role === 'regular') {
      // Fresh conversation for a fresh chat brain
      chatHistory.length = 0;
    }
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
    bot.chat(`8. rememberFact / saveWaypoint - I remember facts and places forever! 🧠📍`);
    bot.chat(`9. !brains - See my three brains (regular/planner/QA); switch with !model, !planner, !qa 🧠`);
    bot.chat(`👉 Direct Commands: !city / !nyc builds a city; !castle builds a castle+lair; !stay; !follow.`);
    bot.chat(`👉 Fun stuff: !persona to switch or create personalities 🎭; !memory to see what I remember; !crew for my build crew 👷.`);
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
    } else if (toolName === 'castle' || toolName === 'fortress') {
      bot.chat(`AIGuy: 🏰 Command: !castle`);
      bot.chat(`- Description: Runs a deterministic castle build with towers, throne room, moat, and secret underground lair.`);
      bot.chat(`- Usage: Stand where you want the castle centered, then type !castle.`);
    } else if (toolName === 'startgoalloop' || toolName === 'goalloop' || toolName === 'goal') {
      bot.chat(`AIGuy: 🤖 Tool: startGoalLoop (Agent Mode)`);
      bot.chat(`- Description: Starts an autonomous loop where AIGuy builds, scans, and verifies progress until a success criteria is met.`);
      bot.chat(`- How to trigger: Ask AIGuy to do a multi-step project and specify a goal and success criteria!`);
      bot.chat(`- Example: "build a gold tower 5 blocks high next to me"`);
      bot.chat(`- To stop: Type "cancel goal" or "stop goal" in chat.`);
    } else if (toolName === 'crew') {
      bot.chat(`AIGuy: 👷 Command: !crew`);
      bot.chat(`- My embodied build crew! When a big autonomous build starts, Blueprint 📐 joins to survey the site and announce the plan, and Inspector 🔎 circles the build checking the work between steps.`);
      bot.chat(`- They're real players in the world (no OP powers — I do all the building). !crew on / !crew off toggles them.`);
    } else if (toolName === 'model' || toolName === 'brains' || toolName === 'planner' || toolName === 'qa') {
      bot.chat(`AIGuy: 🧠 Commands: !brains / !model / !planner / !qa`);
      bot.chat(`- I have THREE brains: Regular (chat + building), Planner (blueprints for big builds), QA/Vision (inspects my work).`);
      bot.chat(`- !brains shows all three. !model, !planner, or !qa <alias-or-model-id> switches one (saved across restarts).`);
      bot.chat(`- Aliases: ${Object.keys(MODEL_ALIASES).join(', ')} — or any full OpenRouter model ID.`);
    } else {
      bot.chat(`AIGuy: ❓ Unknown tool: ${parts[1]}. Type !tools for a list of available tools.`);
    }
    return;
  }
}

async function createPersonaFromDescription(username: string, description: string) {
  bot.chat(`AIGuy: 🎭 Ooh, inventing a brand new persona for ${username}... give me a second!`);
  try {
    const response = await openai.chat.completions.create({
      model: brains.regular,
      messages: [
        {
          role: 'system',
          content:
            'You design persona configs for a friendly Minecraft companion bot that plays with a young kid. ' +
            'Reply with ONLY a JSON object (no markdown fences) with these fields: ' +
            'name (lowercase letters/numbers/hyphens/underscores, 2-24 chars), displayName, description (one sentence), ' +
            'promptOverlay (2-4 sentences describing speaking style and build preferences, starting with "PERSONA:"), ' +
            'preferredMaterials (array of up to 6 Minecraft block ids), followDistance (number 2-10), emojiStyle (2-4 emoji). ' +
            'Everything must be kid-friendly, positive, and harmless.',
        },
        { role: 'user', content: `Create a persona based on this description: ${description}` }
      ],
    });

    const text = response.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('the model did not return a persona config');
    const saved = savePersona(JSON.parse(jsonMatch[0]));
    activePersona = saved;
    chatHistory.length = 0;
    bot.chat(`AIGuy: 🎭 *POOF!* New persona created and saved forever: ${saved.displayName} — ${saved.description} ${saved.emojiStyle || ''}`);
    bot.chat(`AIGuy: Switch to it anytime with !persona ${saved.name}`);
  } catch (err: any) {
    console.error('[Persona Create Error]', err);
    bot.chat(`AIGuy: I couldn't create that persona (${err?.message || err}) 😅 Try again with a different description!`);
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
      friendlyMessage = `Oops! The model "${brains.regular}" wasn't found on OpenRouter. 🤷 Try !model to switch models.`;
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

// Passive vision cache: a full scan walks ~30k blocks synchronously, so reuse
// recent results and skip the scan entirely for casual chatter like "lol".
const VISION_CACHE_TTL_MS = 5000;
let visionCache: { player: string; scannedAt: number; context: string } | null = null;

function looksActionShaped(message: string): boolean {
  const normalized = message.toLowerCase();
  if (normalized.length >= 60) return true;
  return /\b(build|make|create|construct|place|fill|dig|clear|destroy|remove|spawn|summon|give|tp|teleport|come|look|see|scan|show|where|what|find|fix|tower|house|castle|fortress|bridge|arena|city|wall|pyramid|sphere|dome|effect|firework|particle|trap|cage|statue|pool|farm|maze|tunnel|goal)\b/.test(normalized);
}

function getPassiveVisionContext(playerUsername: string, message: string): string {
  const now = Date.now();
  const cachedFresh = visionCache && visionCache.player === playerUsername && now - visionCache.scannedAt < VISION_CACHE_TTL_MS;

  if (cachedFresh) return visionCache!.context;

  if (!looksActionShaped(message)) {
    return 'No detailed world scan was performed for this casual message. Use the scanArea tool if you need to inspect the surroundings.';
  }

  const context = getNearbyContext(playerUsername);
  visionCache = { player: playerUsername, scannedAt: now, context };
  return context;
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
      dismissCrew();
      return;
    }
  }

  // Show thinking indicator in-game
  bot.chat(`/me is thinking about what ${username} said... 🤔`);

  // Build real-time nearby context (passive vision, cached + gated for casual chat)
  const visionContext = getPassiveVisionContext(username, message);

  const player = bot.players[username];
  const playerPos = player?.entity?.position;
  const commandAnchor = captureCommandAnchor(username);
  const playerPosStr = playerPos 
    ? `${username} is at (${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)})` 
    : `${username} position unknown`;

  const botPos = bot.entity?.position;
  const botInfo = botPos 
    ? `AIGuy is at (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)})` 
    : 'AIGuy position unknown';

  const anchorText = commandAnchor
    ? `Command anchor for this request is fixed at (${commandAnchor.x.toFixed(1)}, ${commandAnchor.y.toFixed(1)}, ${commandAnchor.z.toFixed(1)}). Builds must stay relative to this anchor even if ${username} moves.`
    : 'No command anchor could be captured for this request.';

  const busyWith = currentBuildActivity();
  const busyText = busyWith
    ? `IMPORTANT: You are currently busy with ${busyWith}. Do NOT start new builds, skills, or goal loops until it finishes — chat, answer questions, and use non-building tools only.`
    : 'You are not currently running any build project.';

  const context = `[System Context]\n${playerPosStr}\n${botInfo}\n${anchorText}\n${busyText}\n\n${visionContext}\nTime of day: ${bot.time.timeOfDay}`;

  console.log(`[Vision Context sent to ${brains.regular}]:\n${context}`);

  // Add user message with vision context to history
  chatHistory.push({
    role: 'user',
    content: `${context}\n\n${username}: ${message}`
  });

  // Keep history size manageable (last ~20 messages) without letting the
  // window start mid-turn on an assistant message.
  while (chatHistory.length > 20 || (chatHistory.length > 0 && chatHistory[0].role !== 'user')) {
    chatHistory.shift();
  }

  // Call OpenRouter
  const response = await openai.chat.completions.create({
    model: brains.regular,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
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

  // Relay commentary even when tools are also called — models often return
  // both, and dropping the text made AIGuy silently act without narrating.
  if (textResponse && textResponse.trim().length > 0) {
    bot.chat(textResponse);
  }

  // Execute actions
  if (toolCalls && toolCalls.length > 0) {
    for (const call of toolCalls) {
      const result = await executeToolCall(call, username, 'AIGuy Action', { anchor: commandAnchor });
      actionSummaries.push(result.summary);
    }
    console.log(`[AIGuy Debug] Tool actions for "${message}": ${actionSummaries.join(' | ')}`);
  } else if (!textResponse) {
    console.warn(`[AIGuy Debug] Empty response for "${message}". No text and no tool calls.`);
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

// ─── Goal Planning (planner brain, called once per goal) ───────────────────────
const PLANNER_TIMEOUT_MS = 60_000; // 60 seconds per planner model attempt

async function generateGoalPlan(goal: ActiveGoal): Promise<string | undefined> {
  const visionContext = getNearbyContext(goal.initiator);
  const planPrompt = `
You are the PLANNING brain for AIGuy, a Minecraft companion bot on a Paper/Java 1.20.4 creative server.
Produce a concise, numbered build plan that a cheaper executor model will follow step by step.

Goal: "${goal.description}"
Success criteria: "${goal.successCriteria}"
Fixed command anchor (all coordinates must be relative to this point, expressed as "/execute at ${goal.initiator} run ..." with ~ offsets): ${describeAnchor(goal.anchor)}
The executor has at most ${goal.maxIterations} steps; each step can run many commands.

Current environment:
${visionContext}

Requirements for the plan:
- 3 to ${goal.maxIterations} numbered steps, each independently executable.
- For every structure, give EXACT relative offsets and dimensions (e.g. "walls: fill ~-5 ~0 ~-5 to ~5 ~6 ~5 stone_bricks outline") and the exact block ids to use.
- Use ONLY relative coordinates in the "/execute at ${goal.initiator} run <command>" style. Never absolute coordinates.
- Stay consistent: later steps must reuse the same offsets established in earlier steps.
- End with a one-line "Verification:" note describing what the finished build looks like block-wise.

Reply with ONLY the plan text, no preamble.`;

  for (const model of [brains.planner, brains.regular]) {
    const startTime = Date.now();
    console.log(`[AIGuy Planner] Requesting plan from ${model}...`);
    try {
      const apiCall = openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: planPrompt }],
      });

      // Race the API call against a timeout so a slow/hung model can't stall forever
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Planner timed out after ${PLANNER_TIMEOUT_MS / 1000}s`)), PLANNER_TIMEOUT_MS)
      );

      const response = await Promise.race([apiCall, timeout]);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const text = response.choices[0]?.message?.content?.trim();
      if (text) {
        console.log(`[AIGuy Planner] Plan from ${model} (${elapsed}s):\n${text}`);
        return text.slice(0, 4000);
      }
      console.warn(`[AIGuy Planner] ${model} returned empty content (${elapsed}s).`);
    } catch (err: any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.warn(`[AIGuy Planner] ${model} failed after ${elapsed}s: ${err?.message || err}`);
    }
  }
  return undefined;
}

async function planGoalThenStart(goal: ActiveGoal) {
  bot.chat(`AIGuy: 🧠 Calling in the crew for this one!`);

  // Blueprint pops in and "surveys" the site while the planner model thinks.
  // The join can resolve after planning already finished, so the survey loop
  // checks the surveying flag rather than relying on being cleared externally.
  let surveying = true;
  if (crewEnabled) {
    void plannerBody.join().then(joined => {
      if (!joined) return;
      if (!surveying || activeGoal !== goal) {
        // Joined too late — the plan is already done (or the goal is gone)
        plannerBody.leave();
        return;
      }
      plannerBody.say(`Blueprint here! 📐 Give me a moment to survey the build site...`);
      if (goal.anchor) {
        let surveyAngle = Math.random() * Math.PI * 2;
        stageCrewMemberAroundAnchor(plannerBody, goal.anchor, surveyAngle, 8);
        const surveyTimer = setInterval(() => {
          if (!surveying || !plannerBody.isOnline() || !goal.anchor || activeGoal !== goal) {
            clearInterval(surveyTimer);
            return;
          }
          surveyAngle += Math.PI / 2;
          stageCrewMemberAroundAnchor(plannerBody, goal.anchor, surveyAngle, 8);
        }, 3000);
      }
    });
  }

  // Periodic in-game progress updates so the player knows we haven't frozen
  const planningStart = Date.now();
  const thinkingMessages = [
    '🧠 Still thinking... designing the layout...',
    '🧠 Crunching the coordinates... almost there...',
    '🧠 Mapping out the build plan... hang tight...',
    '🧠 Just a few more seconds on the blueprint...',
  ];
  let thinkMsgIdx = 0;
  const progressTimer = setInterval(() => {
    if (activeGoal !== goal) {
      clearInterval(progressTimer);
      return;
    }
    const elapsed = ((Date.now() - planningStart) / 1000).toFixed(0);
    const msg = thinkingMessages[thinkMsgIdx % thinkingMessages.length];
    bot.chat(`AIGuy: ${msg} (${elapsed}s)`);
    console.log(`[AIGuy Planner] Still waiting for plan... ${elapsed}s elapsed`);
    thinkMsgIdx++;
  }, 12_000); // every 12 seconds

  const plan = await generateGoalPlan(goal);
  clearInterval(progressTimer);
  surveying = false;

  const planElapsed = ((Date.now() - planningStart) / 1000).toFixed(1);
  console.log(`[AIGuy Planner] Planning phase completed in ${planElapsed}s (plan ${plan ? 'received' : 'failed'})`);

  // The goal may have been cancelled (or replaced) while we were planning
  if (activeGoal !== goal) {
    dismissCrew();
    return;
  }

  if (plan) {
    goal.plan = plan;
    if (plannerBody.isOnline()) {
      const stepCount = (plan.match(/^\s*\d+[.)]/gm) || []).length;
      plannerBody.say(`📋 The blueprint is ready — ${stepCount > 0 ? `${stepCount} steps` : 'all mapped out'}! AIGuy, take it away!`);
      setTimeout(() => plannerBody.leave('My work here is done. Blueprint out! 📐✨'), 8000);
    } else {
      bot.chat(`AIGuy: 📋 Blueprint ready! Building it step by step...`);
    }
  } else {
    bot.chat(`AIGuy: My planner brain timed out or is napping 😴 — I'll wing it with my regular brain! Let's go! 🚀`);
    plannerBody.leave();
  }

  // Inspector stays on site for the whole goal to check the work between steps
  if (crewEnabled) {
    void inspectorBody.join().then(joined => {
      if (!joined || activeGoal !== goal) return;
      inspectorBody.say(`Inspector on site! 🔎 I'll be checking the work between steps.`);
      if (goal.anchor) stageCrewMemberAroundAnchor(inspectorBody, goal.anchor, inspectorAngle, 6);
    });
  }

  setTimeout(runGoalIteration, 1000);
}

// ─── Goal QA (independent inspector brain) ──────────────────────────────────────
interface QaVerdict {
  complete: boolean;
  critique: string;
}

async function runGoalQaCheck(goal: ActiveGoal, visionContext: string): Promise<QaVerdict | null> {
  const qaPrompt = `
You are an INDEPENDENT build inspector for a Minecraft bot. You did not build this; judge it strictly on the evidence below.

Goal: "${goal.description}"
Success criteria: "${goal.successCriteria}"
Fixed command anchor: ${describeAnchor(goal.anchor)}
${goal.plan ? `The build plan being followed:\n${goal.plan}\n` : ''}
Commands the builder has executed so far:
${goal.commandLog.length > 0 ? goal.commandLog.slice(-60).join('\n') : '(none)'}

Current world scan around the build area:
${visionContext}

Judge ONLY from the world scan (the commands show intent, but the scan shows reality).
Reply with ONLY a JSON object: {"complete": true|false, "critique": "<one or two sentences: what is done, what is missing or misaligned, and the single most important next fix if incomplete>"}`;

  for (const model of [brains.qaVision, brains.regular]) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are a meticulous Minecraft build QA inspector. Reply with only a JSON object.' },
          { role: 'user', content: qaPrompt },
        ],
      });
      const text = response.choices[0]?.message?.content || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.complete === 'boolean') {
        return { complete: parsed.complete, critique: String(parsed.critique || '').slice(0, 500) };
      }
    } catch (err: any) {
      console.warn(`[AIGuy QA] ${model} failed: ${err?.message || err}`);
    }
  }
  return null;
}

function completeActiveGoal(summary: string) {
  if (!activeGoal) return;
  bot.chat(`AIGuy: 🎉 Goal Achieved! ${summary}`);
  if (activeGoal.anchor && activeGoal.totalBuildCommandsIssued > 0) {
    recordBuildWaypoint(activeGoal.description, activeGoal.anchor);
  }
  activeGoal = null;
  dismissCrew();
}

// Autonomous Goal Loop Iteration
async function runGoalIteration() {
  if (!activeGoal) return;

  activeGoal.iterations++;

  // Exit if maximum steps reached
  if (activeGoal.iterations > activeGoal.maxIterations) {
    bot.chat(`AIGuy: *I've worked on this for ${activeGoal.maxIterations} steps, but couldn't quite verify success. Pausing autonomous mode!* ⏹️`);
    activeGoal = null;
    dismissCrew();
    return;
  }

  bot.chat(`/me is checking progress... (Step ${activeGoal.iterations}/${activeGoal.maxIterations}) 🔎`);

  // Get fresh environment data
  const visionContext = getNearbyContext(activeGoal.initiator);

  // Independent QA check by the inspector brain once something has been built.
  // The builder never grades its own work: this verdict decides completion.
  let qaVerdict: QaVerdict | null = null;
  if (activeGoal.totalBuildCommandsIssued > 0) {
    // The Inspector walks to a new vantage point around the build for each check
    if (inspectorBody.isOnline() && activeGoal.anchor) {
      inspectorAngle += (Math.PI * 2) / 5;
      stageCrewMemberAroundAnchor(inspectorBody, activeGoal.anchor, inspectorAngle, 6);
    }

    qaVerdict = await runGoalQaCheck(activeGoal, visionContext);
    if (!activeGoal) return; // goal was cancelled while QA was running
    if (qaVerdict) {
      activeGoal.lastQaCritique = qaVerdict.critique;
      if (qaVerdict.complete) {
        inspectorBody.say(`✅ Inspection PASSED! ${qaVerdict.critique}`);
        completeActiveGoal(qaVerdict.critique || 'The build passed inspection!');
        return;
      }
      inspectorBody.say(`🔎 Not done yet: ${qaVerdict.critique}`);
      console.log(`[AIGuy QA] Step ${activeGoal.iterations}: not complete yet — ${qaVerdict.critique}`);
    }
  }

  const goalPrompt = `
You are currently running in AUTONOMOUS GOAL LOOP mode.
Your active goal: "${activeGoal.description}"
Success criteria: "${activeGoal.successCriteria}"

Current Step: ${activeGoal.iterations} of ${activeGoal.maxIterations}
Fixed command anchor: ${describeAnchor(activeGoal.anchor)}
Commands issued so far in this goal: ${activeGoal.totalCommandsIssued}
Building commands issued so far in this goal: ${activeGoal.totalBuildCommandsIssued}
Consecutive stalled steps with no real world-changing command: ${activeGoal.stalledIterations}
Last action summary: ${activeGoal.lastActionSummary || 'none yet'}
Last debug note: ${activeGoal.lastDebugNote || 'none'}
${activeGoal.plan ? `\nBuild plan from your planner brain — follow it step by step, using its exact offsets and materials:\n${activeGoal.plan}\n` : ''}
Latest QA inspector critique: ${activeGoal.lastQaCritique || 'none yet'}

Exact commands you have already executed in this goal (oldest first, up to the last 60):
${activeGoal.commandLog.length > 0 ? activeGoal.commandLog.slice(-60).join('\n') : '(none yet)'}

Use this command history to stay consistent: reuse the SAME offsets and coordinate style as the commands above when extending the build, and do not re-run commands that already succeeded.

Current Environment Context:
${visionContext}

Your task:
1. Analyze the environment context and assess the build's progress. An independent QA inspector reviews the world between steps and decides completion — its latest critique is above.
2. If you are confident the success criteria has been met, call the \`completeGoal\` tool with a brief explanation. If the inspector's critique says something is missing or misaligned, fix THAT first instead of calling completeGoal.
3. If the success criteria has NOT been met:
   - Prefer structured tools like buildShape, scanArea, giveItem, spawnEntity, setWorldState, createParticleEffect, launchFireworks, runCommandSequence, or runSkill when they fit.
   - Call the \`executeCommands\` tool only for custom commands that do not fit a structured tool.
   - Optionally call the \`chat\` tool to update the players on your progress or what you are doing.
   - You MUST issue at least one world-changing tool call on build steps. Chat-only updates do not count as progress.
   - If you are building a structure, use at least one actual building command via buildShape, runSkill, runCommandSequence, or executeCommands containing /fill, /setblock, or /clone.

CRITICAL COORDINATE CONSISTENCY REMINDER:
- You MUST be 100% consistent with your coordinates! 
- If you used relative coordinates with '/execute at <player_username> run <command>' (e.g. ~ ~ ~) in previous steps, you MUST continue using relative coordinates with '/execute at <player_username> run <command>' in this step!
- NEVER mix absolute coordinates (like "10 -60 25") and relative coordinates (like "~ ~ ~") in the same project, or the parts of your build will spawn in completely different locations!
- The command executor will anchor '/execute at ${activeGoal.initiator} run ...' to the fixed command anchor above, so keep using that pattern for relative build commands.
- Do not guess! Look at the "Nearby blocks" and "Nearby entities" coordinates in the context to verify if they are placed correctly.
`;

  try {
    const response = await openai.chat.completions.create({
      model: brains.regular,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
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
    const actionSummaries: string[] = [];
    let iterationCommandCount = 0;
    let iterationBuildCommandCount = 0;
    let iterationMutatingCommandCount = 0;
    let iterationScanOnlyCount = 0;
    let iterationChatOnlyCount = 0;

    // Relay commentary even when tool calls are present so progress narration
    // is never silently dropped.
    if (textResponse && textResponse.trim().length > 0) {
      bot.chat(textResponse);
    }

    if (toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments);

        if (call.function.name === 'completeGoal') {
          // The builder's completion is a claim; the QA inspector's verdict wins.
          // If the latest verdict said "not done", keep looping — the next
          // iteration's QA check will confirm any fixes made this step. With no
          // verdict available (nothing built yet, or the QA brain unreachable),
          // fall back to trusting the builder.
          if (qaVerdict && !qaVerdict.complete) {
            if (iterationMutatingCommandCount > 0) {
              bot.chat(`AIGuy: Nice progress! My QA inspector will double-check it next step. 🔎`);
            } else {
              bot.chat(`AIGuy: My QA inspector says we're not done yet! 📋 ${qaVerdict.critique}`.slice(0, 250));
            }
            actionSummaries.push('completeGoal deferred to QA inspector');
            continue;
          }
          completeActiveGoal(String(args.summary || 'Goal complete!'));
          isCompleted = true;
          break;
        } else {
          const result = await executeToolCall(call, activeGoal.initiator, 'AIGuy Goal Action', { anchor: activeGoal.anchor });
          actionSummaries.push(result.summary);
          iterationCommandCount += result.commandCount;
          iterationBuildCommandCount += result.buildCommandCount;
          iterationMutatingCommandCount += result.mutatingCommandCount;
          activeGoal.commandLog.push(...result.executedCommands);
          if (result.scanOnly) iterationScanOnlyCount++;
          if (result.chatOnly) iterationChatOnlyCount++;
        }
      }
    } else if (!textResponse) {
      console.warn(`[AIGuy Goal Debug] Step ${activeGoal.iterations} returned no text and no tool calls.`);
    }

    // Schedule next step if not complete
    if (!isCompleted && activeGoal) {
      activeGoal.totalCommandsIssued += iterationCommandCount;
      activeGoal.totalBuildCommandsIssued += iterationBuildCommandCount;
      activeGoal.lastActionSummary = actionSummaries.join(' | ') || (textResponse ? 'text-only response' : 'no action');

      if (iterationMutatingCommandCount === 0) {
        activeGoal.stalledIterations++;
        activeGoal.lastDebugNote = `Step ${activeGoal.iterations} did not issue any world-changing commands.`;
        console.warn(
          `[AIGuy Goal Debug] Step ${activeGoal.iterations}/${activeGoal.maxIterations} stalled: ` +
          `tools=${toolCalls?.length || 0}, commands=${iterationCommandCount}, build=${iterationBuildCommandCount}, ` +
          `mutating=${iterationMutatingCommandCount}, chatOnly=${iterationChatOnlyCount}, scanOnly=${iterationScanOnlyCount}`
        );
        if (activeGoal.stalledIterations >= 3) {
          bot.chat(
            `AIGuy: I've stalled for ${activeGoal.stalledIterations} steps in a row without making real progress, ` +
            `so I'm stopping this goal. Ask me again with more details and I'll take another crack at it! ⏹️`
          );
          activeGoal = null;
          dismissCrew();
          return;
        }
        bot.chat(
          `AIGuy debug: Step ${activeGoal.iterations} did not issue any build/world commands. ` +
          `Next step must run real commands, not just talk.`
        );
      } else {
        activeGoal.stalledIterations = 0;
        activeGoal.lastDebugNote =
          `Step ${activeGoal.iterations} issued ${iterationCommandCount} command(s), including ${iterationBuildCommandCount} build command(s).`;
        console.log(
          `[AIGuy Goal Debug] Step ${activeGoal.iterations}/${activeGoal.maxIterations}: ` +
          `commands=${iterationCommandCount}, build=${iterationBuildCommandCount}, mutating=${iterationMutatingCommandCount}, ` +
          `anchor=${describeAnchor(activeGoal.anchor)}, summary=${activeGoal.lastActionSummary}`
        );
        bot.chat(
          `AIGuy debug: Step ${activeGoal.iterations} issued ${iterationCommandCount} command(s) ` +
          `(${iterationBuildCommandCount} building).`
        );
      }

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
