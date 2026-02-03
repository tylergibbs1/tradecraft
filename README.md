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

- **Multi-Agent Swarm**: 4 specialist agents (fundamental, technical, sentiment, macro) analyze in parallel
- **Real-Time Dashboard**: Next.js web UI with live streaming agent output
- **Autonomous Trading**: Claude analyzes markets and executes trades independently
- **Risk Management**: Hard limits on position size, daily loss, drawdown—enforced by system, not prompts
- **Paper Trading**: Safe simulation with real market data from Yahoo Finance
- **Claude Agent SDK**: Real-time streaming with `includePartialMessages` for live UI updates
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
- Internet connection (for Yahoo Finance data)

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
dataProvider = "yahoo"
anthropicApiKey = "sk-ant-..."

[agentParams]
model = "claude-sonnet-4-5-20250929"
maxTurns = 10
cycleIntervalMs = 60000

[tradingUniverse]
symbols = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA"]
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
| `bun run cli swarm` | Run multi-agent swarm analysis |

## Multi-Agent Swarm

The swarm mode runs 4 specialist agents in parallel, each analyzing from a different perspective:

```bash
# Start swarm analysis
bun run cli swarm

# With options
bun run cli swarm --symbols AAPL,NVDA --cycles 5
```

### Specialist Agents

| Agent | Focus |
|-------|-------|
| **Fundamental** | Financial statements, earnings, valuation metrics |
| **Technical** | Price action, moving averages, RSI, support/resistance |
| **Sentiment** | News sentiment, social media, analyst ratings |
| **Macro** | Economic indicators, Fed policy, sector rotation |

Each agent publishes signals to a shared bus. A consensus algorithm weighs the signals to generate trading recommendations.

## Web Dashboard

A real-time Next.js dashboard for monitoring the swarm:

```bash
# Start the dashboard
bun run dashboard

# Opens at http://localhost:3000
```

### Features

- **Live Streaming**: Text streams in real-time as agents analyze (100ms updates)
- **Specialist Panels**: See each agent's status, current symbol, and output
- **Consensus View**: Weighted scores and recommendations per symbol
- **Tool Progress**: See which tools agents are using in real-time
- **Portfolio Overview**: Positions, P&L, and trade history

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
│ • Positions       │ │ • Yahoo Finance │ │ • Position size │
│ • Cash balance    │ │ • OHLCV data    │ │ • Loss limits   │
│ • Order execution │ │ • Quote cache   │ │ • Circuit break │
│ • P&L tracking    │ │                 │ │                 │
└───────────────────┘ └─────────────────┘ └─────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   positions.json       Yahoo API         circuit_breaker.json
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
| `get_market_data` | Fetch current prices for symbols |
| `get_portfolio` | View positions, cash, equity, P&L |
| `place_order` | Execute a buy/sell order |
| `cancel_order` | Cancel a pending order |

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
│   ├── agent/           # Single-agent trading
│   │   ├── index.ts     # TradingAgent class
│   │   ├── mcp-server.ts # Tool definitions
│   │   └── prompts.ts   # System and cycle prompts
│   ├── agents/          # Multi-agent swarm
│   │   ├── base.ts      # ResearchAgent base class (Claude Agent SDK)
│   │   ├── portfolio-manager.ts # Swarm orchestrator
│   │   ├── signal-bus.ts # Inter-agent communication
│   │   ├── consensus.ts # Signal aggregation
│   │   └── specialists/ # Specialist agent implementations
│   ├── backtest/        # Backtesting engines
│   ├── config/          # Configuration schemas
│   ├── data/            # Market data providers
│   ├── portfolio/       # Position management
│   ├── risk/            # Risk monitoring
│   └── cli.ts           # CLI interface
├── ui/                  # Next.js dashboard
│   ├── app/             # App router pages
│   │   ├── api/         # SSE endpoints (swarm, control)
│   │   └── control/     # Swarm control panel
│   └── components/
│       └── swarm/       # SpecialistPanel, ConsensusPanel
├── data/                # Persisted state
├── AGENT_GUIDE.md       # Guide for AI agents
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
