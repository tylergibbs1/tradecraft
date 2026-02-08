/**
 * Strategy Store
 *
 * JSON persistence for evolved strategies under data/strategies/.
 * CRUD, ranking, pruning (max 50 strategies).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { StrategyRecord } from "./types.js";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data", "strategies");
const DEFAULT_INDEX_FILE = path.join(DEFAULT_DATA_DIR, "index.json");
const MAX_STRATEGIES = 100;

export class StrategyStore {
  private records: StrategyRecord[] = [];
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_INDEX_FILE;
    this.ensureDir();
    this.load();
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf-8");
        this.records = JSON.parse(data);
      }
    } catch {
      this.records = [];
    }
  }

  private save(): void {
    this.ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2));
  }

  /**
   * Add a new strategy record
   */
  add(record: StrategyRecord): void {
    this.records.push(record);
    this.prune();
    this.save();
  }

  /**
   * Update an existing record
   */
  update(id: string, updates: Partial<StrategyRecord>): StrategyRecord | null {
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    this.records[idx] = { ...this.records[idx]!, ...updates };
    this.save();
    return this.records[idx]!;
  }

  /**
   * Get a record by ID
   */
  get(id: string): StrategyRecord | null {
    return this.records.find((r) => r.id === id) ?? null;
  }

  /**
   * Get all records
   */
  getAll(): StrategyRecord[] {
    return [...this.records];
  }

  /**
   * Get top N strategies by composite score
   */
  getTopN(n: number = 10): StrategyRecord[] {
    return [...this.records]
      .filter((r) => r.score !== undefined)
      .sort((a, b) => (b.score?.composite ?? 0) - (a.score?.composite ?? 0))
      .slice(0, n);
  }

  /**
   * Get deployed strategies
   */
  getDeployed(): StrategyRecord[] {
    return this.records.filter((r) => r.status === "deployed");
  }

  /**
   * Get strategies by status
   */
  getByStatus(status: StrategyRecord["status"]): StrategyRecord[] {
    return this.records.filter((r) => r.status === status);
  }

  /**
   * Delete a record
   */
  delete(id: string): boolean {
    const len = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.records.length < len) {
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Prune to max strategies, keeping top performers and deployed
   */
  private prune(): void {
    if (this.records.length <= MAX_STRATEGIES) return;

    // Always keep deployed strategies
    const deployed = this.records.filter((r) => r.status === "deployed");
    const rest = this.records
      .filter((r) => r.status !== "deployed")
      .sort((a, b) => (b.score?.composite ?? 0) - (a.score?.composite ?? 0));

    const keepCount = MAX_STRATEGIES - deployed.length;
    this.records = [...deployed, ...rest.slice(0, Math.max(0, keepCount))];
  }

  /**
   * Get the highest generation number
   */
  getMaxGeneration(): number {
    return this.records.reduce((max, r) => Math.max(max, r.generation), 0);
  }

  /**
   * Get stats about the store
   */
  getStats(): {
    total: number;
    proposed: number;
    backtested: number;
    deployed: number;
    retired: number;
    maxGeneration: number;
    bestScore: number;
  } {
    return {
      total: this.records.length,
      proposed: this.records.filter((r) => r.status === "proposed").length,
      backtested: this.records.filter((r) => r.status === "backtested").length,
      deployed: this.records.filter((r) => r.status === "deployed").length,
      retired: this.records.filter((r) => r.status === "retired").length,
      maxGeneration: this.getMaxGeneration(),
      bestScore: this.getTopN(1)[0]?.score?.composite ?? 0,
    };
  }
}
