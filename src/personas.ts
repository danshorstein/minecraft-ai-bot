import fs from 'fs';
import path from 'path';

// Persona packs: small configs that overlay the base system prompt with a
// voice, build-material biases, and behavior tweaks. Built-ins ship in code;
// kid-created personas are persisted to data/personas.json.

export interface PersonaConfig {
  name: string;
  displayName: string;
  description: string;
  promptOverlay: string;
  preferredMaterials?: string[];
  followDistance?: number;
  emojiStyle?: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PERSONAS_FILE = path.join(DATA_DIR, 'personas.json');
const MAX_CUSTOM_PERSONAS = 40;

const BUILT_IN_PERSONAS: PersonaConfig[] = [
  {
    name: 'aiguy',
    displayName: 'AIGuy Classic',
    description: 'The original: energetic, slightly chaotic, extremely fun.',
    promptOverlay: '',
    followDistance: 3,
    emojiStyle: '🚀🎉',
  },
  {
    name: 'wizard',
    displayName: 'Wizzo the Wizard',
    description: 'A mystical wizard who speaks in riddles and loves particle spells.',
    promptOverlay: `PERSONA: You are Wizzo the Wizard! Speak mystically ("Ah, young apprentice...", "The ancient blocks whisper..."). You LOVE casting "spells" with createParticleEffect (portal swirls and soul fire are your favorites) and you prefer building with deepslate, purpur, amethyst, and glowstone. Call builds "conjurations" and refer to commands as "incantations".`,
    preferredMaterials: ['deepslate_bricks', 'purpur_block', 'amethyst_block', 'glowstone'],
    followDistance: 4,
    emojiStyle: '🧙✨🔮',
  },
  {
    name: 'pirate',
    displayName: 'Captain Blockbeard',
    description: 'A pirate captain obsessed with ships, treasure, and sea shanties.',
    promptOverlay: `PERSONA: You are Captain Blockbeard, a jolly pirate! Talk like a pirate ("Arrr!", "Ahoy matey!", "Shiver me timbers!"). You love building ships, docks, and treasure islands from oak, spruce, and barrels, and hiding "treasure" chests. Celebrate with /playsound sea-shanty-style note blocks and call the players your crew.`,
    preferredMaterials: ['oak_planks', 'spruce_planks', 'barrel', 'gold_block'],
    followDistance: 4,
    emojiStyle: '🏴‍☠️⚓🦜',
  },
  {
    name: 'robot',
    displayName: 'Butler-Bot 3000',
    description: 'A precise robot butler obsessed with symmetry and formality.',
    promptOverlay: `PERSONA: You are Butler-Bot 3000, a formal robot butler. Speak precisely and politely ("Affirmative, young master.", "Calculating optimal build parameters..."). You are OBSESSED with symmetry — every build must be perfectly mirrored. You prefer quartz, iron blocks, and smooth stone, and you report exact block counts after every task.`,
    preferredMaterials: ['quartz_block', 'iron_block', 'smooth_stone'],
    followDistance: 2,
    emojiStyle: '🤖📐',
  },
  {
    name: 'gremlin',
    displayName: 'Giggles the Gremlin',
    description: 'A harmless prankster full of silly surprises.',
    promptOverlay: `PERSONA: You are Giggles the Chaos Gremlin! You are mischievous but ALWAYS harmless: your "TNT" is secretly fireworks, your pranks are silly (surprise chickens, upside-down builds, sudden confetti), and you giggle constantly ("hehehe!"). NEVER do anything actually destructive to players' builds — chaos means FUN surprises, not damage.`,
    preferredMaterials: ['slime_block', 'honey_block', 'target', 'note_block'],
    followDistance: 2,
    emojiStyle: '😈🎪🐔',
  },
];

let customPersonas: PersonaConfig[] = [];

function isValidPersona(value: unknown): value is PersonaConfig {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.name === 'string' && /^[a-z0-9_-]{2,24}$/.test(p.name) &&
    typeof p.displayName === 'string' && p.displayName.length > 0 &&
    typeof p.description === 'string' &&
    typeof p.promptOverlay === 'string'
  );
}

function normalizePersona(p: PersonaConfig): PersonaConfig {
  return {
    name: p.name.toLowerCase(),
    displayName: p.displayName.slice(0, 40),
    description: p.description.slice(0, 160),
    promptOverlay: p.promptOverlay.slice(0, 1200),
    preferredMaterials: Array.isArray(p.preferredMaterials)
      ? p.preferredMaterials.filter(m => typeof m === 'string').slice(0, 8)
      : undefined,
    followDistance: typeof p.followDistance === 'number'
      ? Math.max(2, Math.min(10, Math.floor(p.followDistance)))
      : undefined,
    emojiStyle: typeof p.emojiStyle === 'string' ? p.emojiStyle.slice(0, 12) : undefined,
  };
}

export function loadPersonas(): void {
  try {
    const raw = fs.readFileSync(PERSONAS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    customPersonas = Array.isArray(parsed) ? parsed.filter(isValidPersona).map(normalizePersona) : [];
    console.log(`[Personas] Loaded ${customPersonas.length} custom persona(s) from ${PERSONAS_FILE}`);
  } catch {
    customPersonas = [];
  }
}

function persist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PERSONAS_FILE, JSON.stringify(customPersonas, null, 2), 'utf8');
  } catch (err) {
    console.error('[Personas] Failed to save personas file:', err);
  }
}

export function getPersona(name: string): PersonaConfig | undefined {
  const key = name.trim().toLowerCase();
  return (
    BUILT_IN_PERSONAS.find(p => p.name === key) ||
    customPersonas.find(p => p.name === key)
  );
}

export function listPersonas(): PersonaConfig[] {
  return [...BUILT_IN_PERSONAS, ...customPersonas];
}

export function savePersona(config: PersonaConfig): PersonaConfig {
  const normalized = normalizePersona(config);
  if (!isValidPersona(normalized)) {
    throw new Error('Persona config is missing required fields (name, displayName, description, promptOverlay).');
  }
  if (BUILT_IN_PERSONAS.some(p => p.name === normalized.name)) {
    throw new Error(`"${normalized.name}" is a built-in persona and cannot be overwritten.`);
  }
  customPersonas = customPersonas.filter(p => p.name !== normalized.name);
  customPersonas.push(normalized);
  if (customPersonas.length > MAX_CUSTOM_PERSONAS) customPersonas = customPersonas.slice(-MAX_CUSTOM_PERSONAS);
  persist();
  return normalized;
}

export function personaPromptSection(persona: PersonaConfig): string {
  const parts: string[] = [];
  if (persona.promptOverlay) parts.push(persona.promptOverlay);
  if (persona.preferredMaterials && persona.preferredMaterials.length > 0) {
    parts.push(`When choosing build materials, prefer: ${persona.preferredMaterials.join(', ')}.`);
  }
  if (persona.emojiStyle) {
    parts.push(`Favor these emoji in chat: ${persona.emojiStyle}`);
  }
  return parts.join('\n');
}
