import * as fs from "node:fs";
import * as path from "node:path";
import type { Trade } from "../portfolio/types.js";

const LOGS_DIR = path.join(process.cwd(), "logs");
const JOURNAL_FILE = path.join(LOGS_DIR, "trades.jsonl");

export interface JournalEntry {
  timestamp: string;
  type: "trade" | "note" | "analysis";
  data: Trade | NoteEntry | AnalysisEntry;
}

export interface NoteEntry {
  symbol?: string;
  content: string;
  tags?: string[];
}

export interface AnalysisEntry {
  symbol: string;
  action: "buy" | "sell" | "hold";
  reasoning: string;
  confidence: number;
  priceAtAnalysis: number;
  indicators?: Record<string, number>;
}

function ensureLogDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Append a trade to the journal
 */
export function recordTrade(trade: Trade): void {
  ensureLogDir();

  const entry: JournalEntry = {
    timestamp: new Date().toISOString(),
    type: "trade",
    data: trade,
  };

  fs.appendFileSync(JOURNAL_FILE, `${JSON.stringify(entry)}\n`);
}

/**
 * Add a note to the journal
 */
export function addNote(content: string, symbol?: string, tags?: string[]): void {
  ensureLogDir();

  const entry: JournalEntry = {
    timestamp: new Date().toISOString(),
    type: "note",
    data: {
      symbol,
      content,
      tags,
    },
  };

  fs.appendFileSync(JOURNAL_FILE, `${JSON.stringify(entry)}\n`);
}

/**
 * Record an analysis entry
 */
export function recordAnalysis(analysis: AnalysisEntry): void {
  ensureLogDir();

  const entry: JournalEntry = {
    timestamp: new Date().toISOString(),
    type: "analysis",
    data: analysis,
  };

  fs.appendFileSync(JOURNAL_FILE, `${JSON.stringify(entry)}\n`);
}

/**
 * Read all journal entries
 */
export function readJournal(): JournalEntry[] {
  if (!fs.existsSync(JOURNAL_FILE)) {
    return [];
  }

  const content = fs.readFileSync(JOURNAL_FILE, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as JournalEntry);
}

/**
 * Read journal entries for a specific date
 */
export function readJournalForDate(date: string): JournalEntry[] {
  const entries = readJournal();
  return entries.filter((e) => e.timestamp.startsWith(date));
}

/**
 * Read journal entries for a specific symbol
 */
export function readJournalForSymbol(symbol: string): JournalEntry[] {
  const entries = readJournal();
  return entries.filter((e) => {
    if (e.type === "trade") {
      return (e.data as Trade).symbol === symbol;
    }
    if (e.type === "note") {
      return (e.data as NoteEntry).symbol === symbol;
    }
    if (e.type === "analysis") {
      return (e.data as AnalysisEntry).symbol === symbol;
    }
    return false;
  });
}

/**
 * Get trade statistics from journal
 */
export function getTradeStats(): {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnL: number;
  winRate: number;
  averagePnL: number;
  largestWin: number;
  largestLoss: number;
} {
  const entries = readJournal();
  const trades = entries
    .filter((e) => e.type === "trade")
    .map((e) => e.data as Trade)
    .filter((t) => t.pnl !== undefined);

  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnL: 0,
      winRate: 0,
      averagePnL: 0,
      largestWin: 0,
      largestLoss: 0,
    };
  }

  const winningTrades = trades.filter((t) => t.pnl! > 0);
  const losingTrades = trades.filter((t) => t.pnl! < 0);
  const totalPnL = trades.reduce((sum, t) => sum + t.pnl!, 0);

  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    totalPnL,
    winRate: trades.length > 0 ? winningTrades.length / trades.length : 0,
    averagePnL: trades.length > 0 ? totalPnL / trades.length : 0,
    largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map((t) => t.pnl!)) : 0,
    largestLoss: losingTrades.length > 0 ? Math.abs(Math.min(...losingTrades.map((t) => t.pnl!))) : 0,
  };
}

/**
 * Export journal to CSV
 */
export function exportToCSV(outputPath: string): void {
  const entries = readJournal();
  const trades = entries.filter((e) => e.type === "trade").map((e) => e.data as Trade);

  const header = "timestamp,symbol,side,quantity,price,value,commission,pnl";
  const rows = trades.map(
    (t) => `${t.executedAt},${t.symbol},${t.side},${t.quantity},${t.price},${t.value},${t.commission},${t.pnl ?? ""}`,
  );

  fs.writeFileSync(outputPath, [header, ...rows].join("\n"));
}
