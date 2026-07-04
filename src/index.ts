import { ChessEngine, Piece } from './chess-engine.js';
import { McpClient, Position } from './mcp-client.js';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

interface PieceDesign {
  pedestal: string;
  entity: string;
  nbt?: string;
  displayName: string;
}

// 3D Piece designs: passive animal statues standing on pedestals
const PIECE_DESIGNS: Record<string, PieceDesign> = {
  'wp': { pedestal: 'white_concrete', entity: 'sheep', nbt: 'Color:0b', displayName: 'White Pawn' },
  'bp': { pedestal: 'black_concrete', entity: 'sheep', nbt: 'Color:15b', displayName: 'Black Pawn' },
  'wn': { pedestal: 'white_concrete', entity: 'horse', nbt: 'Variant:0', displayName: 'White Knight' },
  'bn': { pedestal: 'black_concrete', entity: 'horse', nbt: 'Variant:4', displayName: 'Black Knight' },
  'wb': { pedestal: 'white_concrete', entity: 'llama', nbt: 'Variant:1', displayName: 'White Bishop' },
  'bb': { pedestal: 'black_concrete', entity: 'llama', nbt: 'Variant:2', displayName: 'Black Bishop' },
  'wr': { pedestal: 'white_concrete', entity: 'iron_golem', displayName: 'White Rook' },
  'br': { pedestal: 'black_concrete', entity: 'wither_skeleton', displayName: 'Black Rook' },
  'wq': { pedestal: 'white_concrete', entity: 'cat', nbt: 'variant:"minecraft:white",CatType:5', displayName: 'White Queen' },
  'bq': { pedestal: 'black_concrete', entity: 'cat', nbt: 'variant:"minecraft:all_black",CatType:1', displayName: 'Black Queen' },
  'wk': { pedestal: 'white_concrete', entity: 'villager', nbt: 'VillagerData:{profession:"minecraft:cleric",level:5}', displayName: 'White King' },
  'bk': { pedestal: 'black_concrete', entity: 'witch', displayName: 'Black King' },
};

function getPieceTypeName(type: string): string {
  switch (type) {
    case 'p': return 'Pawn';
    case 'n': return 'Knight';
    case 'b': return 'Bishop';
    case 'r': return 'Rook';
    case 'q': return 'Queen';
    case 'k': return 'King';
    default: return '';
  }
}

// Global variables
let client: McpClient;
let engine: ChessEngine;
let boardStartX = 0;
let boardStartY = 0;
let boardStartZ = 0;
let lastBoardState: (Piece | null)[][] = Array(8).fill(null).map(() => Array(8).fill(null));
let isGameActive = true;
let botUsername = 'ChessBot';
let dryRun = false;
let lanPort = 25565;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function getCleanBoardState(): (Piece | null)[][] {
  return Array(8).fill(null).map(() => Array(8).fill(null));
}

// Synchronize Minecraft blocks and entities with ChessEngine state
async function syncBoard() {
  const currentBoard = engine.getBoard();
  
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const pBefore = lastBoardState[row][col];
      const pAfter = currentBoard[row][col];
      
      // If the square state changed
      if (JSON.stringify(pBefore) !== JSON.stringify(pAfter)) {
        const x = boardStartX + (7 - col) * 3 + 1;
        const z = boardStartZ + (7 - row) * 3 + 1;
        const y = boardStartY + 1;
        
        if (pAfter === null) {
          // Clear pedestal
          await client.setBlock(x, y, z, 'air');
          // Kill the mob at this spot
          await client.sendChat(`/kill @e[x=${x},y=${y + 1},z=${z},distance=..1.5,type=!player]`);
        } else {
          // Set 3D piece mob and pedestal
          const code = pAfter.color + pAfter.type;
          const design = PIECE_DESIGNS[code];
          
          if (design) {
            // First clear any previous pedestal block and entity at this spot
            await client.setBlock(x, y, z, 'air');
            await client.sendChat(`/kill @e[x=${x},y=${y + 1},z=${z},distance=..1.5,type=!player]`);
            
            // Set pedestal block
            await client.setBlock(x, y, z, design.pedestal);
            
            // Summon entity
            const nbtPart = design.nbt ? `,${design.nbt}` : '';
            const summonCmd = `/summon ${design.entity} ${x}.5 ${y + 1} ${z}.5 {NoAI:1b,Silent:1b,Invulnerable:1b,CustomNameVisible:1b,CustomName:'{"text":"${design.displayName}"}'${nbtPart}}`;
            await client.sendChat(summonCmd);
          }
        }
      }
    }
  }
  
  // Clone current board to lastBoardState
  lastBoardState = JSON.parse(JSON.stringify(currentBoard));
}

// Build the chessboard base (quartz and polished blackstone bricks)
async function buildChessboardBase() {
  console.log('[Game] Building chessboard floor in Minecraft...');
  
  // 1. Kill any existing chess entities in the entire board bounding box
  await client.sendChat(`/kill @e[x=${boardStartX},y=${boardStartY},z=${boardStartZ},dx=24,dy=10,dz=24,type=!player]`);
  
  // 2. Clear the area
  await client.fill(boardStartX, boardStartY, boardStartZ, boardStartX + 23, boardStartY + 5, boardStartZ + 23, 'air');
  
  // 3. Fill the base with white quartz
  await client.fill(boardStartX, boardStartY, boardStartZ, boardStartX + 23, boardStartY, boardStartZ + 23, 'quartz_block');
  
  // 4. Draw black squares (polished blackstone bricks)
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 0) {
        const sqX = boardStartX + (7 - col) * 3;
        const sqZ = boardStartZ + (7 - row) * 3;
        await client.fill(sqX, boardStartY, sqZ, sqX + 2, boardStartY, sqZ + 2, 'polished_blackstone_bricks');
      }
    }
  }
  
  console.log('[Game] Chessboard floor built successfully!');
}

async function handleReset() {
  console.log('\n[Game] Resetting game...');
  engine.reset();
  await client.sendChat('Chess game has been reset! Good luck!');
  
  // Clear the board physically
  const emptyBoard = getCleanBoardState();
  const backupLastState = lastBoardState;
  lastBoardState = backupLastState; // keep track of what was there to clear it
  
  // Reset lastBoardState to the actual state we want to compare with (empty)
  // so syncBoard thinks we are going from empty to the starting position
  lastBoardState = emptyBoard;
  
  // Rebuild the floor to clear any stray blocks
  await buildChessboardBase();
  
  // Sync board to place initial pieces
  await syncBoard();
  printStatus();
}

function printStatus() {
  console.log('\n======================================');
  console.log('            CHESS GAME STATE          ');
  console.log('======================================');
  console.log(engine.getAsciiBoard());
  console.log(`Turn: ${engine.getTurn() === 'w' ? 'White (Player)' : 'Black (AI)'}`);
  console.log('======================================');
}

// Parse input move from player
async function processMove(moveStr: string): Promise<boolean> {
  const success = engine.makeMove(moveStr);
  if (success) {
    console.log(`[Game] Valid move applied: ${moveStr}`);
    await syncBoard();
    printStatus();
    
    if (engine.isGameOver()) {
      const reason = engine.getGameOverReason();
      console.log(`[Game Over] ${reason}`);
      await client.sendChat(`Game Over! ${reason}`);
      isGameActive = false;
    }
    return true;
  } else {
    return false;
  }
}

// Check in-game chat for moves
let lastChatCheckTime = Date.now();
async function pollInGameChat() {
  if (dryRun || !isGameActive || engine.getTurn() !== 'w') return;

  try {
    const messages = await client.readChat(5);
    for (const msg of messages) {
      const msgTime = new Date(msg.timestamp).getTime();
      if (msgTime > lastChatCheckTime) {
        lastChatCheckTime = msgTime;

        // Skip our own messages
        if (msg.username.toLowerCase() === botUsername.toLowerCase()) continue;

        const content = msg.content.trim();
        console.log(`[Chat] Received message from ${msg.username}: "${content}"`);

        if (content.toLowerCase() === 'reset' || content.toLowerCase() === 'chess reset') {
          await handleReset();
          continue;
        }

        // Check if content matches a chess move (e.g. e2e4 or chess e2e4)
        let moveCandidate = content;
        if (content.toLowerCase().startsWith('chess ')) {
          moveCandidate = content.substring(6).trim();
        }

        // Try applying it
        const success = await processMove(moveCandidate);
        if (success) {
          await client.sendChat(`${msg.username} played: ${moveCandidate}`);
          // Trigger AI turn
          await triggerAiTurn();
          break; // only process one move per poll
        } else if (content.toLowerCase().startsWith('chess ')) {
          await client.sendChat(`Invalid move: ${moveCandidate}. Please try again (e.g., e2e4).`);
        }
      }
    }
  } catch (e) {
    console.error('[Game] Error polling chat:', e);
  }
}

// AI turn handler (decoupled via game_state.json and move_response.json)
async function triggerAiTurn(): Promise<void> {
  if (!isGameActive) return;

  console.log('[AI] Thinking (Waiting for Antigravity)...');
  await client.sendChat('AI is thinking (Waiting for Antigravity)...');

  const statePath = path.resolve(process.cwd(), 'game_state.json');
  const responsePath = path.resolve(process.cwd(), 'move_response.json');

  // Delete any stale response file first
  try {
    if (fs.existsSync(responsePath)) {
      fs.unlinkSync(responsePath);
    }
  } catch (e) {}

  const gameState = {
    fen: engine.getFen(),
    legalMoves: engine.getLegalMoves(),
    turn: engine.getTurn(),
    ascii: engine.getAsciiBoard()
  };
  fs.writeFileSync(statePath, JSON.stringify(gameState, null, 2));

  console.log(`[ANTIGRAVITY_REQUEST] FEN: ${engine.getFen()}`);

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (fs.existsSync(responsePath)) {
        clearInterval(interval);
        
        try {
          const responseData = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
          const moveStr = responseData.move?.trim();
          
          if (!moveStr) {
            console.log('[AI] Received empty or invalid move from response file.');
            triggerAiTurn().then(resolve);
            return;
          }

          if (moveStr.toLowerCase() === 'exit') {
            cleanupAndExit();
            return;
          }

          if (moveStr.toLowerCase() === 'reset') {
            await handleReset();
            resolve();
            return;
          }

          const success = await processMove(moveStr);
          if (success) {
            await client.sendChat(`Antigravity played: ${moveStr}`);
            
            // Clean up files
            try {
              if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
              if (fs.existsSync(responsePath)) fs.unlinkSync(responsePath);
            } catch (e) {}

            resolve();
          } else {
            console.log(`[ANTIGRAVITY_INVALID_MOVE] The move "${moveStr}" is not legal in this position.`);
            // Write error back so the AI knows it was invalid
            const errorPath = path.resolve(process.cwd(), 'move_error.json');
            fs.writeFileSync(errorPath, JSON.stringify({ error: `Invalid move: ${moveStr}` }));
            // Delete response file so we can poll again
            try {
              if (fs.existsSync(responsePath)) fs.unlinkSync(responsePath);
            } catch (e) {}
            triggerAiTurn().then(resolve);
          }
        } catch (err) {
          console.error('[AI] Error reading move response:', err);
          triggerAiTurn().then(resolve);
        }
      }
    }, 1000);
  });
}

// Prompt loop for terminal input
function promptPlayer() {
  if (!isGameActive) {
    rl.question('\nGame is over. Type "reset" to play again or "exit" to quit: ', async (answer) => {
      const cmd = answer.trim().toLowerCase();
      if (cmd === 'reset') {
        isGameActive = true;
        await handleReset();
        promptPlayer();
      } else if (cmd === 'exit') {
        cleanupAndExit();
      } else {
        promptPlayer();
      }
    });
    return;
  }

  if (engine.getTurn() === 'b') {
    // It's AI turn, wait for it to process
    triggerAiTurn().then(() => {
      promptPlayer();
    });
    return;
  }

  rl.question('Your move (e.g. e2e4, Nf3) or "reset" / "exit": ', async (answer) => {
    const input = answer.trim();
    if (input.toLowerCase() === 'exit') {
      cleanupAndExit();
      return;
    }
    
    if (input.toLowerCase() === 'reset') {
      await handleReset();
      promptPlayer();
      return;
    }

    if (input) {
      const success = await processMove(input);
      if (!success) {
        console.log('[Game] Invalid move! Please use standard notation like e2e4 or Nf3.');
        promptPlayer();
      } else {
        // Successful player move, triggers AI turn in the next loop
        promptPlayer();
      }
    } else {
      promptPlayer();
    }
  });
}

async function cleanupAndExit() {
  console.log('[Game] Cleaning up and exiting...');
  rl.close();
  await client.disconnect();
  process.exit(0);
}

// Parse Command Line Arguments
function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--port' && i + 1 < args.length) {
      lanPort = parseInt(args[++i]);
    } else if (args[i] === '--username' && i + 1 < args.length) {
      botUsername = args[++i];
    }
  }
}

async function main() {
  parseArgs();
  
  console.log('==================================================');
  console.log('          MINECRAFT CHESS AI CONTROLLER           ');
  console.log('==================================================');
  
  engine = new ChessEngine();
  client = new McpClient(dryRun);

  if (dryRun) {
    console.log('[Game] RUNNING IN DRY-RUN (MOCK) MODE.');
  }

  const startConnection = async () => {
    try {
      await client.connect(lanPort, botUsername);
      
      let botPos: Position = { x: 0, y: 4, z: 0 };
      if (!dryRun) {
        console.log('[Game] Fetching bot position...');
        for (let attempt = 1; attempt <= 10; attempt++) {
          try {
            botPos = await client.getBotPosition();
            break;
          } catch (e: any) {
            if (attempt === 10) {
              throw e;
            }
            console.log(`[Game] Bot is still connecting (attempt ${attempt}/10). Retrying in 2 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      console.log(`[Game] Bot is located at: (${botPos.x}, ${botPos.y}, ${botPos.z})`);
      
      // Board layout
      boardStartX = botPos.x + 4;
      boardStartY = botPos.y - 1;
      boardStartZ = botPos.z + 4;
      
      await client.sendChat('Chess Bot connected! Building chessboard floor...');
      await buildChessboardBase();
      
      // Spawn initial pieces
      await client.sendChat('Chessboard ready! Setting up initial piece blocks...');
      await syncBoard();
      
      await client.sendChat('Game is ready! Type your moves (e.g. e2e4) in console or chat.');
      
      printStatus();

      // Start chat polling loop if not dry-run
      if (!dryRun) {
        setInterval(pollInGameChat, 2000);
      }
      
      promptPlayer();
    } catch (e) {
      console.error('[Fatal Error] Failed to initialize game:', e);
      cleanupAndExit();
    }
  };

  if (dryRun || process.argv.includes('--port')) {
    await startConnection();
  } else {
    // Prompt for port
    rl.question('Enter Minecraft LAN Port (default 25565): ', async (portInput) => {
      const portStr = portInput.trim();
      if (portStr) {
        lanPort = parseInt(portStr);
      }
      await startConnection();
    });
  }
}

main().catch(console.error);
