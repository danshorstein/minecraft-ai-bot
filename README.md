# 🎮 Minecraft AI Companion Bot

An AI-powered Minecraft companion bot that joins your local server as a player, chats with you, follows you around, and builds awesome things using slash commands — all powered by LLMs via [OpenRouter](https://openrouter.ai).

Also includes a **Minecraft Chess** mode that renders a full playable chess game on the Minecraft world using 3D animal piece statues!

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
- **Passive vision** — scans nearby blocks and entities every time someone chats, so it can "see" the world
- **Autonomous goal loop** — give it a complex task (e.g. "build a castle") and it will self-iterate, verify, and complete it
- **Multiple AI models** — swap models on the fly via CLI flag or in-game `!model` command

### ♟️ Chess Mode
- Renders a full 8×8 chessboard on the Minecraft world floor
- Each piece is a unique passive mob on a pedestal (sheep for pawns, horses for knights, etc.)
- Play moves from the terminal or in-game chat
- Built-in minimax AI opponent with alpha-beta pruning

---

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
| `cancel goal` | Stop the autonomous goal loop |

Just chat normally and AIGuy will respond! Ask it to build things, summon mobs, change the time, or anything else.

---

## ♟️ Chess Mode

To play chess in Minecraft:

```bash
npm run start-live
```

This spawns a ChessBot that builds a chessboard and lets you play against a built-in AI. Type moves in standard notation (`e2e4`, `Nf3`) in the terminal or in-game chat.

---

## 📁 Project Structure

```
minecraft-ai-bot/
├── src/
│   ├── ai-bot.ts         # AIGuy companion bot (main bot)
│   ├── index.ts           # Chess game controller
│   ├── chess-engine.ts    # Chess engine with minimax AI
│   └── mcp-client.ts      # MCP protocol client for Minecraft
├── scripts/
│   ├── setup-server.js    # Downloads & configures Paper server
│   └── start-server.js    # Starts the Minecraft server
├── minecraft-mcp-server/  # Minecraft MCP server (git submodule)
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
- [chess.js](https://github.com/jhlywa/chess.js) — Chess move validation & engine
- [Minecraft MCP Server](https://github.com/nicholasgriffintn/minecraft-mcp-server) — MCP protocol for Minecraft
