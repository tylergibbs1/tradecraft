# Tradecraft Agent Guide

A guide for AI agents (like Claude) to operate the Tradecraft autonomous trading system.

## Overview

Tradecraft is an autonomous trading TUI that uses Claude to make trading decisions. The system:

- Fetches real-time market data from Yahoo Finance
- Manages a paper trading portfolio with positions, cash, and P&L tracking
- Enforces risk limits (position size, daily loss, drawdown) at the infrastructure level
- Logs all decisions for audit and analysis

**Key Principle**: The Claude agent makes trading decisions, but risk limits are enforced by the system—not by the agent's judgment. This prevents the agent from making catastrophic mistakes.

## Quick Start

```bash
# Check portfolio status
bun run cli status

# Get real-time quotes
bun run cli quotes

# Run a single trading cycle (agent analyzes and trades)
bun run cli cycle

# View trade history
bun run cli history

# Check risk limits
bun run cli risk
```

## CLI Commands Reference

### `bun run cli status`
Shows current portfolio state including:
- Cash and total equity
- All open positions with P&L
- Daily/weekly/total returns

### `bun run cli quotes`
Fetches real-time prices for all symbols in the trading universe.

### `bun run cli cycle`
**Most important command.** Runs a single trading cycle where:
1. Agent fetches market data and portfolio state
2. Agent analyzes conditions and decides on trades
3. Agent executes trades (validated against risk limits)
4. Results are displayed

Typical output:
```
[SYS] Starting trading cycle abc123
[AGT] I'll analyze the current state...
[RES] get_market_data: {"success":true,"data":{...}}
[RES] place_order: {"success":true,"order":{...}}
[SYS] Cycle abc123 complete: 3 turns, 2 orders

Cycle Complete:
  Turns:   3
  Tokens:  15000
  Cost:    $0.14
  Orders:  2 placed, 0 cancelled
```

### `bun run cli start`
Runs continuous trading cycles at the configured interval (default: 60 seconds).
Press Ctrl+C to stop.

### `bun run cli risk`
Shows risk status including:
- Circuit breaker state (closed = can trade, open = halted)
- Current drawdown vs limit
- Position count vs limit
- Daily/weekly P&L vs limits

### `bun run cli history`
Shows recent trade history with timestamps, symbols, quantities, prices, and P&L.

### `bun run cli order <side> <symbol> <quantity>`
Place a manual order (bypasses agent). Example:
```bash
bun run cli order buy AAPL 10
bun run cli order sell GOOGL 5
```

### `bun run cli reset`
Resets portfolio to initial state ($100k cash, no positions). Use with caution.

## Backtesting

### Rule-Based Strategy Backtest
Test predefined strategies on historical data:
```bash
# List available strategies
bun run backtest --help

# Run SMA crossover strategy
bun run backtest sma-crossover --start 2024-01-01

# Run momentum strategy on specific symbols
bun run backtest momentum --symbols AAPL,NVDA,TSLA
```

Available strategies:
- `sma-crossover` - Buy when 10-day SMA crosses above 50-day SMA
- `rsi-mean-reversion` - Buy when RSI < 30, sell when RSI > 70
- `momentum` - Buy on positive momentum with trailing stop

### Agent Backtest
**Test the actual Claude agent on historical data:**
```bash
# Default: 3 months, weekly cycles (~$1-3)
bun run agent-backtest

# Custom period
bun run agent-backtest --start 2024-06-01 --end 2024-12-31

# Daily cycles (more realistic but expensive)
bun run agent-backtest --frequency 1 --start 2024-10-01

# Skip confirmation
bun run agent-backtest -y
```

**Cost estimates:**
| Period | Frequency | Est. Cost |
|--------|-----------|-----------|
| 1 month | Weekly | ~$0.50 |
| 3 months | Weekly | ~$1.50 |
| 1 year | Weekly | ~$5 |
| 1 year | Daily | ~$25-50 |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI / TUI                           │
│                    (bun run cli <cmd>)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 SdkTradingAgent (Agent SDK)                │
│  - Builds prompts with portfolio state and risk status      │
│  - Calls Claude API with trading tools                      │
│  - Processes tool calls and executes trades                 │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Portfolio       │ │ Data Manager    │ │ Risk Monitor    │
│ Manager         │ │                 │ │                 │
│ - Positions     │ │ - Yahoo Finance │ │ - Position limits│
│ - Orders        │ │ - Quote caching │ │ - Loss limits   │
│ - Trades        │ │ - History       │ │ - Circuit breaker│
│ - P&L tracking  │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
        │                   │                   │
        ▼                   ▼                   ▼
   positions.json     Yahoo API        circuit_breaker.json
```

## Trading Tools

The agent has access to these tools:

### `get_risk_status`
Returns:
- `canTrade`: boolean - whether trading is allowed
- `circuitBreaker.state`: "closed" (ok) or "open" (halted)
- `metrics`: daily/weekly P&L, drawdown, position count

### `get_market_data`
Input: `{ symbols: ["AAPL", "GOOGL"] }`
Returns: Current prices, bid/ask, volume for each symbol

### `get_portfolio`
Returns:
- Cash balance
- Total equity
- All positions with quantities, costs, current prices, P&L

### `place_order`
Input:
```json
{
  "symbol": "AAPL",
  "side": "buy",
  "type": "market",
  "quantity": 10
}
```
Returns: Order confirmation or error if risk limits violated

### `cancel_order`
Input: `{ orderId: "uuid" }`
Returns: Confirmation or error

## Risk Limits

Configured in `~/.config/tradecraft/config.toml`:

```toml
[riskLimits]
maxPositionSize = 0.1      # 10% of portfolio per position
maxPositionCount = 10      # Maximum 10 positions
dailyLossLimit = 0.02      # Stop trading if down 2% today
weeklyLossLimit = 0.05     # Stop trading if down 5% this week
maxDrawdown = 0.1          # Circuit breaker at 10% drawdown
maxOrderValue = 10000      # Maximum $10k per order
```

**These limits are enforced at the tool level**, not by the agent's prompts. An order violating limits will be rejected with an error.

## Configuration

Config file: `~/.config/tradecraft/config.toml`

```toml
dataProvider = "yahoo"
anthropicApiKey = "sk-ant-..."

[agentParams]
model = "claude-sonnet-4-5-20250929"
maxTurns = 10
maxBudgetUsd = 0.5
cycleIntervalMs = 60000

[tradingUniverse]
symbols = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA"]
allowShorts = false

[capital]
initialCapital = 100000
currency = "USD"
paperTrading = true
```

## Agent Prompts

The agent receives two prompts each cycle:

### System Prompt
Establishes the agent's role as a "senior quantitative portfolio manager with 15 years of experience" and includes:
- Trading philosophy (capital preservation, diversification)
- Risk constraints
- Tool descriptions
- Strategy guidelines
- 5 example scenarios (buy, sell, hold, trim, circuit breaker)

### Cycle Prompt
Contains current state:
- Portfolio snapshot (cash, equity, positions with weights)
- Risk metrics (drawdown, P&L limits)
- Instructions for the cycle

## Typical Workflow

### For Daily Operation
```bash
# Morning: Check status
bun run cli status
bun run cli quotes

# Run a trading cycle
bun run cli cycle

# Check what happened
bun run cli history
```

### For Testing Changes
```bash
# Reset to clean state
bun run cli reset

# Run multiple cycles
bun run cli cycle
bun run cli cycle
bun run cli cycle

# Check results
bun run cli status
bun run cli history
```

### For Backtesting
```bash
# Quick agent backtest (3 months weekly)
bun run agent-backtest -y

# Longer backtest
bun run agent-backtest --start 2024-01-01 --frequency 5 -y

# Compare to rule-based strategy
bun run backtest momentum --start 2024-01-01
```

## File Structure

```
tradecraft/
├── src/
│   ├── agent/
│   │   ├── sdk-trading-agent.ts # Agent SDK trading agent
│   │   ├── mcp-server.ts   # Trading tools
│   │   ├── prompts.ts      # System and cycle prompts
│   │   ├── permissions.ts  # Risk validation for tools
│   │   └── hooks.ts        # Logging and audit
│   ├── backtest/
│   │   ├── engine.ts       # Rule-based backtester
│   │   ├── agent-engine.ts # Claude agent backtester
│   │   └── strategies.ts   # SMA, RSI, Momentum
│   ├── config/
│   │   ├── schema.ts       # Zod schemas
│   │   └── index.ts        # Load/save config
│   ├── data/
│   │   └── providers/
│   │       └── yahoo.ts    # Yahoo Finance API
│   ├── portfolio/
│   │   └── manager.ts      # Position and order management
│   ├── risk/
│   │   ├── monitor.ts      # Risk limit checking
│   │   └── circuit.ts      # Circuit breaker
│   ├── cli.ts              # CLI interface
│   ├── backtest-cli.ts     # Backtest CLI
│   └── agent-backtest-cli.ts # Agent backtest CLI
├── data/
│   └── portfolio/
│       └── positions.json  # Persisted portfolio state
└── ~/.config/tradecraft/
    └── config.toml         # User configuration
```

## Troubleshooting

### "Cannot trade" / Circuit breaker open
```bash
bun run cli risk
```
If circuit breaker is open, it means risk limits were breached. Wait for automatic reset or manually reset:
```bash
bun run cli reset
```

### No API key configured
```bash
# Check config
cat ~/.config/tradecraft/config.toml

# Re-run setup if needed
bun run setup
```

### Stale prices
Yahoo Finance has rate limits. Wait a few seconds between quote requests.

### Agent making poor decisions
The prompts in `src/agent/prompts.ts` can be tuned. Key sections:
- Role definition (senior quant PM persona)
- Strategy guidelines
- Examples (add more relevant scenarios)

## Cost Management

Each trading cycle costs approximately:
- **$0.08-0.15** for a typical cycle (10-20k tokens)
- **$0.30** for a complex cycle with many tool calls

To minimize costs:
- Use weekly cycles for backtesting (`--frequency 5`)
- Set `maxTurns` lower in config (default: 10)
- Use `claude-sonnet-4-5-20250929` instead of Opus

## Summary

1. **Check status**: `bun run cli status`
2. **Run cycle**: `bun run cli cycle`
3. **View history**: `bun run cli history`
4. **Backtest agent**: `bun run agent-backtest`
5. **Config location**: `~/.config/tradecraft/config.toml`

The system is designed so that the Claude agent makes intelligent trading decisions while the infrastructure enforces hard risk limits. This separation ensures safety even if the agent makes mistakes.
