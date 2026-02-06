import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { MemoryStore } from "../../src/memory/store.js";
import { tmpFile } from "../fixtures.js";

const TEST_FILE = tmpFile("memory");

function freshStore(): MemoryStore {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
  return new MemoryStore(TEST_FILE);
}

afterAll(() => {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
});

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = freshStore();
  });

  it("starts empty", () => {
    expect(store.getCount()).toBe(0);
    expect(store.getAll()).toHaveLength(0);
  });

  it("adds and retrieves an entry by ID", () => {
    const entry = store.add({
      type: "insight",
      content: "AAPL tends to gap up on Mondays",
      symbols: ["AAPL"],
      tags: ["pattern"],
      confidence: 0.8,
      source: "agent",
    });

    expect(entry.id).toBeDefined();
    expect(store.getCount()).toBe(1);

    const found = store.get(entry.id);
    expect(found).not.toBeNull();
    expect(found!.content).toBe("AAPL tends to gap up on Mondays");
  });

  it("deletes an entry", () => {
    const entry = store.add({
      type: "insight",
      content: "test",
      symbols: ["AAPL"],
      tags: [],
      confidence: 0.5,
      source: "agent",
    });

    expect(store.delete(entry.id)).toBe(true);
    expect(store.getCount()).toBe(0);
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("persists to disk and reloads", () => {
    store.add({
      type: "trade_lesson",
      content: "Stop losses saved me on TSLA",
      symbols: ["TSLA"],
      tags: ["risk"],
      confidence: 0.9,
      source: "agent",
    });

    // Create a new store pointing at the same file
    const reloaded = new MemoryStore(TEST_FILE);
    expect(reloaded.getCount()).toBe(1);
    expect(reloaded.getAll()[0]!.content).toBe("Stop losses saved me on TSLA");
  });

  it("queries by symbol with relevance scoring", () => {
    store.add({
      type: "insight",
      content: "AAPL bullish",
      symbols: ["AAPL"],
      tags: ["bullish"],
      confidence: 0.9,
      source: "agent",
    });
    store.add({
      type: "insight",
      content: "MSFT bearish",
      symbols: ["MSFT"],
      tags: ["bearish"],
      confidence: 0.7,
      source: "agent",
    });

    const results = store.query({ symbols: ["AAPL"], limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // AAPL entry should rank higher
    const aaplResult = results.find((r) => r.entry.symbols.includes("AAPL"));
    const msftResult = results.find((r) => r.entry.symbols.includes("MSFT"));
    if (aaplResult && msftResult) {
      expect(aaplResult.relevanceScore).toBeGreaterThan(msftResult.relevanceScore);
    }
  });

  it("queries by tag", () => {
    store.add({
      type: "insight",
      content: "test1",
      symbols: ["AAPL"],
      tags: ["earnings"],
      confidence: 0.8,
      source: "agent",
    });
    store.add({
      type: "insight",
      content: "test2",
      symbols: ["AAPL"],
      tags: ["technical"],
      confidence: 0.8,
      source: "agent",
    });

    const results = store.query({ tags: ["earnings"], limit: 10 });
    expect(results.length).toBe(2);
    // Earnings-tagged entry should score higher for tag match
    const earningsResult = results.find((r) => r.entry.tags.includes("earnings"));
    const technicalResult = results.find((r) => r.entry.tags.includes("technical"));
    if (earningsResult && technicalResult) {
      expect(earningsResult.relevanceScore).toBeGreaterThanOrEqual(technicalResult.relevanceScore);
    }
  });

  it("filters by confidence threshold", () => {
    store.add({
      type: "insight",
      content: "high conf",
      symbols: ["AAPL"],
      tags: [],
      confidence: 0.9,
      source: "agent",
    });
    store.add({
      type: "insight",
      content: "low conf",
      symbols: ["AAPL"],
      tags: [],
      confidence: 0.1,
      source: "agent",
    });

    const results = store.query({ minConfidence: 0.5 });
    expect(results.every((r) => r.entry.confidence >= 0.5)).toBe(true);
  });

  it("filters by type", () => {
    store.add({
      type: "insight",
      content: "i1",
      symbols: [],
      tags: [],
      confidence: 0.5,
      source: "agent",
    });
    store.add({
      type: "trade_lesson",
      content: "t1",
      symbols: [],
      tags: [],
      confidence: 0.5,
      source: "agent",
    });

    const results = store.query({ types: ["trade_lesson"] });
    expect(results.every((r) => r.entry.type === "trade_lesson")).toBe(true);
  });

  it("relevanceScore is capped at 1", () => {
    store.add({
      type: "insight",
      content: "AAPL earnings",
      symbols: ["AAPL"],
      tags: ["earnings"],
      confidence: 1.0,
      source: "agent",
    });

    const results = store.query({
      symbols: ["AAPL"],
      tags: ["earnings"],
      topic: "earnings",
    });
    expect(results[0]!.relevanceScore).toBeLessThanOrEqual(1);
  });

  it("buildMemoryContext returns empty string when no entries", () => {
    expect(store.buildMemoryContext(["AAPL"])).toBe("");
  });

  it("buildMemoryContext returns formatted context", () => {
    store.add({
      type: "insight",
      content: "AAPL is bullish",
      symbols: ["AAPL"],
      tags: [],
      confidence: 0.8,
      source: "agent",
    });

    const ctx = store.buildMemoryContext(["AAPL"]);
    expect(ctx).toContain("Past insights");
    expect(ctx).toContain("AAPL is bullish");
  });
});
