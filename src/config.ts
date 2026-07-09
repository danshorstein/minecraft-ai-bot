import fs from 'fs';
import path from 'path';

// Persisted brain configuration: which OpenRouter model handles each role.
// In-game switches (!model/!planner/!qa) are saved here and survive restarts.

export interface BrainConfig {
  regular: string;
  planner: string;
  qaVision: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export function loadBrainConfig(defaults: BrainConfig): BrainConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const config = {
      regular: typeof parsed.regular === 'string' && parsed.regular ? parsed.regular : defaults.regular,
      planner: typeof parsed.planner === 'string' && parsed.planner ? parsed.planner : defaults.planner,
      qaVision: typeof parsed.qaVision === 'string' && parsed.qaVision ? parsed.qaVision : defaults.qaVision,
    };
    console.log(`[Config] Loaded brain config from ${CONFIG_FILE}`);
    return config;
  } catch {
    return { ...defaults };
  }
}

export function saveBrainConfig(config: BrainConfig): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('[Config] Failed to save brain config:', err);
  }
}
