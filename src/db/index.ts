/**
 * SQLite database for swarm state tracking
 * Uses bun:sqlite for high-performance local storage
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "swarm.db");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database with WAL mode for better concurrent access
const db = new Database(DB_PATH, { create: true, strict: true });
db.run("PRAGMA journal_mode = WAL;");

// Initialize schema
db.run(`
  CREATE TABLE IF NOT EXISTS swarm_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cycle_id TEXT NOT NULL,
    cycle_number INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'idle',
    pid INTEGER,
    updated_at TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS specialists (
    agent_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    current_symbol TEXT,
    signals_published INTEGER DEFAULT 0,
    streaming_text TEXT,
    last_message TEXT,
    error TEXT,
    last_activity TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS active_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    UNIQUE(agent_id, tool_name)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS consensus (
    symbol TEXT PRIMARY KEY,
    weighted_score REAL NOT NULL,
    signal_count INTEGER NOT NULL,
    average_confidence REAL,
    recommendation TEXT NOT NULL,
    position_size_multiplier REAL,
    dissent TEXT,
    updated_at TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS cycle_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id TEXT NOT NULL,
    cycle_number INTEGER NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    completed_at TEXT NOT NULL
  )
`);

// Insert initial state if not exists
db.run(`
  INSERT OR IGNORE INTO swarm_state (id, cycle_id, cycle_number, status, updated_at)
  VALUES (1, '', 0, 'idle', datetime('now'))
`);

// Prepared statements for performance
const statements = {
  // Swarm state
  updateSwarmState: db.query(`
    UPDATE swarm_state
    SET cycle_id = $cycleId, cycle_number = $cycleNumber, status = $status, pid = $pid, updated_at = datetime('now')
    WHERE id = 1
  `),
  getSwarmState: db.query(`SELECT * FROM swarm_state WHERE id = 1`),

  // Specialists
  upsertSpecialist: db.query(`
    INSERT INTO specialists (agent_id, role, status, current_symbol, signals_published, streaming_text, last_message, error, last_activity)
    VALUES ($agentId, $role, $status, $currentSymbol, $signalsPublished, $streamingText, $lastMessage, $error, datetime('now'))
    ON CONFLICT(agent_id) DO UPDATE SET
      role = $role,
      status = $status,
      current_symbol = $currentSymbol,
      signals_published = $signalsPublished,
      streaming_text = $streamingText,
      last_message = $lastMessage,
      error = $error,
      last_activity = datetime('now')
  `),
  updateStreamingText: db.query(`
    UPDATE specialists SET streaming_text = $streamingText, last_activity = datetime('now')
    WHERE agent_id = $agentId
  `),
  appendStreamingText: db.query(`
    UPDATE specialists SET streaming_text = COALESCE(streaming_text, '') || $text, last_activity = datetime('now')
    WHERE agent_id = $agentId
  `),
  updateSpecialistStatus: db.query(`
    UPDATE specialists SET status = $status, last_activity = datetime('now')
    WHERE agent_id = $agentId
  `),
  incrementSignals: db.query(`
    UPDATE specialists SET signals_published = signals_published + 1, status = 'publishing', last_activity = datetime('now')
    WHERE agent_id = $agentId
  `),
  getSpecialist: db.query(`SELECT * FROM specialists WHERE agent_id = $agentId`),
  getAllSpecialists: db.query(`SELECT * FROM specialists`),
  resetSpecialists: db.query(`
    UPDATE specialists SET status = 'idle', streaming_text = '', current_symbol = NULL, error = NULL
  `),

  // Active tools
  addActiveTool: db.query(`
    INSERT OR REPLACE INTO active_tools (agent_id, tool_name, started_at)
    VALUES ($agentId, $toolName, datetime('now'))
  `),
  removeActiveTool: db.query(`
    DELETE FROM active_tools WHERE agent_id = $agentId AND tool_name = $toolName
  `),
  clearAgentTools: db.query(`DELETE FROM active_tools WHERE agent_id = $agentId`),
  clearAllTools: db.query(`DELETE FROM active_tools`),
  getAllActiveTools: db.query(`SELECT * FROM active_tools`),

  // Consensus
  upsertConsensus: db.query(`
    INSERT INTO consensus (symbol, weighted_score, signal_count, average_confidence, recommendation, position_size_multiplier, dissent, updated_at)
    VALUES ($symbol, $weightedScore, $signalCount, $averageConfidence, $recommendation, $positionSizeMultiplier, $dissent, datetime('now'))
    ON CONFLICT(symbol) DO UPDATE SET
      weighted_score = $weightedScore,
      signal_count = $signalCount,
      average_confidence = $averageConfidence,
      recommendation = $recommendation,
      position_size_multiplier = $positionSizeMultiplier,
      dissent = $dissent,
      updated_at = datetime('now')
  `),
  getAllConsensus: db.query(`SELECT * FROM consensus`),
  clearConsensus: db.query(`DELETE FROM consensus`),

  // Cycle results
  insertCycleResult: db.query(`
    INSERT INTO cycle_results (cycle_id, cycle_number, tokens_used, cost_usd, completed_at)
    VALUES ($cycleId, $cycleNumber, $tokensUsed, $costUsd, datetime('now'))
  `),
  getLatestCycleResult: db.query(`
    SELECT * FROM cycle_results ORDER BY id DESC LIMIT 1
  `),
};

// Export typed functions
export const swarmDb = {
  // Swarm state
  updateState(state: {
    cycleId: string;
    cycleNumber: number;
    status: "idle" | "running" | "complete" | "error" | "stopped";
    pid?: number | null;
  }) {
    statements.updateSwarmState.run({
      cycleId: state.cycleId,
      cycleNumber: state.cycleNumber,
      status: state.status,
      pid: state.pid ?? null,
    });
  },

  getState() {
    return statements.getSwarmState.get() as {
      id: number;
      cycle_id: string;
      cycle_number: number;
      status: string;
      pid: number | null;
      updated_at: string;
    } | null;
  },

  // Specialists
  upsertSpecialist(specialist: {
    agentId: string;
    role: string;
    status: string;
    currentSymbol?: string | null;
    signalsPublished?: number;
    streamingText?: string | null;
    lastMessage?: string | null;
    error?: string | null;
  }) {
    statements.upsertSpecialist.run({
      agentId: specialist.agentId,
      role: specialist.role,
      status: specialist.status,
      currentSymbol: specialist.currentSymbol ?? null,
      signalsPublished: specialist.signalsPublished ?? 0,
      streamingText: specialist.streamingText ?? null,
      lastMessage: specialist.lastMessage ?? null,
      error: specialist.error ?? null,
    });
  },

  appendStreamingText(agentId: string, text: string) {
    statements.appendStreamingText.run({ agentId, text });
  },

  updateSpecialistStatus(agentId: string, status: string) {
    statements.updateSpecialistStatus.run({ agentId, status });
  },

  incrementSignals(agentId: string) {
    statements.incrementSignals.run({ agentId });
  },

  getSpecialist(agentId: string) {
    return statements.getSpecialist.get({ agentId });
  },

  getAllSpecialists() {
    return statements.getAllSpecialists.all() as Array<{
      agent_id: string;
      role: string;
      status: string;
      current_symbol: string | null;
      signals_published: number;
      streaming_text: string | null;
      last_message: string | null;
      error: string | null;
      last_activity: string;
    }>;
  },

  resetSpecialists() {
    statements.resetSpecialists.run();
  },

  // Active tools
  addActiveTool(agentId: string, toolName: string) {
    statements.addActiveTool.run({ agentId, toolName });
  },

  removeActiveTool(agentId: string, toolName: string) {
    statements.removeActiveTool.run({ agentId, toolName });
  },

  clearAgentTools(agentId: string) {
    statements.clearAgentTools.run({ agentId });
  },

  clearAllTools() {
    statements.clearAllTools.run();
  },

  getAllActiveTools() {
    return statements.getAllActiveTools.all() as Array<{
      id: number;
      agent_id: string;
      tool_name: string;
      started_at: string;
    }>;
  },

  // Consensus
  upsertConsensus(consensus: {
    symbol: string;
    weightedScore: number;
    signalCount: number;
    averageConfidence?: number;
    recommendation: string;
    positionSizeMultiplier?: number;
    dissent?: string[];
  }) {
    statements.upsertConsensus.run({
      symbol: consensus.symbol,
      weightedScore: consensus.weightedScore,
      signalCount: consensus.signalCount,
      averageConfidence: consensus.averageConfidence ?? null,
      recommendation: consensus.recommendation,
      positionSizeMultiplier: consensus.positionSizeMultiplier ?? null,
      dissent: consensus.dissent ? JSON.stringify(consensus.dissent) : null,
    });
  },

  getAllConsensus() {
    const rows = statements.getAllConsensus.all() as Array<{
      symbol: string;
      weighted_score: number;
      signal_count: number;
      average_confidence: number | null;
      recommendation: string;
      position_size_multiplier: number | null;
      dissent: string | null;
      updated_at: string;
    }>;
    return rows.map(row => ({
      symbol: row.symbol,
      weightedScore: row.weighted_score,
      signalCount: row.signal_count,
      averageConfidence: row.average_confidence,
      recommendation: row.recommendation,
      positionSizeMultiplier: row.position_size_multiplier,
      dissent: row.dissent ? JSON.parse(row.dissent) : null,
    }));
  },

  clearConsensus() {
    statements.clearConsensus.run();
  },

  // Cycle results
  insertCycleResult(result: {
    cycleId: string;
    cycleNumber: number;
    tokensUsed: number;
    costUsd: number;
  }) {
    statements.insertCycleResult.run({
      cycleId: result.cycleId,
      cycleNumber: result.cycleNumber,
      tokensUsed: result.tokensUsed,
      costUsd: result.costUsd,
    });
  },

  getLatestCycleResult() {
    return statements.getLatestCycleResult.get() as {
      id: number;
      cycle_id: string;
      cycle_number: number;
      tokens_used: number;
      cost_usd: number;
      completed_at: string;
    } | null;
  },

  // Transactions for batch operations
  transaction<T>(fn: () => T): T {
    return db.transaction(fn)();
  },

  // Start a new cycle (reset state)
  startCycle(cycleId: string, cycleNumber: number) {
    db.transaction(() => {
      statements.updateSwarmState.run({
        cycleId,
        cycleNumber,
        status: "running",
        pid: process.pid,
      });
      statements.resetSpecialists.run();
      statements.clearAllTools.run();
      statements.clearConsensus.run();
    })();
  },

  // Complete a cycle
  completeCycle(tokensUsed: number, costUsd: number) {
    const state = this.getState();
    if (state) {
      db.transaction(() => {
        statements.updateSwarmState.run({
          cycleId: state.cycle_id,
          cycleNumber: state.cycle_number,
          status: "complete",
          pid: state.pid,
        });
        statements.insertCycleResult.run({
          cycleId: state.cycle_id,
          cycleNumber: state.cycle_number,
          tokensUsed,
          costUsd,
        });
      })();
    }
  },

  // Close database
  close() {
    db.close();
  },
};

export default swarmDb;
