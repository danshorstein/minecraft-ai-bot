import fs from 'fs';
import path from 'path';

// Persistent memory for AIGuy: player facts and named build waypoints,
// stored as JSON on disk so the bot remembers players between restarts.

export interface PlayerFact {
  about: string;
  fact: string;
  learnedAt: string;
}

export interface Waypoint {
  name: string;
  x: number;
  y: number;
  z: number;
  description?: string;
  createdAt: string;
}

interface MemoryStore {
  facts: PlayerFact[];
  waypoints: Waypoint[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const MAX_FACTS = 200;
const MAX_WAYPOINTS = 100;

let store: MemoryStore = { facts: [], waypoints: [] };

export function loadMemory(): void {
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    store = {
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      waypoints: Array.isArray(parsed.waypoints) ? parsed.waypoints : [],
    };
    console.log(`[Memory] Loaded ${store.facts.length} fact(s) and ${store.waypoints.length} waypoint(s) from ${MEMORY_FILE}`);
  } catch {
    store = { facts: [], waypoints: [] };
    console.log('[Memory] No existing memory file; starting fresh.');
  }
}

function persist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[Memory] Failed to save memory file:', err);
  }
}

export function addFact(about: string, fact: string): PlayerFact {
  const cleanAbout = about.trim().slice(0, 32) || 'player';
  const cleanFact = fact.trim().slice(0, 200);
  const entry: PlayerFact = { about: cleanAbout, fact: cleanFact, learnedAt: new Date().toISOString() };

  // Replace near-duplicate facts about the same player instead of stacking them
  store.facts = store.facts.filter(f => !(f.about === cleanAbout && f.fact.toLowerCase() === cleanFact.toLowerCase()));
  store.facts.push(entry);
  if (store.facts.length > MAX_FACTS) store.facts = store.facts.slice(-MAX_FACTS);
  persist();
  return entry;
}

export function addWaypoint(name: string, x: number, y: number, z: number, description?: string): Waypoint {
  const cleanName = name.trim().slice(0, 60) || 'unnamed spot';
  const entry: Waypoint = {
    name: cleanName,
    x: Math.round(x),
    y: Math.round(y),
    z: Math.round(z),
    description: description?.trim().slice(0, 200),
    createdAt: new Date().toISOString(),
  };

  store.waypoints = store.waypoints.filter(w => w.name.toLowerCase() !== cleanName.toLowerCase());
  store.waypoints.push(entry);
  if (store.waypoints.length > MAX_WAYPOINTS) store.waypoints = store.waypoints.slice(-MAX_WAYPOINTS);
  persist();
  return entry;
}

export function getFacts(): readonly PlayerFact[] {
  return store.facts;
}

export function getWaypoints(): readonly Waypoint[] {
  return store.waypoints;
}

export function memorySummaryForPrompt(): string {
  const lines: string[] = [];

  if (store.facts.length > 0) {
    lines.push('Things you remember about the players (from past sessions):');
    for (const f of store.facts.slice(-40)) {
      lines.push(`- ${f.about}: ${f.fact}`);
    }
  }

  if (store.waypoints.length > 0) {
    lines.push('Saved build waypoints (use /tp <player> <x> <y> <z> to take players back to them):');
    for (const w of store.waypoints.slice(-30)) {
      lines.push(`- "${w.name}" at (${w.x}, ${w.y}, ${w.z})${w.description ? ` — ${w.description}` : ''}`);
    }
  }

  if (lines.length === 0) {
    return 'You have no saved memories yet. Use the rememberFact tool when players share things about themselves.';
  }

  return lines.join('\n');
}
