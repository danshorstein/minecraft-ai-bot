import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_DIR = path.resolve(__dirname, '../minecraft-server');
const JAR_PATH = path.join(SERVER_DIR, 'server.jar');
const EULA_PATH = path.join(SERVER_DIR, 'eula.txt');
const PROPERTIES_PATH = path.join(SERVER_DIR, 'server.properties');

const PAPER_URL = 'https://api.papermc.io/v2/projects/paper/versions/1.20.4/builds/499/downloads/paper-1.20.4-499.jar';

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`[Setup] Downloading Minecraft server from: ${url}`);
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download server: Status code ${response.statusCode}`));
        return;
      }
      
      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;
      let lastReportPercent = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize > 0) {
          const percent = Math.floor((downloadedSize / totalSize) * 100);
          if (percent >= lastReportPercent + 10) {
            console.log(`[Setup] Download progress: ${percent}%`);
            lastReportPercent = percent;
          }
        }
      });

      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log('[Setup] Download complete!');
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log('[Setup] Setting up local headless Minecraft server...');
  
  if (!fs.existsSync(SERVER_DIR)) {
    fs.mkdirSync(SERVER_DIR, { recursive: true });
  }

  // 1. Download Paper jar if not present
  if (!fs.existsSync(JAR_PATH)) {
    await downloadFile(PAPER_URL, JAR_PATH);
  } else {
    console.log('[Setup] server.jar already exists, skipping download.');
  }

  // 2. Write eula.txt
  console.log('[Setup] Generating eula.txt...');
  fs.writeFileSync(EULA_PATH, 'eula=true\n');

  // 3. Write server.properties
  console.log('[Setup] Generating server.properties...');
  const properties = [
    'online-mode=false',
    'gamemode=creative',
    'spawn-protection=0',
    'difficulty=peaceful',
    'level-type=flat',
    'allow-flight=true',
    'enable-command-block=true',
    'motd=Minecraft AIGuy Server',
    'sync-chunk-writes=false',
    'view-distance=6'
  ].join('\n') + '\n';
  
  fs.writeFileSync(PROPERTIES_PATH, properties);
  
  console.log('[Setup] Server setup completed successfully!');
}

main().catch(console.error);
