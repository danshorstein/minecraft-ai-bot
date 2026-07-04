import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Position {
  x: number;
  y: number;
  z: number;
}

export class McpClient {
  private serverProcess: ChildProcess | null = null;
  private dryRun: boolean;
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private stdoutBuffer = '';

  constructor(dryRun: boolean = false) {
    this.dryRun = dryRun;
  }

  async connect(port: number, username: string = 'ChessBot'): Promise<void> {
    if (this.dryRun) {
      console.log(`[MOCK MCP] Connecting to Minecraft at localhost:${port} as ${username}...`);
      return;
    }

    const serverPath = path.resolve(__dirname, '../minecraft-mcp-server/dist/main.js');
    console.log(`[MCP] Starting Minecraft MCP Server from: ${serverPath}`);

    this.serverProcess = spawn('node', [
      serverPath,
      '--host', 'localhost',
      '--port', port.toString(),
      '--username', username
    ]);

    // Handle process events
    this.serverProcess.on('error', (err) => {
      console.error('[MCP Server Process Error]:', err);
    });

    this.serverProcess.on('exit', (code, signal) => {
      console.log(`[MCP Server Process Exited] Code: ${code}, Signal: ${signal}`);
    });

    this.serverProcess.stderr?.on('data', (data) => {
      // Print logs from the MCP server to help debugging
      const str = data.toString().trim();
      if (str) {
        console.error(`[MCP Server Log]: ${str}`);
      }
    });

    this.serverProcess.stdout?.on('data', (data) => {
      this.stdoutBuffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
        const line = this.stdoutBuffer.substring(0, newlineIndex).trim();
        this.stdoutBuffer = this.stdoutBuffer.substring(newlineIndex + 1);
        if (line) {
          this.handleServerMessage(line);
        }
      }
    });

    // Wait for handshake
    console.log('[MCP] Initializing handshake with MCP server...');
    await this.initializeHandshake();
    console.log('[MCP] Handshake complete!');
  }

  private handleServerMessage(line: string) {
    try {
      const msg = JSON.parse(line);
      // We are looking for responses to our JSON-RPC requests
      if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
        const { resolve, reject } = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          reject(msg.error);
        } else {
          resolve(msg.result);
        }
      }
    } catch (e) {
      console.error('[MCP Client] Error parsing server message:', line, e);
    }
  }

  private sendRequest(method: string, params: any = {}): Promise<any> {
    if (this.dryRun) {
      return Promise.resolve({ content: [{ type: 'text', text: 'Mock response' }] });
    }

    if (!this.serverProcess || !this.serverProcess.stdin) {
      return Promise.reject(new Error('MCP server process is not running.'));
    }

    const id = ++this.messageId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.serverProcess!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  private async initializeHandshake(): Promise<void> {
    // 1. Send initialize
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'chess-client',
        version: '1.0.0'
      }
    });

    // 2. Send initialized notification
    if (!this.dryRun && this.serverProcess && this.serverProcess.stdin) {
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      };
      this.serverProcess.stdin.write(JSON.stringify(notification) + '\n');
    }
  }

  async disconnect(): Promise<void> {
    if (this.dryRun) {
      console.log('[MOCK MCP] Disconnected.');
      return;
    }
    if (this.serverProcess) {
      console.log('[MCP] Disconnecting server...');
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  // Call a tool on the MCP server
  async callTool(name: string, args: any = {}): Promise<any> {
    if (this.dryRun) {
      if (name === 'get-position') {
        return { content: [{ type: 'text', text: 'Current position: (0, 4, 0)' }] };
      }
      if (name === 'read-chat') {
        return { content: [{ type: 'text', text: 'No chat messages found' }] };
      }
      return { content: [{ type: 'text', text: `Mocked success for tool ${name}` }] };
    }

    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args
    });

    return result;
  }

  // Helper: Get Bot Position
  async getBotPosition(): Promise<Position> {
    const result = await this.callTool('get-position');
    const text = result.content[0].text;
    
    // Parse: "Current position: (X, Y, Z)"
    const match = text.match(/Current position:\s*\(([-\d]+),\s*([-\d]+),\s*([-\d]+)\)/);
    if (match) {
      return {
        x: parseInt(match[1]),
        y: parseInt(match[2]),
        z: parseInt(match[3])
      };
    }
    
    throw new Error(`Failed to parse bot position from response: ${text}`);
  }

  // Helper: Send Chat Message (or execute commands)
  async sendChat(message: string): Promise<void> {
    if (this.dryRun) {
      console.log(`[MOCK CHAT] Bot says: "${message}"`);
      return;
    }
    await this.callTool('send-chat', { message });
  }

  // Helper: Read Chat Messages
  async readChat(count: number = 10): Promise<{ username: string; content: string; timestamp: string }[]> {
    const result = await this.callTool('read-chat', { count });
    const text = result.content[0].text;
    
    if (text.includes('No chat messages found')) {
      return [];
    }

    // Parse output format:
    // "Found X chat message(s):"
    // "1. ISO_TIMESTAMP - username: content"
    const lines = text.split('\n');
    const messages: { username: string; content: string; timestamp: string }[] = [];
    
    for (const line of lines) {
      const match = line.match(/^\d+\.\s+([^\s]+)\s+-\s+([^:]+):\s*(.*)$/);
      if (match) {
        messages.push({
          timestamp: match[1],
          username: match[2],
          content: match[3]
        });
      }
    }
    return messages;
  }

  // Helper: Place block by running command
  async setBlock(x: number, y: number, z: number, blockType: string): Promise<void> {
    if (this.dryRun) {
      console.log(`[MOCK MCP] Setting block '${blockType}' at (${x}, ${y}, ${z})`);
      return;
    }
    // We send a /setblock command via chat
    await this.sendChat(`/setblock ${x} ${y} ${z} minecraft:${blockType} replace`);
  }

  // Helper: Fill region by running command
  async fill(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, blockType: string): Promise<void> {
    if (this.dryRun) {
      console.log(`[MOCK MCP] Filling from (${x1}, ${y1}, ${z1}) to (${x2}, ${y2}, ${z2}) with '${blockType}'`);
      return;
    }
    // We send a /fill command via chat
    await this.sendChat(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:${blockType} replace`);
  }
}
