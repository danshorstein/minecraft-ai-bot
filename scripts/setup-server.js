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

const PAPER_VERSION = '1.20.4';
const PAPER_API_BASE = 'https://fill.papermc.io/v3/projects/paper';
const MIN_VALID_JAR_BYTES = 1024 * 1024;
const REQUEST_HEADERS = {
  'User-Agent': 'minecraft-ai-companion-bot-setup/1.0 (+https://github.com/danshorstein/minecraft-ai-bot)',
};

async function getJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: REQUEST_HEADERS }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects while fetching ${url}`));
          return;
        }
        resolve(getJson(new URL(response.headers.location, url).toString(), redirectCount + 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to fetch ${url}: Status code ${response.statusCode}`));
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function getLatestPaperDownloadUrl() {
  const buildsUrl = `${PAPER_API_BASE}/versions/${PAPER_VERSION}/builds`;
  const builds = await getJson(buildsUrl);

  if (!Array.isArray(builds) || builds.length === 0) {
    throw new Error(`No Paper builds found for Minecraft ${PAPER_VERSION}.`);
  }

  const latestBuild = builds.find(build => build.channel === 'STABLE' && build.downloads?.['server:default']?.url) ||
    builds.find(build => build.downloads?.['server:default']?.url);

  if (!latestBuild) {
    throw new Error(`No downloadable Paper server jar found for Minecraft ${PAPER_VERSION}.`);
  }

  console.log(`[Setup] Latest Paper ${PAPER_VERSION} build: ${latestBuild.id}`);
  return latestBuild.downloads['server:default'].url;
}

function hasValidServerJar() {
  if (!fs.existsSync(JAR_PATH)) return false;
  const size = fs.statSync(JAR_PATH).size;
  if (size >= MIN_VALID_JAR_BYTES) return true;

  console.log(`[Setup] Existing server.jar is invalid (${size} bytes), replacing it.`);
  fs.unlinkSync(JAR_PATH);
  return false;
}

async function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    console.log(`[Setup] Downloading Minecraft server from: ${url}`);
    const file = fs.createWriteStream(dest);
    
    https.get(url, { headers: REQUEST_HEADERS }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        file.close(() => fs.unlink(dest, () => {}));
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        resolve(downloadFile(new URL(response.headers.location, url).toString(), dest, redirectCount + 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        file.close(() => fs.unlink(dest, () => {}));
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

  // 1. Download Paper jar if not present or if a previous failed download left
  // a tiny placeholder file.
  if (!hasValidServerJar()) {
    const paperUrl = await getLatestPaperDownloadUrl();
    await downloadFile(paperUrl, JAR_PATH);
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
