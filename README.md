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

### Stress Tests — 7 Market Regimes (2018-2024)

We ran the agent through every kind of market we could find — crashes, bear markets, bull runs, recoveries, and the AI hype rally. 25 weekly trading cycles per test, $100k starting capital, same 5 stocks (SPY, AAPL, MSFT, AMZN, GOOGL). Here's what happened:

| Period | What happened in the market | Agent | SPY | Agent worst dip | SPY worst dip |
|--------|----------------------------|-------|-----|-----------------|---------------|
| **2018 Q4** | Fed raised rates, market panicked | -4.2% | ~-14% | -4.2% | ~-20% |
| **2019 H1** | Steady recovery from 2018 crash | +7.3% | ~+17% | -6.0% | ~-7% |
| **2020 H1** | COVID crash, then V-shaped recovery | +1.7% | ~-3% | -10.4% | ~-34% |
| **2021 H1** | Post-vaccine euphoria, everything up | +1.6% | ~+14% | -4.0% | ~-4% |
| **2022 H1** | Inflation, rate hikes, sustained decline | -6.9% | ~-21% | -11.2% | ~-24% |
| **2023 H1** | AI hype starts, market rallies | +12.2% | ~+16% | -3.3% | ~-7% |
| **2024 H1** | AI rally continues, Magnificent 7 | +5.8% | ~+15% | -2.7% | ~-5% |

**In plain English:**

The agent's superpower is not losing money. In all 7 tests, it had smaller dips than just buying and holding SPY. During COVID, while the market dropped 34%, the agent only dropped 10% — it sold early and sat in cash. In the 2022 bear market, it lost 7% while SPY lost 21%.

The tradeoff: it's too cautious in bull markets. When stocks are ripping (2021, 2024), it only captures a fraction of the gains because it waits for multiple confirming signals before buying. It returned +1.6% in a market that went up +14%.

**The scorecard:**
- Made money in 5 out of 7 periods
- Beat SPY's return in 2 out of 7 (both were crashes — exactly when you need it)
- Beat SPY's worst drawdown in 7 out of 7 (100% — never had a bigger dip)
- Average return: +2.5% per 6-month window
- Average worst dip: -5.9%
- Total cost to run all 7 tests: ~$52 in API fees

**Bottom line:** This is a risk manager, not a stock picker. It won't double your money in a bull market, but it also won't let a crash take 30% of your portfolio. Think of it as a seatbelt — you don't notice it until the accident.

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
