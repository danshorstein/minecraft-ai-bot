import mineflayer from 'mineflayer';

// Embodied crew members: thin puppet bots that give the planner and QA brains
// a body in the world. They never process chat, never run commands, and never
// need OP — the main bot (the only operator) teleports them around. Every
// method is failure-tolerant: a crew member that can't join or drops out must
// never break the goal loop.

export interface CrewConnectionOptions {
  host: string;
  port: number;
}

export class CrewMember {
  readonly username: string;
  readonly role: string;
  private readonly options: CrewConnectionOptions;
  private bot: mineflayer.Bot | null = null;
  private online = false;

  constructor(username: string, role: string, options: CrewConnectionOptions) {
    this.username = username;
    this.role = role;
    this.options = options;
  }

  isOnline(): boolean {
    return this.online && this.bot !== null;
  }

  async join(timeoutMs = 10000): Promise<boolean> {
    if (this.isOnline()) return true;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };

      try {
        const puppet = mineflayer.createBot({
          host: this.options.host,
          port: this.options.port,
          username: this.username,
          viewDistance: 'tiny',
        });
        this.bot = puppet;

        puppet.once('spawn', () => {
          this.online = true;
          console.log(`[Crew] ${this.username} (${this.role}) joined the server.`);
          settle(true);
        });
        puppet.on('error', (err: any) => {
          console.warn(`[Crew] ${this.username} connection error: ${err?.message || err}`);
          settle(false);
        });
        puppet.on('kicked', (reason) => {
          console.warn(`[Crew] ${this.username} was kicked: ${reason}`);
        });
        puppet.on('end', () => {
          console.log(`[Crew] ${this.username} disconnected.`);
          this.online = false;
          this.bot = null;
          settle(false);
        });

        setTimeout(() => settle(this.online), timeoutMs);
      } catch (err: any) {
        console.warn(`[Crew] ${this.username} failed to start: ${err?.message || err}`);
        settle(false);
      }
    });
  }

  say(message: string): void {
    if (!this.isOnline()) return;
    try {
      this.bot!.chat(message.replace(/\s+/g, ' ').trim().slice(0, 250));
    } catch (err) {
      console.warn(`[Crew] ${this.username} failed to chat:`, err);
    }
  }

  lookAt(x: number, y: number, z: number): void {
    if (!this.isOnline()) return;
    try {
      const pos = this.bot!.entity?.position;
      if (!pos) return;
      // Build an absolute Vec3 without importing vec3 directly
      void this.bot!.lookAt(pos.offset(x - pos.x, y - pos.y, z - pos.z));
    } catch {
      // Looking is pure decoration; never let it throw
    }
  }

  leave(farewell?: string): void {
    const puppet = this.bot;
    if (!puppet) return;
    if (farewell && this.online) this.say(farewell);
    this.online = false;
    this.bot = null;
    // Give the farewell a moment to reach chat before quitting
    setTimeout(() => {
      try {
        puppet.quit();
      } catch {
        // Already disconnected
      }
    }, 800);
  }
}
