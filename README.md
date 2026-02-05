# Tradecraft

An autonomous trading system powered by Claude. The AI agent analyzes market data, makes trading decisions, and executes trades—all within hard risk limits enforced at the infrastructure level.

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
- **Risk Management**: Hard limits on position size, daily loss, drawdown—enforced by system, not prompts
- **Paper Trading**: Safe simulation with real market data from Yahoo Finance
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
- Polygon.io API key (optional — enables real-time quotes, news sentiment, technical indicators, and company data)

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
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        TradingAgent                              │
│  • Builds prompts with portfolio state and market context        │
│  • Sends requests to Claude API                                  │
│  • Processes tool calls and executes trades                      │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
┌───────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Portfolio Manager │ │  Data Manager   │ │  Risk Monitor   │
│                   │ │                 │ │                 │
│ • Positions       │ │ • Polygon.io    │ │ • Position size │
│ • Cash balance    │ │ • Yahoo Finance │ │ • Loss limits   │
│ • Order execution │ │ • OHLCV + Quote │ │ • Circuit break │
│ • P&L tracking    │ │ • In-mem cache  │ │                 │
└───────────────────┘ └─────────────────┘ └─────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   positions.json     Polygon / Yahoo      circuit_breaker.json
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

**Key observations:**
- Outperformed S&P 500 for full year 2024 (+28% vs ~24%)
- Strong performance in bull markets (H1) with aggressive NVDA positioning
- Capital preservation in volatile periods (H2) by cutting losers early
- High win rate (87.8%) from selective, disciplined trading
- Low cost (~$5 for a full year of weekly decisions)

*Note: Backtests have inherent limitations. Past performance does not guarantee future results.*

## Project Structure

```
tradecraft/
├── src/
│   ├── agent/              # Trading agent and tools
│   │   ├── index.ts        # TradingAgent class
│   │   ├── mcp-server.ts   # Tool definitions (orders, data, risk, Polygon, Exa, EDGAR)
│   │   ├── permissions.ts  # canUseTool risk validation
│   │   ├── hooks.ts        # Pre/post tool hooks for audit logging
│   │   └── prompts.ts      # System and cycle prompts
│   ├── agents/             # Multi-agent specialist system
│   │   ├── specialists/    # Technical, fundamental, macro, sentiment, hypothesis agents
│   │   ├── portfolio-manager.ts
│   │   └── signal-bus.ts
│   ├── backtest/           # Backtesting engines
│   │   ├── engine.ts       # Rule-based backtester
│   │   ├── agent-engine.ts # Claude agent backtester
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
│   ├── portfolio/          # Position management + order lifecycle
│   ├── risk/               # Risk monitor + circuit breaker state machine
│   ├── journal/            # Trade logging
│   ├── setup/              # Interactive setup wizard (Ink/React)
│   ├── ui/                 # TUI app with tabs (Portfolio, Trades, Journal, Agent Log)
│   ├── main.tsx            # TUI entry point
│   └── cli.ts              # CLI entry point
├── data/                   # Persisted state (portfolio, snapshots, circuit breaker)
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
