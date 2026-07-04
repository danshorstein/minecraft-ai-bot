import mineflayer from 'mineflayer';
import OpenAI from 'openai';

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
    'HTTP-Referer': 'https://minecraft-chess-ai.local',
    'X-Title': 'Minecraft AIGuy Bot',
  },
});

// ─── System Prompt ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
You are "AIGuy", a super creative, energetic, slightly chaotic, and extremely fun AI companion in Minecraft.
You are playing on a local server with a young player (the user's son) and his dad.
Your goal is to be an amazing friend: chat, tell jokes, be enthusiastic, and build awesome things when they ask!

Capabilities:
- You have operator (OP) permissions, so you can run ANY Minecraft console command using the \`executeCommands\` tool!
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

Rules for interaction:
1. Always be energetic, friendly, and creative. Use emojis in your chat!
2. If they ask you to do multiple things, you can run multiple commands in a single \`executeCommands\` call.
3. You can chat back using the \`chat\` tool or direct text. Explain what you are doing in a fun, theatrical way!
4. Friendly Hints: At the end of your chat replies, occasionally append a short, friendly hint in brackets to remind the player they can type !help or !tools. For example: "[Hint: Type !tools to see what I can do, or !help startGoalLoop to learn about my autonomous mode!]" or "[Hint: You can type !help at any time for a list of commands!]".
5. Always respond in the game chat so the player knows what is happening.
`;

// ─── Tool Definitions (OpenAI format) ──────────────────────────────────────────
const CHAT_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
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
  },
  {
    type: 'function',
    function: {
      name: 'executeCommands',
      description: 'Execute one or more Minecraft slash commands. Use this to build, summon, teleport, etc.',
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
  },
  {
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
  }
];

const GOAL_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'chat',
      description: 'Send a progress update chat message to the players.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The text message to send.' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'executeCommands',
      description: 'Execute Minecraft slash commands to continue building/working towards the goal.',
      parameters: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of commands to run.'
          }
        },
        required: ['commands']
      }
    }
  },
  {
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
  }
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

bot.on('error', (err) => {
  console.error('[AIGuy Error]', err);
});

bot.on('end', (reason) => {
  console.log('[AIGuy] Disconnected from server:', reason);
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
    bot.chat(`3. startGoalLoop - Run an autonomous, self-verifying build cycle.`);
    bot.chat(`4. !model <id> - Switch AI model on the fly! 🧠`);
    bot.chat(`👉 Direct Commands: Type "!stay" to make me stay, or "!follow" to make me follow you!`);
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
function getNearbyContext(playerUsername: string): string {
  const player = bot.players[playerUsername];
  const centerPos = player?.entity?.position || bot.entity?.position;
  if (!centerPos) return 'No nearby coordinates available.';

  const radius = 15;
  const center = centerPos.floored();
  const interestingBlocks: any[] = [];

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
        if ((name === 'grass_block' || name === 'dirt' || name === 'stone') && blockPos.y <= groundLevel) {
          continue;
        }

        const dist = Math.sqrt(x * x + y * y + z * z);
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
  const cappedBlocks = interestingBlocks.slice(0, 80);

  let blocksText = 'Nearby blocks (excluding flat ground floor):\n';
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

  // Execute actions
  if (toolCalls && toolCalls.length > 0) {
    for (const call of toolCalls) {
      const args = JSON.parse(call.function.arguments);
      
      if (call.function.name === 'chat') {
        bot.chat(args.message);
      } else if (call.function.name === 'executeCommands') {
        for (const cmd of args.commands) {
          const formattedCmd = cmd.startsWith('/') ? cmd : `/${cmd}`;
          console.log(`[AIGuy Action] Running command: ${formattedCmd}`);
          bot.chat(formattedCmd);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else if (call.function.name === 'startGoalLoop') {
        bot.chat(`AIGuy: *Entering autonomous goal mode!* 🤖\n*Goal:* ${args.goalDescription}\n*Success Criteria:* ${args.successCriteria}`);
        
        activeGoal = {
          description: args.goalDescription,
          successCriteria: args.successCriteria,
          initiator: username,
          iterations: 0,
          maxIterations: 8
        };
        
        // Start the looping execution in the background
        setTimeout(runGoalIteration, 2000);
      }
    }
  } else if (textResponse) {
    bot.chat(textResponse);
  }

  // Append model turn to history
  const modelMessage: OpenAI.ChatCompletionMessageParam = {
    role: 'assistant' as const,
    content: textResponse || null,
  };

  // Include tool calls in the assistant message if present
  if (toolCalls && toolCalls.length > 0) {
    (modelMessage as any).tool_calls = toolCalls;
  }

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
   - Call the \`executeCommands\` tool to perform the next actions/commands needed to get closer to the goal.
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
        } else if (call.function.name === 'chat') {
          bot.chat(args.message);
        } else if (call.function.name === 'executeCommands') {
          for (const cmd of args.commands) {
            const formattedCmd = cmd.startsWith('/') ? cmd : `/${cmd}`;
            console.log(`[AIGuy Goal Action] Running command: ${formattedCmd}`);
            bot.chat(formattedCmd);
            await new Promise(resolve => setTimeout(resolve, 100));
          }
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
