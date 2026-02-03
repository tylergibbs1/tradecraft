/**
 * SQLite database reader for the UI
 * Uses better-sqlite3 for Node.js compatibility
 */
import Database from "better-sqlite3";
import { join } from "path";
import { existsSync } from "fs";

const DATA_DIR = join(process.cwd(), "..", "data");
const DB_PATH = join(DATA_DIR, "swarm.db");

// Check if database exists
function getDb(): Database.Database | null {
  if (!existsSync(DB_PATH)) {
    return null;
  }
  try {
    const db = new Database(DB_PATH, { readonly: true });
    return db;
  } catch {
    return null;
  }
}

export interface SwarmState {
  cycle_id: string;
  cycle_number: number;
  status: string;
  pid: number | null;
  updated_at: string;
}

export interface SpecialistState {
  agent_id: string;
  role: string;
  status: string;
  current_symbol: string | null;
  signals_published: number;
  streaming_text: string | null;
  last_message: string | null;
  error: string | null;
  last_activity: string;
}

export interface ActiveTool {
  id: number;
  agent_id: string;
  tool_name: string;
  started_at: string;
}

export interface ConsensusRow {
  symbol: string;
  weighted_score: number;
  signal_count: number;
  average_confidence: number | null;
  recommendation: string;
  position_size_multiplier: number | null;
  dissent: string | null;
  updated_at: string;
}

export interface CycleResult {
  id: number;
  cycle_id: string;
  cycle_number: number;
  tokens_used: number;
  cost_usd: number;
  completed_at: string;
}

export const swarmDbReader = {
  getState(): SwarmState | null {
    const db = getDb();
    if (!db) return null;
    try {
      const stmt = db.prepare("SELECT * FROM swarm_state WHERE id = 1");
      const result = stmt.get() as SwarmState | undefined;
      db.close();
      return result || null;
    } catch {
      db.close();
      return null;
    }
  },

  getAllSpecialists(): SpecialistState[] {
    const db = getDb();
    if (!db) return [];
    try {
      const stmt = db.prepare("SELECT * FROM specialists");
      const result = stmt.all() as SpecialistState[];
      db.close();
      return result;
    } catch {
      db.close();
      return [];
    }
  },

  getAllActiveTools(): ActiveTool[] {
    const db = getDb();
    if (!db) return [];
    try {
      const stmt = db.prepare("SELECT * FROM active_tools");
      const result = stmt.all() as ActiveTool[];
      db.close();
      return result;
    } catch {
      db.close();
      return [];
    }
  },

  getAllConsensus(): ConsensusRow[] {
    const db = getDb();
    if (!db) return [];
    try {
      const stmt = db.prepare("SELECT * FROM consensus");
      const result = stmt.all() as ConsensusRow[];
      db.close();
      return result;
    } catch {
      db.close();
      return [];
    }
  },

  getLatestCycleResult(): CycleResult | null {
    const db = getDb();
    if (!db) return null;
    try {
      const stmt = db.prepare("SELECT * FROM cycle_results ORDER BY id DESC LIMIT 1");
      const result = stmt.get() as CycleResult | undefined;
      db.close();
      return result || null;
    } catch {
      db.close();
      return null;
    }
  },

  // Get full snapshot for SSE streaming
  getSnapshot() {
    const db = getDb();
    if (!db) {
      return {
        state: null,
        specialists: [],
        activeTools: [],
        consensus: [],
        latestCycle: null,
      };
    }

    try {
      const state = db.prepare("SELECT * FROM swarm_state WHERE id = 1").get() as SwarmState | undefined;
      const specialists = db.prepare("SELECT * FROM specialists").all() as SpecialistState[];
      const activeTools = db.prepare("SELECT * FROM active_tools").all() as ActiveTool[];
      const consensus = db.prepare("SELECT * FROM consensus").all() as ConsensusRow[];
      const latestCycle = db.prepare("SELECT * FROM cycle_results ORDER BY id DESC LIMIT 1").get() as CycleResult | undefined;

      db.close();

      return {
        state: state || null,
        specialists,
        activeTools,
        consensus,
        latestCycle: latestCycle || null,
      };
    } catch {
      db.close();
      return {
        state: null,
        specialists: [],
        activeTools: [],
        consensus: [],
        latestCycle: null,
      };
    }
  },

  // Check if swarm is running (updated within last 2 minutes)
  isRunning(): boolean {
    const state = this.getState();
    if (!state) return false;
    if (state.status !== "running") return false;
    const lastUpdate = new Date(state.updated_at).getTime();
    return Date.now() - lastUpdate < 120000;
  },

  // Get PID for stopping
  getPid(): number | null {
    const state = this.getState();
    return state?.pid ?? null;
  },
};

export default swarmDbReader;
