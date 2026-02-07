# Tradecraft

AI-native trading system that invents, evolves, and executes trading strategies autonomously. Claude agents trade within hard risk limits enforced at the infrastructure level — not by prompts.

## Quick Start

```bash
bun install
bun run setup                    # API keys, symbols, risk limits
bun run cli cycle                # run one trading cycle
bun run cli status               # portfolio overview
```

## Commands

```bash
# Trading
bun run cli cycle                # single trading cycle
bun run cli start                # continuous trading
bun run cli status               # portfolio + positions
bun run cli quotes               # live prices
bun run cli history              # trade log
bun run cli risk                 # risk limits + circuit breaker
bun run cli order buy AAPL 10    # manual order
bun run cli reset                # reset portfolio

# Backtesting
bun run backtest sma-crossover --start 2024-01-01
bun run agent-backtest                              # Claude agent on historical data (~$1.50)
bun run agent-backtest --frequency 1                # daily cycles (~$25/year)

# Stress Tests
bun run scripts/stress-test.ts                                      # March 2020 COVID crash
bun run scripts/stress-test.ts --start=2022-01-03 --end=2022-06-30  # 2022 bear market

# Research
bun run scripts/benchmark.ts     # evolution benchmark + fitness curves
bun run tournament               # multi-model tournament (~$5-20)
bun run allocation-demo          # capital allocation vs heuristics (~$0.10)

# Dev
bun test                         # 119 tests, ~50ms
bun run typecheck
bun lint
```

## Requirements

- [Bun](https://bun.sh)
- `ANTHROPIC_API_KEY`
- `POLYGON_API_KEY` (optional — enables real-time quotes, news, technicals)

Keys go in `.env` or `~/.config/tradecraft/config.toml`.

## How It Works

The agent gets a portfolio snapshot, market data, and technical indicators each cycle. It decides to buy, sell, or hold. Every order passes through infrastructure-level risk validation before execution:

```
Agent: "Buy $50,000 of NVDA"  →  System: REJECTED (exceeds $10k max order)
Agent: "Buy $9,000 instead"   →  System: EXECUTED
```

Risk limits (position size, daily loss, drawdown) are enforced by code, not instructions. The circuit breaker halts all trading when triggered.

### Tools

The agent has access to 30+ tools across trading, research, strategy evolution, memory, journaling, regime detection, and capital allocation. Key ones:

| Category | Tools |
|----------|-------|
| **Trading** | `place_order`, `get_portfolio`, `get_market_data`, `get_risk_status` |
| **Research** | `get_technical_indicators`, `get_polygon_news`, `get_financials`, `get_filing` |
| **Evolution** | `propose_strategy`, `backtest_strategy`, `evolve_strategy`, `deploy_strategy` |
| **Memory** | `record_insight`, `query_memories`, `get_attribution`, `get_agent_performance` |
| **Journal** | `record_enhanced_decision`, `generate_bias_report`, `query_decision_patterns` |
| **Regime** | `get_regime`, `get_adaptation_metrics` |
| **Allocation** | `evaluate_projects`, `submit_allocation`, `compare_allocation_heuristics` |

### Strategy Evolution

Strategies are expressed as JSON DSL with indicators, entry/exit conditions, and sizing rules. The evolution engine mutates parameters, backtests children against real market data, and selects survivors. After 5 generations:

| Strategy | Return | Sharpe | Win Rate |
|----------|--------|--------|----------|
| SMA 10/50 Crossover | +8.05% | 1.64 | 71.4% |
| RSI Oversold Bounce | +1.62% | 0.89 | 66.7% |
| EMA 12/26 Momentum (evolved) | **+12.61%** | **1.88** | 83.3% |

### Agent Backtest Results

Historical performance (2024, weekly cycles, AAPL/GOOGL/MSFT/AMZN/NVDA):

| Period | Return | S&P 500 | Sharpe | Max DD | Cost |
|--------|--------|---------|--------|--------|------|
| H1 2024 | +21.93% | ~15% | 8.43 | 3.47% | $2.48 |
| H2 2024 | +2.19% | ~8% | 1.14 | 9.19% | $2.48 |
| Full 2024 | +28.26% | ~24% | 4.46 | 9.73% | $4.92 |

### Stress Tests

| Test | Agent Return | SPY Buy-Hold | Agent Max DD | SPY Max DD |
|------|-------------|-------------|-------------|-----------|
| **March 2020** (COVID crash) | +6.45% | -3.1% | 4.71% | 33.9% |
| **2022 H1** (bear market) | -5.22% | -20.6% | 5.78% | 23.6% |

March 2020: Agent sold into the crash (4 sells, 0 buys), sat in cash through the bottom, re-entered April. 7x less drawdown than SPY.

2022 H1: Agent got caught in the March relief rally (bought the bounce, lost money), but cut losses systematically. Still 75% less loss than passive. 0% win rate on trades — the edge came from cash management, not stock picking.

### Decision Journal & Bias Tracking

Every decision is recorded with cognitive bias analysis, counterfactual reasoning, and market conditions. The `generate_bias_report` tool compares agent avoidance rates against published human base rates (Kahneman & Tversky 1979, Barber & Odean 2001, etc.).

Pattern queries find specific behavioral patterns: `sold_into_rally`, `bought_the_dip`, `high_confidence_wrong`, `bias_saved_money`.

### Multi-Model Tournament

Runs Opus, Sonnet, and Haiku on identical scenarios. If the cheapest model still beats active managers, the edge is structural (forced discipline, bias awareness) — not raw model capability.

### Capital Allocation

Demonstrates LLM allocation beyond trading. Agent allocates $10M across 12 oversubscribed projects and is scored against four heuristic baselines (equal weight, highest IRR first, lowest risk first, risk parity).

## Configuration

```toml
# ~/.config/tradecraft/config.toml
dataProvider = "polygon"       # or "yahoo" (free)
dataProviderApiKey = "..."

[agentParams]
model = "claude-sonnet-4-5-20250929"
maxTurns = 10

[tradingUniverse]
symbols = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA"]
allowShorts = false

[riskLimits]
maxPositionSize = 0.1         # 10% max per position
maxPositionCount = 10
dailyLossLimit = 0.02         # 2% daily stop
weeklyLossLimit = 0.05        # 5% weekly stop
maxDrawdown = 0.1             # 10% circuit breaker
maxOrderValue = 10000

[capital]
initialCapital = 100000
paperTrading = true
```

## Project Structure

```
src/
  agent/          Trading agent, tools, prompts, permissions
  allocation/     Capital allocation engine + heuristic baselines
  attribution/    Trade-to-signal P&L attribution
  backtest/       Rule-based + agent backtester, benchmarks, indicators
  config/         TOML config + Zod schemas
  data/           Market data (Yahoo, Polygon, EDGAR, Exa)
  evolution/      Strategy DSL, mutation, scoring, persistence
  journal/        Decision journal, bias reporting, pattern queries
  memory/         Cross-cycle memory store
  portfolio/      Position management + order lifecycle
  regime/         Market regime detection + adaptation tracking
  risk/           Risk monitor + circuit breaker
  ui/             Terminal UI (Ink/React)
scripts/
  benchmark.ts       Evolution benchmark + fitness curves
  tournament.ts      Multi-model comparison
  allocation-demo.ts Capital allocation demo
  stress-test.ts     Historical stress testing
tests/               119 tests across 12 files
```

## Limitations

- **Backtest != live performance.** No order book dynamics, realistic slippage, or market impact modeling.
- **Narrow universe.** US large-cap equities only. No bonds, commodities, crypto, international.
- **Anti-churning is prompt-based.** The 5-day hold period and 2-signal requirement are instructions, not hard constraints.
- **Limited evolution depth.** 5 generations of 8 mutations explores local neighborhoods, not the full parameter space.
- **Adaptation speed comparisons are approximate.** Published manager data (Busse et al. 2010, Ben-David et al. 2012) are averages across different methodologies.
- **Capital allocation uses fixed IRR estimates.** Real projects have uncertain, dynamic returns.

## License

MIT

## Disclaimer

Paper trading system for research purposes. Not financial advice. Past performance does not guarantee future results.
