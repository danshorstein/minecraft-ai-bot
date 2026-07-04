import { spawn } from 'child_process';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_DIR = path.resolve(__dirname, '../minecraft-server');

async function main() {
  console.log('[Server Manager] Starting headless Minecraft server...');
  
  const server = spawn('java', [
    '-Xmx1024M',
    '-Xms1024M',
    '-jar', 'server.jar',
    'nogui'
  ], {
    cwd: SERVER_DIR
  });

  let serverStarted = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  // Pipe user input to server stdin
  rl.on('line', (line) => {
    if (server.stdin) {
      server.stdin.write(line + '\n');
    }
  });

  // Monitor server stdout
  server.stdout.on('data', (data) => {
    const chunk = data.toString();
    process.stdout.write(chunk);

    if (!serverStarted && chunk.includes('Done')) {
      serverStarted = true;
      console.log('\n[Server Manager] Server started successfully! Auto OP-ing AIGuy...');
      setTimeout(() => {
        if (server.stdin) {
          server.stdin.write('op AIGuy\n');
        }
      }, 2000);
    }
  });

  server.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
  });

  server.on('exit', (code) => {
    console.log(`[Server Manager] Minecraft server exited with code ${code}`);
    process.exit(code || 0);
  });
}

main().catch(console.error);
