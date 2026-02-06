/**
 * Memory Store
 *
 * Persistent CRUD store for cross-cycle memory with tag-based querying
 * and relevance scoring. Pruning: max 1000 entries, 30-day default TTL.
 */

import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { MemoryEntry, MemoryQuery, MemoryQueryResult } from "./types.js";

const DATA_DIR = path.join(process.cwd(), "data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const MAX_ENTRIES = 1000;
const DEFAULT_TTL_DAYS = 30;

export class MemoryStore {
  private entries: MemoryEntry[] = [];

  constructor() {
    this.ensureDir();
    this.load();
  }

  private ensureDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const data = fs.readFileSync(MEMORY_FILE, "utf-8");
        this.entries = JSON.parse(data);
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    this.ensureDir();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.entries, null, 2));
  }

  /**
   * Add a new memory entry
   */
  add(entry: Omit<MemoryEntry, "id" | "createdAt">): MemoryEntry {
    const full: MemoryEntry = {
      ...entry,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };

    // Default TTL
    if (!full.expiresAt) {
      const expires = new Date();
      expires.setDate(expires.getDate() + DEFAULT_TTL_DAYS);
      full.expiresAt = expires.toISOString();
    }

    this.entries.push(full);
    this.prune();
    this.save();
    return full;
  }

  /**
   * Get entry by ID
   */
  get(id: string): MemoryEntry | null {
    return this.entries.find(e => e.id === id) ?? null;
  }

  /**
   * Delete entry
   */
  delete(id: string): boolean {
    const len = this.entries.length;
    this.entries = this.entries.filter(e => e.id !== id);
    if (this.entries.length < len) {
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Query memories with relevance scoring
   */
  query(q: MemoryQuery): MemoryQueryResult[] {
    const now = Date.now();
    const maxAgeDays = q.maxAge ?? DEFAULT_TTL_DAYS;
    const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

    let candidates = this.entries.filter(e => {
      // Filter expired
      if (e.expiresAt && new Date(e.expiresAt).getTime() < now) return false;
      // Filter by age
      if (new Date(e.createdAt).getTime() < cutoff) return false;
      // Filter by confidence
      if (q.minConfidence && e.confidence < q.minConfidence) return false;
      // Filter by type
      if (q.types && q.types.length > 0 && !q.types.includes(e.type)) return false;
      return true;
    });

    // Score each candidate
    const results: MemoryQueryResult[] = candidates.map(entry => {
      let score = 0;

      // Symbol match: 0.4 weight
      if (q.symbols && q.symbols.length > 0) {
        const symbolOverlap = entry.symbols.filter(s => q.symbols!.includes(s)).length;
        const symbolScore = q.symbols.length > 0 ? symbolOverlap / q.symbols.length : 0;
        score += symbolScore * 0.4;
      } else {
        score += 0.2; // Partial credit for non-symbol-specific query
      }

      // Tag match: 0.3 weight
      if (q.tags && q.tags.length > 0) {
        const tagOverlap = entry.tags.filter(t => q.tags!.includes(t)).length;
        const tagScore = q.tags.length > 0 ? tagOverlap / q.tags.length : 0;
        score += tagScore * 0.3;
      } else {
        score += 0.15;
      }

      // Recency: 0.2 weight (newer = higher)
      const ageDays = (now - new Date(entry.createdAt).getTime()) / (24 * 60 * 60 * 1000);
      const recencyScore = Math.max(0, 1 - ageDays / maxAgeDays);
      score += recencyScore * 0.2;

      // Confidence: 0.1 weight
      score += entry.confidence * 0.1;

      // Topic match: bonus if topic substring appears in content
      if (q.topic) {
        const topicLower = q.topic.toLowerCase();
        if (entry.content.toLowerCase().includes(topicLower)) {
          score += 0.2; // Bonus for topic match
        }
      }

      return { entry, relevanceScore: Math.min(1, score) };
    });

    // Sort by relevance and limit
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, q.limit ?? 20);
  }

  /**
   * Build a context string for inclusion in the agent's prompt
   */
  buildMemoryContext(symbols: string[], maxEntries: number = 10): string {
    const results = this.query({
      symbols,
      limit: maxEntries,
      minConfidence: 0.3,
    });

    if (results.length === 0) return "";

    const lines = results.map(r => {
      const age = Math.round(
        (Date.now() - new Date(r.entry.createdAt).getTime()) / (24 * 60 * 60 * 1000)
      );
      return `[${r.entry.type}] (${age}d ago, conf: ${r.entry.confidence.toFixed(1)}) ${r.entry.symbols.join(",")}: ${r.entry.content}`;
    });

    return `Past insights relevant to current trading universe:\n${lines.join("\n")}`;
  }

  /**
   * Prune entries beyond max capacity
   */
  private prune(): void {
    const now = Date.now();

    // Remove expired entries first
    this.entries = this.entries.filter(e => {
      if (e.expiresAt && new Date(e.expiresAt).getTime() < now) return false;
      return true;
    });

    // If still over limit, remove oldest low-confidence entries
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.sort((a, b) => {
        // Keep high-confidence entries longer
        const scoreA = a.confidence + (1 - (now - new Date(a.createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000));
        const scoreB = b.confidence + (1 - (now - new Date(b.createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000));
        return scoreB - scoreA;
      });
      this.entries = this.entries.slice(0, MAX_ENTRIES);
    }
  }

  /**
   * Get count of entries
   */
  getCount(): number {
    return this.entries.length;
  }

  /**
   * Get all entries (for testing)
   */
  getAll(): MemoryEntry[] {
    return [...this.entries];
  }
}
