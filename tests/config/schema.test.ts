import { describe, expect, it } from "bun:test";
import { ConfigSchema, defaultConfig } from "../../src/config/schema.js";

describe("ConfigSchema", () => {
  it("parses the default config without errors", () => {
    const result = ConfigSchema.parse(defaultConfig);
    expect(result.dataProvider).toBe("yahoo");
    expect(result.capital.initialCapital).toBe(100000);
    expect(result.riskLimits.maxPositionSize).toBe(0.1);
  });

  it("applies defaults for missing fields", () => {
    const result = ConfigSchema.parse({});
    expect(result.dataProvider).toBe("yahoo");
    expect(result.agentMode).toBe("single");
    expect(result.tradingUniverse.symbols).toEqual(["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA"]);
  });

  it("rejects invalid risk limits", () => {
    expect(() => {
      ConfigSchema.parse({
        ...defaultConfig,
        riskLimits: { maxPositionSize: 5 }, // > 1
      });
    }).toThrow();
  });

  it("rejects invalid agent model", () => {
    expect(() => {
      ConfigSchema.parse({
        ...defaultConfig,
        agentParams: { ...defaultConfig.agentParams, model: "gpt-4" },
      });
    }).toThrow();
  });

  it("round-trips through JSON serialization", () => {
    const config = ConfigSchema.parse(defaultConfig);
    const json = JSON.stringify(config);
    const parsed = ConfigSchema.parse(JSON.parse(json));
    expect(parsed.dataProvider).toBe(config.dataProvider);
    expect(parsed.capital.initialCapital).toBe(config.capital.initialCapital);
    expect(parsed.riskLimits.maxDrawdown).toBe(config.riskLimits.maxDrawdown);
  });

  it("accepts valid overrides", () => {
    const result = ConfigSchema.parse({
      ...defaultConfig,
      dataProvider: "polygon",
      capital: { initialCapital: 50000, currency: "USD", paperTrading: false },
    });
    expect(result.dataProvider).toBe("polygon");
    expect(result.capital.initialCapital).toBe(50000);
    expect(result.capital.paperTrading).toBe(false);
  });
});
