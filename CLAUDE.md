# Tradecraft - Autonomous Trading TUI

An autonomous trading terminal user interface built with Bun, Ink (React for terminal), and Claude Agent SDK.

## Quick Start

```bash
# First-time setup
bun run setup

# Start the trading TUI
bun run start

# Run a backtest
bun run backtest sma-crossover --symbols AAPL,GOOGL
```

## Architecture

```
src/
├── agent/           # Claude agent integration
│   ├── index.ts     # Agent loop with SDK query()
│   ├── mcp-server.ts # Trading tools MCP server
│   ├── permissions.ts # canUseTool for risk validation
│   ├── hooks.ts     # Pre/post tool hooks for logging
│   └── prompts.ts   # System and cycle prompts
├── backtest/        # Backtest engine
│   ├── engine.ts    # Simulation engine
│   └── strategies.ts # Trading strategies
├── config/          # Configuration management
│   ├── index.ts     # TOML reader/writer
│   └── schema.ts    # Zod schemas
├── data/            # Market data providers
│   ├── cache.ts     # Local JSON cache
│   ├── providers/   # Yahoo, Polygon, Alpha Vantage
│   └── types.ts     # OHLCV, Quote types
├── journal/         # Trade logging
├── portfolio/       # Portfolio state management
│   ├── manager.ts   # Order lifecycle
│   └── types.ts     # Position, Order, Trade types
├── risk/            # Risk management
│   ├── circuit.ts   # Circuit breaker state machine
│   └── monitor.ts   # Risk limits enforcement
├── setup/           # Setup wizard
│   ├── components/  # RadioSelect, Slider, etc.
│   └── index.tsx    # 7-step wizard
└── ui/              # Main TUI
    ├── App.tsx      # Main layout with tabs
    └── components/  # Portfolio, Trades, Journal, AgentLog
```

## Bun Conventions

- Use `bun <file>` instead of `node <file>`
- Use `bun test` for tests
- Use `bun install` for dependencies
- Bun automatically loads .env files

## Key Files

| File | Purpose |
|------|---------|
| `src/agent/mcp-server.ts` | Trading tools: place_order, cancel_order, get_market_data, etc. |
| `src/agent/sdk-trading-agent.ts` | Agent loop with SDK query() |
| `src/agent/permissions.ts` | canUseTool for risk validation |
| `src/risk/monitor.ts` | Risk limits enforcement |
| `src/risk/circuit.ts` | Circuit breaker state machine |
| `src/ui/App.tsx` | Main TUI with tabs |
| `src/config/schema.ts` | Zod config schemas |

## Configuration

Config is stored at `~/.config/tradecraft/config.toml`. Run `bun run setup` to configure:

- Data provider (Yahoo Finance, Polygon, Alpha Vantage)
- API keys
- Risk limits (position size, daily loss, max drawdown)
- Trading universe (symbols)
- Agent parameters (model, turns, budget)
- Initial capital

## Risk Management

1. **canUseTool** - Validates every `place_order` call against limits
2. **Circuit Breaker** - Persisted to disk, survives restarts
3. **Hooks** - Log all tool calls for audit trail

Risk limits enforced:
- Max position size (% of portfolio)
- Max position count
- Daily loss limit
- Weekly loss limit
- Max drawdown (triggers circuit breaker)
- Max single order value

## TUI Controls

- `1-4` - Switch tabs (Portfolio, Trades, Journal, Agent Log)
- `p` - Pause agent
- `r` - Resume/start agent
- `k` - Kill (halt) agent
- `q` - Quit

## Backtest Strategies

Available strategies:
- `sma-crossover` - Simple moving average crossover
- `rsi-mean-reversion` - RSI oversold/overbought
- `momentum` - Price momentum with trailing stop

```bash
bun run backtest momentum --start 2024-01-01 --symbols AAPL,MSFT --capital 50000
```

## Data Storage

- `~/.config/tradecraft/config.toml` - Configuration
- `data/portfolio.json` - Portfolio state
- `data/snapshots.json` - Daily equity snapshots
- `data/circuit_breaker.json` - Circuit breaker state
- `cache/*.json` - Market data cache
- `logs/audit/*.jsonl` - Tool call audit log
- `logs/agent/*.jsonl` - Agent cycle logs
- `logs/trades.jsonl` - Trade journal
