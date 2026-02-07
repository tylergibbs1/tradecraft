# Tradecraft

An AI-native trading system powered by Claude. A swarm of AI agents invents, backtests, and evolves novel trading strategies autonomously, then executes trades within hard risk limits enforced at the infrastructure level.

```
╔════════════════════════════════════════════════════════════╗
║                    PORTFOLIO STATUS                        ║
╚════════════════════════════════════════════════════════════╝

Summary:
──────────────────────────────────────────────────
  Cash:        $55,645.36
  Equity:      $99,987.07
  Daily P&L:   -$1.14

Positions:
──────────────────────────────────────────────────
  Symbol   Qty      Avg Cost    Current     Value        P&L
  GOOGL      26     $343.92     $343.40   $8,928.40     -$13.52
  AMZN       37     $242.87     $242.79   $8,983.23      -$2.96
  AAPL       30     $268.95     $269.29   $8,078.70      $10.20
  NVDA       53     $186.13     $186.14   $9,865.58       $0.69
  MSFT       20     $424.60     $424.29   $8,485.80      -$6.20
```

## Features

- **Autonomous Trading**: Claude analyzes markets and executes trades independently
- **Strategy Evolution**: AI invents strategies as JSON DSL, backtests them, evolves winners via genetic mutation
- **Multi-Agent Swarm**: Specialist agents (technical, fundamental, macro, sentiment) collaborate via signal bus with performance-weighted voting
- **Cross-Cycle Memory**: Persistent memory accumulates market insights across trading cycles
- **Performance Attribution**: Tracks which agents/signals drive returns and auto-tunes weights
- **Risk Management**: Hard limits on position size, daily loss, drawdown. Enforced by system, not prompts
- **Paper Trading**: Safe simulation with real market data from Polygon.io or Yahoo Finance
- **CLI Interface**: Non-interactive commands for easy automation
- **Agent Backtesting**: Test the actual Claude agent on historical data
- **Full Audit Trail**: Every decision logged for review

## Quick Start

```bash
# Install dependencies
bun install

# Configure (set API keys, trading universe, risk limits)
bun run setup

# Check portfolio
bun run cli status

# Run a trading cycle
bun run cli cycle

# View trades
bun run cli history
```

## Requirements

- [Bun](https://bun.sh) runtime
- Anthropic API key
- Internet connection (for market data)
- Polygon.io API key (optional, enables real-time quotes, news sentiment, technical indicators, and company data)

## Installation

```bash
git clone https://github.com/tylergibbs1/tradecraft.git
cd tradecraft
bun install
```

## Configuration

Run the setup wizard:

```bash
bun run setup
```

Or manually edit `~/.config/tradecraft/config.toml`:

```toml
dataProvider = "polygon"  # or "yahoo" (free, no key needed)
dataProviderApiKey = "your-polygon-key"

[agentParams]
model = "claude-sonnet-4-5-20250929"
maxTurns = 10
cycleIntervalMs = 60000

[tradingUniverse]
symbols = ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA"]
allowShorts = false

[riskLimits]
maxPositionSize = 0.1      # 10% max per position
maxPositionCount = 10
dailyLossLimit = 0.02      # 2% daily stop
weeklyLossLimit = 0.05     # 5% weekly stop
maxDrawdown = 0.1          # 10% circuit breaker
maxOrderValue = 10000      # $10k max order

[capital]
initialCapital = 100000
paperTrading = true

agentMode = "single"  # or "swarm" for multi-agent mode

[swarmParams]
specialistModel = "claude-sonnet-4-5-20250929"
parallelSpecialists = true
minConsensusConfidence = 0.5
```

You can also set API keys via environment variables (`ANTHROPIC_API_KEY`, `POLYGON_API_KEY`) or a `.env` file.

## CLI Commands

| Command | Description |
|---------|-------------|
| `bun run cli status` | Portfolio overview with positions |
| `bun run cli quotes` | Real-time prices for trading universe |
| `bun run cli cycle` | Run single trading cycle |
| `bun run cli start` | Run continuous trading cycles |
| `bun run cli history` | View trade history |
| `bun run cli risk` | Check risk limits and circuit breaker |
| `bun run cli order <side> <symbol> <qty>` | Manual order |
| `bun run cli reset` | Reset portfolio to initial state |

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           CLI / TUI                              │
│                     bun run cli <command>                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│   TradingAgent (single)   │ │  SwarmTradingAgent (swarm) │
│                           │ │                           │
│ • Claude analyzes markets │ │ • Specialist agents vote  │
│ • Calls tools directly    │ │ • Signal bus aggregation  │
│ • Makes trade decisions   │ │ • Consensus trading       │
└───────────────────────────┘ └───────────────────────────┘
                    │                       │
                    └───────────┬───────────┘
        ┌───────────┬──────────┼──────────┬───────────┐
        ▼           ▼          ▼          ▼           ▼
┌────────────┐┌──────────┐┌────────┐┌──────────┐┌──────────┐
│ Portfolio  ││   Data   ││  Risk  ││Evolution ││  Memory  │
│ Manager    ││ Manager  ││Monitor ││ Engine   ││  Store   │
│            ││          ││        ││          ││          │
│• Positions ││• Polygon ││• Limits││• DSL     ││• Insights│
│• Orders    ││• Yahoo   ││• Break ││• Mutate  ││• Query   │
│• P&L       ││• Cache   ││        ││• Score   ││• Attrib. │
└────────────┘└──────────┘└────────┘└──────────┘└──────────┘
```

### Trading Cycle Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. START CYCLE                                                  │
│     CLI calls TradingAgent.runCycle()                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. BUILD CONTEXT                                                │
│     • Load portfolio state (cash, positions, P&L)               │
│     • Check risk status (circuit breaker, limits)               │
│     • Build system prompt with trading persona                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. CLAUDE ANALYZES                                              │
│     Agent receives prompt and calls tools:                       │
│     ┌─────────────────┐  ┌─────────────────┐                    │
│     │ get_risk_status │  │ get_market_data │  (parallel)        │
│     └─────────────────┘  └─────────────────┘                    │
│     Then analyzes: prices, trends, portfolio weights, risk      │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. TRADING DECISION                                             │
│     Claude decides: BUY, SELL, or HOLD                          │
│     • Considers position sizing (max 10% per stock)             │
│     • Checks available cash                                      │
│     • Evaluates risk/reward                                      │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            ┌─────────────┐         ┌─────────────┐
            │    HOLD     │         │ TRADE       │
            │  No action  │         │ place_order │
            └─────────────┘         └─────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. RISK VALIDATION (Infrastructure-Level)                       │
│     System checks BEFORE executing:                              │
│     □ Position size ≤ 10% of portfolio?                         │
│     □ Order value ≤ $10,000?                                    │
│     □ Daily loss < 2%?                                          │
│     □ Circuit breaker closed?                                   │
│                                                                  │
│     ✓ PASS → Execute order                                      │
│     ✗ FAIL → Reject with error message                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. EXECUTION & LOGGING                                          │
│     • Update portfolio state                                     │
│     • Record trade in journal                                    │
│     • Log for audit trail                                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. CYCLE COMPLETE                                               │
│     Report: turns, tokens, cost, orders placed                  │
└─────────────────────────────────────────────────────────────────┘
```

### Available Tools

| Tool | Purpose |
|------|---------|
| `get_risk_status` | Check if trading is allowed, view limits |
| `get_market_data` | Fetch current prices and optional history |
| `get_portfolio` | View positions, cash, equity, P&L |
| `place_order` | Execute a buy/sell order |
| `cancel_order` | Cancel a pending order |
| `get_technical_indicators` | SMA, EMA, RSI, MACD (Polygon) |
| `get_sma` | Simple moving average with configurable window (Polygon) |
| `get_polygon_news` | News with AI sentiment analysis (Polygon) |
| `get_company_info` | Company details, market cap, employees (Polygon) |
| `search_tickers` | Search stocks by name or filter (Polygon) |
| `get_filing` | SEC EDGAR filings (10-K, 10-Q, etc.) |
| `get_financials` | Financial statements from SEC filings |
| `get_news` | General financial news search |
| `exa_search` / `exa_financial_search` | AI-powered web search (Exa) |
| `propose_strategy` | Propose a new strategy as JSON DSL |
| `backtest_strategy` | Backtest a strategy against historical data |
| `evolve_strategy` | Evolve a strategy through genetic mutation |
| `deploy_strategy` | Deploy a top-performing strategy |
| `record_insight` | Save a market insight to cross-cycle memory |
| `query_memories` | Query accumulated market insights |
| `get_attribution` | View trade-to-signal P&L attribution |
| `get_agent_performance` | View per-agent accuracy and weight adjustments |
| `record_enhanced_decision` | Record decision with bias analysis and counterfactual |
| `query_decisions` | Query past decisions by symbol, bias, outcome |
| `generate_bias_report` | Aggregated bias avoidance report vs human base rates |
| `query_decision_patterns` | Find patterns: sold_into_rally, bought_the_dip, etc. |
| `get_regime` | Classify current market regime for symbols |
| `get_adaptation_metrics` | Track adaptation speed vs published manager data |
| `evaluate_projects` | View capital allocation projects and constraints |
| `submit_allocation` | Submit allocation, compare vs 4 heuristic baselines |
| `compare_allocation_heuristics` | View heuristic baseline allocations |

### Key Design Principle

**Risk limits are enforced at the infrastructure level, not by prompts.**

Even if Claude decides to make a risky trade, the system will reject it:

```
Claude: "I'll buy $50,000 of NVDA"
        ↓
System: ❌ REJECTED - exceeds maxOrderValue ($10,000)
        ↓
Claude: "Order rejected. I'll buy $9,000 instead."
        ↓
System: ✓ EXECUTED
```

This separation ensures safety even if the agent makes mistakes or receives adversarial prompts.

## Backtesting

### Rule-Based Strategies

Test predefined algorithmic strategies:

```bash
# Available: sma-crossover, rsi-mean-reversion, momentum
bun run backtest sma-crossover --start 2024-01-01
bun run backtest momentum --symbols AAPL,NVDA,TSLA
```

### Agent Backtest

Test the actual Claude agent on historical data:

```bash
# Default: 3 months, weekly cycles (~$1.50)
bun run agent-backtest

# Custom period
bun run agent-backtest --start 2024-06-01 --end 2024-12-31

# Daily cycles (more realistic, ~$25-50/year)
bun run agent-backtest --frequency 1

# Skip confirmation
bun run agent-backtest -y
```

**Cost estimates:**

| Period | Frequency | Estimated Cost |
|--------|-----------|----------------|
| 1 month | Weekly | ~$0.50 |
| 3 months | Weekly | ~$1.50 |
| 1 year | Weekly | ~$5 |
| 1 year | Daily | ~$25-50 |

### Backtest Results

Agent performance on historical data (2024, weekly cycles, AAPL/GOOGL/MSFT/AMZN/NVDA):

| Period | Return | S&P 500 | Win Rate | Sharpe | Max Drawdown | API Cost |
|--------|--------|---------|----------|--------|--------------|----------|
| H1 2024 | **+21.93%** | ~15% | 73.9% | 8.43 | 3.47% | $2.48 |
| H2 2024 | **+2.19%** | ~8% | 57.1% | 1.14 | 9.19% | $2.48 |
| Full 2024 | **+28.26%** | ~24% | 87.8% | 4.46 | 9.73% | $4.92 |

### Strategy Evolution Benchmark

End-to-end benchmark with real Polygon.io data (AAPL/GOOGL/MSFT, Jan–Dec 2024, $100k capital). The evolution engine invents strategies as JSON, backtests against real prices, and evolves winners through genetic mutation.

**Base strategies (Generation 0):**

| Strategy | Return | Sharpe | Win Rate | Max Drawdown | Trades |
|----------|--------|--------|----------|--------------|--------|
| SMA 10/50 Crossover | +8.05% | 1.64 | 71.4% | 2.11% | 16 |
| RSI Oversold Bounce | +1.62% | 0.89 | 66.7% | 1.71% | 6 |
| EMA 12/26 Momentum | +10.59% | 1.77 | 83.3% | 2.73% | 14 |

**After 5 generations of evolution (8 mutations + 1 crossover per generation):**

| Champion | Return | Sharpe | Win Rate | Max Drawdown | Profit Factor |
|----------|--------|--------|----------|--------------|---------------|
| EMA 12/26 Momentum (evolved) | **+12.61%** | **1.88** | 83.3% | 2.41% | 12.35 |

**Performance attribution (real trade P&L):**

| Agent | Trades | Accuracy | Attributed P&L |
|-------|--------|----------|----------------|
| ema-momentum | 12 | 83% | $17,573 |
| sma-crossover | 14 | 71% | $14,326 |
| rsi-reversal | 6 | 67% | $3,238 |

All numbers are from real backtests against real Polygon.io market data. No synthetic or mocked data.

```bash
# Run the benchmark yourself
bun run scripts/benchmark.ts
```

*Note: Backtests have inherent limitations. Past performance does not guarantee future results.*

### Decision Journal & Bias Avoidance

The agent records every trading decision with cognitive bias analysis, counterfactual reasoning, and market conditions. After positions close, outcomes are auto-annotated for retrospective analysis.

**Bias avoidance reporting** compares agent performance against published human base rates from behavioral finance literature (Kahneman & Tversky 1979, Barber & Odean 2001, etc.). The `generate_bias_report` tool produces per-bias statistics including avoidance rate, P&L when avoided vs not, and comparison to human fall rates.

**Pattern queries** find behavioral patterns like "sold into a rally", "bought the dip", "high confidence correct/wrong", and "bias saved money".

### Multi-Model Tournament

Compare multiple Claude models on identical backtest scenarios to answer: "Do LLMs as a class outperform active allocators?"

```bash
# Run tournament (requires ANTHROPIC_API_KEY, ~$5-20)
bun run tournament

# Custom duration
bun run tournament --months=6 --frequency=1
```

Runs Opus 4.6, Sonnet 4.5, and Haiku 4.5 sequentially on the same symbols, dates, and risk limits. Outputs a ranked table, "LLMs as a Class" summary comparing average performance against HFRI and mutual fund benchmarks, and an ASCII equity curve overlay.

### Corporate Capital Allocation

Demonstrates that LLM allocation outperforms simple heuristics outside of trading. The agent allocates a $10M budget across 12 projects (Tech, Operations, Marketing, R&D, Infrastructure) that are 1.8x oversubscribed.

```bash
# Run allocation demo (requires ANTHROPIC_API_KEY, ~$0.10)
bun run allocation-demo
```

The system compares the agent's allocation against four baselines:
- **Equal weight** — budget / N per project
- **Highest IRR first** — greedy fill by descending IRR
- **Lowest risk first** — greedy fill by ascending risk
- **Risk parity** — inversely proportional to risk score

### Regime Detection & Adaptation Speed

The agent classifies market regimes (bull/bear trend, high/low volatility, mean reverting, trending) and tracks how quickly it adapts to regime changes.

Adaptation speed is compared against published academic data:
- Active Mutual Funds: 60-90 cycles (Busse, Goyal & Wahal 2010)
- Hedge Funds: 20-40 cycles (Ben-David, Franzoni & Moussawi 2012)
- CTAs/Trend Followers: 5-15 cycles (Hurst, Ooi & Pedersen 2017)

*Note: Published adaptation speed comparisons use approximate averages from academic literature. Exact numbers vary by study methodology and time period.*

## Limitations and Honest Assessment

This project is a research prototype, not a production trading system. Key limitations:

- **Single year of backtesting (2024 bull market).** Results reflect a favorable market environment with survivorship bias in the stock universe (AAPL, GOOGL, MSFT, AMZN, NVDA are all large-cap winners). Performance in bear markets, sideways markets, or with small-cap stocks is untested.
- **No black swan / flash crash testing.** The backtest engine uses daily bars with fixed slippage. It does not model liquidity crises, gap downs, halted trading, or extreme volatility events where real losses would be far worse.
- **Equity-only, US large-cap.** No bonds, commodities, crypto, or international markets. The thesis ("LLMs beat active allocators") is only tested against a narrow slice of the investable universe.
- **Prompt-based anti-churning, not code-enforced.** The 5-day hold period and 2-signal requirement are instructions in the system prompt. The agent can (and sometimes does) override them. A production system would enforce these as hard constraints.
- **Limited evolution search depth.** Even with 5 generations of 8 mutations, the search space is tiny compared to the universe of possible strategies. The evolution engine explores local neighborhoods of the initial strategies, not the full parameter space.
- **No live trading track record.** All results are from backtests with a simplified execution model (instant fills, fixed slippage, no market impact). Live trading introduces latency, partial fills, slippage variation, and data feed issues that can significantly degrade performance.
- **Backtest != live performance.** The backtest engine does not model realistic order book dynamics, bid-ask spreads for illiquid periods, or the market impact of the agent's own trades.
- **Adaptation speed comparisons are approximate.** Published manager repositioning speeds (Busse et al. 2010, Ben-David et al. 2012, Hurst et al. 2017) are averages across different methodologies, time periods, and market conditions. Direct comparison with agent cycle counts is directionally useful but not exact.
- **Capital allocation demo uses estimated IRRs.** The corporate allocation demo projects have fixed estimated IRRs. Real capital allocation involves uncertain, dynamic IRR estimates and complex interdependencies between projects.

## Project Structure

```
tradecraft/
├── src/
│   ├── agent/              # Trading agent and tools
│   │   ├── index.ts        # TradingAgent class
│   │   ├── mcp-server.ts   # Tool definitions (orders, data, risk, evolution, memory)
│   │   ├── permissions.ts  # canUseTool risk validation
│   │   ├── hooks.ts        # Pre/post tool hooks for audit logging
│   │   ├── prompts.ts      # System and cycle prompts
│   │   ├── types.ts        # ITradingAgent interface
│   │   └── swarm-adapter.ts # SwarmTradingAgent adapter for multi-agent mode
│   ├── agents/             # Multi-agent specialist system
│   │   ├── specialists/    # Technical, fundamental, macro, sentiment, hypothesis agents
│   │   ├── portfolio-manager.ts
│   │   └── signal-bus.ts
│   ├── attribution/        # Performance attribution engine
│   │   ├── engine.ts       # P&L distribution, rolling accuracy, weight adjustment
│   │   ├── tools.ts        # Agent tools: get_attribution, get_agent_performance
│   │   └── types.ts        # TradeAttribution, AgentPerformance, WeightAdjustment
│   ├── allocation/          # Corporate capital allocation
│   │   ├── types.ts        # Project, AllocationDecision, constraints
│   │   ├── heuristics.ts   # 4 baseline strategies (equal, IRR, risk, parity)
│   │   ├── engine.ts       # Validation + heuristic comparison
│   │   ├── tools.ts        # Agent tools: evaluate, allocate, compare
│   │   └── index.ts        # Module exports
│   ├── backtest/           # Backtesting engines
│   │   ├── engine.ts       # Rule-based backtester
│   │   ├── agent-engine.ts # Claude agent backtester
│   │   ├── benchmarks.ts   # SPY, AGG, QQQ, ARKK + HFRI benchmarks
│   │   ├── tournament-types.ts # Multi-model tournament types
│   │   ├── indicators.ts   # SMA, EMA, RSI, MACD, ATR, Bollinger Bands
│   │   └── strategies.ts   # SMA crossover, RSI mean reversion, momentum
│   ├── config/             # TOML config reader/writer + Zod schemas
│   ├── data/               # Market data layer
│   │   ├── types.ts        # OHLCV, Quote, TimeFrame, DataProviderInterface
│   │   ├── cache.ts        # In-memory cache with TTL
│   │   ├── index.ts        # DataManager (provider routing + caching)
│   │   └── providers/
│   │       ├── yahoo.ts    # Yahoo Finance (free, no API key)
│   │       ├── polygon/    # Polygon.io (quotes, news, indicators, tickers)
│   │       ├── edgar.ts    # SEC EDGAR filings
│   │       ├── exa.ts      # Exa AI search
│   │       └── news.ts     # Financial news
│   ├── evolution/          # Strategy evolution engine
│   │   ├── types.ts        # StrategySpec DSL, MutationType, StrategyRecord
│   │   ├── compiler.ts     # Compile StrategySpec JSON → executable Strategy
│   │   ├── scoring.ts      # Composite fitness (Sharpe, return, drawdown, win rate)
│   │   ├── engine.ts       # Mutation + crossover operators
│   │   ├── store.ts        # Strategy persistence, ranking, pruning
│   │   └── tools.ts        # Agent tools: propose/backtest/evolve/deploy strategy
│   ├── memory/             # Cross-cycle memory
│   │   ├── store.ts        # CRUD, tag-based query, relevance scoring, pruning
│   │   └── types.ts        # MemoryEntry, MemoryQuery
│   ├── portfolio/          # Position management + order lifecycle
│   ├── risk/               # Risk monitor + circuit breaker state machine
│   ├── journal/            # Trade logging + decision journal
│   │   ├── index.ts        # JSONL read/write, annotation
│   │   ├── tools.ts        # Bias report, pattern queries, enhanced decisions
│   │   └── types.ts        # BiasReport, DecisionPatternMatch, etc.
│   ├── setup/              # Interactive setup wizard (Ink/React)
│   ├── ui/                 # TUI app with tabs (Portfolio, Trades, Journal, Agent Log)
│   ├── main.tsx            # TUI entry point
│   └── cli.ts              # CLI entry point
│   ├── regime/             # Market regime detection
│   │   ├── detector.ts     # RegimeDetector with adaptation speed comparison
│   │   ├── tools.ts        # Agent tools: get_regime, get_adaptation_metrics
│   │   └── types.ts        # MarketRegime, AdaptationComparison
├── scripts/                # Benchmark and test scripts
│   ├── benchmark.ts        # E2E benchmark: evolution + fitness curves + benchmarks
│   ├── tournament.ts       # Multi-model tournament (Opus/Sonnet/Haiku)
│   └── allocation-demo.ts  # Corporate capital allocation demo
├── data/                   # Persisted state (portfolio, strategies, memory, attribution)
├── logs/                   # Audit logs, agent logs, trade journal
├── AGENT_GUIDE.md          # Guide for AI agents
└── README.md
```

## Risk Limits

| Limit | Default | Description |
|-------|---------|-------------|
| Max Position Size | 10% | Maximum % of portfolio in one position |
| Max Position Count | 10 | Maximum number of positions |
| Daily Loss Limit | 2% | Stop trading if daily loss exceeds |
| Weekly Loss Limit | 5% | Stop trading if weekly loss exceeds |
| Max Drawdown | 10% | Circuit breaker triggers at this drawdown |
| Max Order Value | $10,000 | Maximum value per order |

When limits are breached, the circuit breaker activates and blocks all trading until reset.

## API Costs

Each trading cycle costs approximately **$0.08-0.15** depending on complexity:

- Simple hold decision: ~$0.08 (8-10k tokens)
- Multiple trades: ~$0.15-0.20 (15-20k tokens)

For continuous trading at 1-minute intervals, expect ~$100-200/day. Weekly cycles are more economical for testing.

## For AI Agents

See [AGENT_GUIDE.md](./AGENT_GUIDE.md) for a comprehensive guide on operating this system, including:
- All CLI commands with examples
- Tool descriptions and usage
- Troubleshooting common issues
- Architecture details

## Development

```bash
# Type checking
bun run typecheck

# Test API connections
bun run src/test-api.ts

# Run TUI (requires TTY)
bun run start
```

## License

MIT

## Disclaimer

This is a paper trading system for educational purposes. Do not use for actual trading without understanding the risks. Past performance (including backtests) does not guarantee future results. The authors are not responsible for any financial losses.
