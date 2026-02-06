/**
 * Memory Agent Tools
 *
 * Tools for recording and querying cross-cycle memories.
 */

import { z } from "zod";
import { MemoryStore } from "./store.js";
import { MemoryEntry } from "./types.js";

const RecordInsightSchema = z.object({
  type: z.enum(["insight", "strategy_learning", "trade_lesson", "market_observation", "regime_change"])
    .describe("Type of insight"),
  content: z.string().min(1).max(2000).describe("The insight content"),
  symbols: z.array(z.string()).default([]).describe("Related stock symbols"),
  tags: z.array(z.string()).default([]).describe("Tags for categorization (e.g., 'technical', 'earnings', 'sector-rotation')"),
  confidence: z.number().min(0).max(1).default(0.7).describe("Confidence in this insight (0-1)"),
});

const QueryMemoriesSchema = z.object({
  symbols: z.array(z.string()).optional().describe("Filter by symbols"),
  tags: z.array(z.string()).optional().describe("Filter by tags"),
  types: z.array(z.enum(["insight", "strategy_learning", "trade_lesson", "market_observation", "regime_change"])).optional()
    .describe("Filter by entry type"),
  topic: z.string().optional().describe("Free-text search in content"),
  limit: z.number().int().min(1).max(50).optional().describe("Max results (default: 10)"),
});

export function createMemoryTools(deps: { memoryStore: MemoryStore }) {
  const { memoryStore } = deps;

  return {
    record_insight: {
      description: "Record a market insight, strategy learning, or trade lesson for future reference across cycles. This builds persistent knowledge.",
      inputSchema: RecordInsightSchema,
      handler: async (input: z.infer<typeof RecordInsightSchema>) => {
        const entry = memoryStore.add({
          type: input.type,
          content: input.content,
          symbols: input.symbols,
          tags: input.tags,
          confidence: input.confidence,
          source: "agent",
        });
        return {
          success: true,
          entryId: entry.id,
          message: `Insight recorded: "${input.content.slice(0, 80)}..."`,
          totalMemories: memoryStore.getCount(),
        };
      },
    },

    query_memories: {
      description: "Search past insights and learnings by symbol, tags, type, or free-text topic. Returns relevant memories ranked by relevance.",
      inputSchema: QueryMemoriesSchema,
      handler: async (input: z.infer<typeof QueryMemoriesSchema>) => {
        const results = memoryStore.query({
          symbols: input.symbols,
          tags: input.tags,
          types: input.types,
          topic: input.topic,
          limit: input.limit ?? 10,
        });

        return {
          success: true,
          count: results.length,
          memories: results.map(r => ({
            id: r.entry.id,
            type: r.entry.type,
            content: r.entry.content,
            symbols: r.entry.symbols,
            tags: r.entry.tags,
            confidence: r.entry.confidence,
            relevance: r.relevanceScore,
            age: `${Math.round((Date.now() - new Date(r.entry.createdAt).getTime()) / (24 * 60 * 60 * 1000))} days`,
          })),
        };
      },
    },
  };
}

export { RecordInsightSchema, QueryMemoriesSchema };
