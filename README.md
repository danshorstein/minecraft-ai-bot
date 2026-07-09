# 🎮 Minecraft AI Companion Bot

An AI-powered Minecraft companion bot that joins your local server as a player, chats with you, follows you around, and builds awesome things using slash commands — all powered by LLMs via [OpenRouter](https://openrouter.ai).

![Minecraft](https://img.shields.io/badge/Minecraft-1.20.4-brightgreen)
![Node.js](https://img.shields.io/badge/Node.js-18+-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)
![OpenRouter](https://img.shields.io/badge/AI-OpenRouter-purple)

---

## ✨ Features

### 🤖 AIGuy — The AI Companion
- **Joins your server** as a real Minecraft player named "AIGuy"
- **Chats with players** — tells jokes, explains what it's doing, and responds to everything
- **Follows players** around the world with smooth movement and auto-jumping
- **Builds structures** using `/fill`, `/setblock`, `/summon`, and other commands
- **Minecraft skills cookbook** in the system prompt, with ready-to-use recipes for particles, fireworks, effects, builds, mini-games, scoreboards, gear, and world control
- **Structured Minecraft tools** for safer item giving, player effects, entity spawning, world state changes, particles, fireworks, shape building, area scans, and timed command sequences
- **Prebuilt combo skills** such as party mode, spleef arena, mob battle, parkour course, rainbow bridge, enchanted gear, light show, and base protection
- **Passive vision** — scans nearby blocks and entities every time someone chats, so it can "see" the world
- **Autonomous goal loop** — give it a complex task (e.g. "build a castle") and it will self-iterate, verify, and complete it
- **Multiple AI models** — swap models on the fly via CLI flag or in-game `!model` command

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** — [Download here](https://nodejs.org)
- **Java 17+** — Required to run the Minecraft server
- **Minecraft Java Edition** — To connect and play (version 1.20.4)
- **OpenRouter API key** — Get one free at [openrouter.ai/keys](https://openrouter.ai/keys)

### 1. Clone & Install

```bash
git clone https://github.com/danshorstein/minecraft-ai-bot.git
cd minecraft-ai-bot
npm install
```

### 2. Set Up the Minecraft Server

This downloads a Paper 1.20.4 server and configures it for local play (creative mode, flat world, offline mode):

```bash
npm run setup-server
```

### 3. Start the Minecraft Server

```bash
npm run start-server
```

Wait for `Done` in the output. The server runs on `localhost:25565`.

### 4. Connect with Minecraft

Open Minecraft Java Edition (1.20.4), go to **Multiplayer** → **Direct Connect** → enter `localhost:25565`.

### 5. Launch the AI Bot

In a new terminal:

```bash
export OPENROUTER_API_KEY="sk-or-v1-your-key-here"
npm run start-bot
```

The bot reads `OPENROUTER_API_KEY` from the process environment, so export it in the shell where you run `npm run start-bot`.

AIGuy will join the server and start chatting! 🚀

---

## 🧠 Choosing an AI Model

The bot defaults to **GLM 5.2** (`z-ai/glm-5.2`) via OpenRouter.

### CLI Flag

```bash
npm run start-bot -- --model anthropic/claude-sonnet-5
npm run start-bot -- --model openai/gpt-5.5
npm run start-bot -- --model google/gemini-3.5-flash
```

You can use **any model ID** from the [OpenRouter models page](https://openrouter.ai/models).

### In-Game Command

While playing, type in Minecraft chat:

```
!model anthropic/claude-sonnet-5
```

Type `!model` with no arguments to see the current model.

---

## 🎮 In-Game Commands

| Command | Description |
|---------|-------------|
| `!tools` | List all available tools |
| `!help` | Show help overview |
| `!help <tool>` | Detailed help for a specific tool |
| `!model` | Show current AI model |
| `!model <id>` | Switch AI model on the fly |
| `!follow` | Make AIGuy follow you |
| `!stay` / `!stop` | Make AIGuy stop and stand still |
| `!city` / `!nyc` | Build a deterministic NYC-style city near you |
| `!castle` / `!fortress` | Build a deterministic castle with a secret lair |
| `!persona` | Show the current persona and list all personas |
| `!persona <name>` | Switch persona (wizard, pirate, robot, gremlin, aiguy, or any custom one) |
| `!persona create <description>` | Invent a brand new persona — the AI generates it and saves it to disk forever |
| `!memory` | Show what AIGuy remembers (player facts and saved waypoints) |
| `cancel goal` | Stop the autonomous goal loop |

Just chat normally and AIGuy will respond! Ask it to build things, summon mobs, change the time, or anything else.

### Personas 🎭

AIGuy ships with five personalities: **AIGuy Classic**, **Wizzo the Wizard**, **Captain Blockbeard**, **Butler-Bot 3000**, and **Giggles the Gremlin**. Each has its own voice, favorite build materials, and follow distance. Kid-created personas (`!persona create ...`) are saved to `data/personas.json` and survive restarts.

### Persistent Memory 🧠

AIGuy remembers things between sessions in `data/memory.json`:

- **Player facts** — when you tell AIGuy something about yourself, it calls its `rememberFact` tool and recalls it in every future session.
- **Waypoints** — every completed build is auto-saved as a named waypoint, and the AI can save spots on request (`saveWaypoint`). Ask "take me back to our castle" and it teleports you to the saved coordinates.

### Safety Rails

- AIGuy only runs world-changing commands on **creative mode** servers — in survival/adventure worlds it just chats and follows.
- Dangerous console commands (`/stop`, `/op`, `/ban`, `/whitelist`, ...) are blocked outright, and game mode switches away from creative are refused.
- Only one build project runs at a time; new build requests are politely declined until the current one finishes.

### AIGuy Tool Surface

The model can now call these structured tools instead of hand-writing fragile Minecraft command syntax:

| Tool | What it does |
|------|--------------|
| `giveItem` | Gives items with optional names, lore, enchantments, and unbreakable NBT |
| `setPlayerEffect` | Applies potion effects with duration/amplifier parameters |
| `spawnEntity` | Summons entities with names, NoAI, glowing, equipment, and offsets |
| `setWorldState` | Sets time, weather, and gamerules |
| `createParticleEffect` | Runs named particle combos like heart bursts and portal swirls |
| `launchFireworks` | Launches single, barrage, ring, or finale firework patterns |
| `buildShape` | Builds spheres, domes, pyramids, walls, floors, cubes, and bridges |
| `scanArea` | Performs targeted block/entity scans around a player |
| `runCommandSequence` | Runs commands with configurable delays |
| `runSkill` | Runs prebuilt combo skills: `partyMode`, `spleefArena`, `mobBattle`, `parkourCourse`, `rainbowBridge`, `nycCity`, `castleLair`, `enchantGear`, `lightShow`, `protectBase` |

---

## 📁 Project Structure

```
minecraft-ai-bot/
├── src/
│   ├── ai-bot.ts         # AIGuy companion bot (main bot)
│   └── skills.ts         # Prebuilt AIGuy combo skills
├── scripts/
│   ├── setup-server.js    # Downloads & configures Paper server
│   └── start-server.js    # Starts the Minecraft server
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | ✅ Yes | Your OpenRouter API key ([get one here](https://openrouter.ai/keys)) |

> ⚠️ **Never commit your API key!** The `.gitignore` excludes `.env` files, but always double-check before pushing.

---

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/awesome-thing`)
3. Commit your changes (`git commit -m 'Add awesome thing'`)
4. Push to the branch (`git push origin feature/awesome-thing`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Mineflayer](https://github.com/PrismarineJS/mineflayer) — Minecraft bot framework
- [OpenRouter](https://openrouter.ai) — Universal LLM API gateway
- [PaperMC](https://papermc.io) — High-performance Minecraft server
