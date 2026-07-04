import { Chess } from 'chess.js';

export interface Piece {
  type: 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
  color: 'w' | 'b';
}

export class ChessEngine {
  private chess: Chess;

  constructor() {
    this.chess = new Chess();
  }

  reset() {
    this.chess = new Chess();
  }

  getFen(): string {
    return this.chess.fen();
  }

  loadFen(fen: string) {
    this.chess = new Chess(fen);
  }

  getTurn(): 'w' | 'b' {
    return this.chess.turn();
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  getGameOverReason(): string {
    if (this.chess.isCheckmate()) {
      return 'Checkmate!';
    }
    if (this.chess.isDraw()) {
      if (this.chess.isStalemate()) return 'Stalemate (Draw)';
      if (this.chess.isThreefoldRepetition()) return 'Threefold Repetition (Draw)';
      if (this.chess.isInsufficientMaterial()) return 'Insufficient Material (Draw)';
      return 'Draw (50-move rule or agreement)';
    }
    return 'Active';
  }

  getBoard(): (Piece | null)[][] {
    return this.chess.board();
  }

  // Returns all legal moves
  getLegalMoves(): string[] {
    return this.chess.moves();
  }

  // Make player move (can be LAN format e2e4 or SAN format Nf3)
  makeMove(moveStr: string): boolean {
    try {
      // Try to parse moveStr. It could be e2e4, e2-e4, or SAN.
      // chess.js move() accepts {from: 'e2', to: 'e4'} or SAN string.
      let cleaned = moveStr.trim();
      
      // Auto-capitalize lowercase piece prefixes for SAN notation:
      // n -> N, r -> R, q -> Q, k -> K
      if (/^[nrqk]/i.test(cleaned)) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      } else if (/^b[a-h][1-8]/i.test(cleaned)) {
        // If it starts with 'b' followed by a file and rank (e.g., bc4, bd2), capitalize it to Bishop 'B'.
        // (This distinguishes it from pawn moves/captures like b4 or bxc3)
        cleaned = 'B' + cleaned.slice(1);
      }
      
      // If it is in the form e2e4 (4 chars)
      if (cleaned.length === 4 && /^[a-h][1-8][a-h][1-8]$/.test(cleaned.toLowerCase())) {
        const from = cleaned.substring(0, 2).toLowerCase();
        const to = cleaned.substring(2, 4).toLowerCase();
        
        // Check if pawn promotion is needed
        const piece = this.chess.get(from as any);
        if (piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) {
          // Auto-promote to Queen for simplicity
          const result = this.chess.move({ from, to, promotion: 'q' });
          return !!result;
        }

        const result = this.chess.move({ from, to });
        return !!result;
      }
      
      // Try SAN
      const result = this.chess.move(cleaned);
      return !!result;
    } catch (e) {
      return false;
    }
  }

  // Value mapping for evaluation
  private getPieceValue(type: string): number {
    switch (type) {
      case 'p': return 10;
      case 'n': return 30;
      case 'b': return 30;
      case 'r': return 50;
      case 'q': return 90;
      case 'k': return 900;
      default: return 0;
    }
  }

  // Positional weight maps (centered pieces are better)
  private getPositionalWeight(type: string, x: number, y: number, color: 'w' | 'b'): number {
    // Basic heuristics: prefer pieces near center
    // x, y are 0-7. y=0 is row 8 (Black's side), y=7 is row 1 (White's side)
    const distToCenter = Math.abs(3.5 - x) + Math.abs(3.5 - y);
    const centerFactor = 7.0 - distToCenter; // ranges from 0 to 7

    switch (type) {
      case 'p':
        // Pawns want to advance. White pawns want lower y (index), Black pawns want higher y.
        const advance = color === 'w' ? (7 - y) : y;
        return centerFactor * 0.1 + advance * 0.2;
      case 'n':
        // Knights want center, hate edges
        return centerFactor * 0.5;
      case 'b':
        return centerFactor * 0.2;
      case 'r':
        return 0;
      case 'q':
        return centerFactor * 0.1;
      case 'k':
        // King wants safety early game (we'll keep it simple)
        return -centerFactor * 0.2;
      default:
        return 0;
    }
  }

  // Board evaluation: positive is good for White, negative is good for Black
  evaluateBoard(): number {
    let score = 0;
    const board = this.chess.board();
    
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece) {
          const val = this.getPieceValue(piece.type);
          const pos = this.getPositionalWeight(piece.type, c, r, piece.color);
          const totalVal = val + pos;
          score += piece.color === 'w' ? totalVal : -totalVal;
        }
      }
    }
    return score;
  }

  // Alpha-beta minimax search
  minimax(
    depth: number,
    alpha: number,
    beta: number,
    isMaximizing: boolean
  ): { score: number; move: any } {
    if (depth === 0 || this.chess.isGameOver()) {
      return { score: this.evaluateBoard(), move: null };
    }

    const moves = this.chess.moves({ verbose: true });
    
    // Sort moves to optimize alpha-beta pruning (captures first)
    moves.sort((a, b) => {
      const aScore = a.captured ? this.getPieceValue(a.captured) : 0;
      const bScore = b.captured ? this.getPieceValue(b.captured) : 0;
      return bScore - aScore;
    });

    let bestMove: any = null;

    if (isMaximizing) {
      let maxScore = -Infinity;
      for (const move of moves) {
        this.chess.move(move);
        const { score } = this.minimax(depth - 1, alpha, beta, false);
        this.chess.undo();

        if (score > maxScore) {
          maxScore = score;
          bestMove = move;
        }
        alpha = Math.max(alpha, score);
        if (beta <= alpha) {
          break; // Prune
        }
      }
      return { score: maxScore, move: bestMove };
    } else {
      let minScore = Infinity;
      for (const move of moves) {
        this.chess.move(move);
        const { score } = this.minimax(depth - 1, alpha, beta, true);
        this.chess.undo();

        if (score < minScore) {
          minScore = score;
          bestMove = move;
        }
        beta = Math.min(beta, score);
        if (beta <= alpha) {
          break; // Prune
        }
      }
      return { score: minScore, move: bestMove };
    }
  }

  // Returns the best move for the current turn
  getBestMove(depth: number = 3): string | null {
    const isWhite = this.chess.turn() === 'w';
    const { move } = this.minimax(depth, -Infinity, Infinity, isWhite);
    if (move) {
      // return the lane format (e.g. e2e4)
      return move.from + move.to + (move.promotion ? move.promotion : '');
    }
    // Fallback: select random legal move
    const moves = this.chess.moves({ verbose: true });
    if (moves.length > 0) {
      const randomMove = moves[Math.floor(Math.random() * moves.length)];
      return randomMove.from + randomMove.to + (randomMove.promotion ? randomMove.promotion : '');
    }
    return null;
  }

  // Returns ascii representation of the board
  getAsciiBoard(): string {
    return this.chess.ascii();
  }
}
