# Product Requirements Document: tradecraft

**Version:** 1.0  
**Author:** Personal Project  
**Date:** February 2, 2026  
**Status:** Draft

---

## Executive Summary

tradecraft is a terminal-based autonomous trading system where Claude acts as the sole decision-maker and executor. Built with Bun and Ink (React for the terminal), it provides a monitoring interface for observing an AI agent that independently analyzes markets, develops strategies, and executes trades within defined risk boundaries.

The human role is oversight, not operation. You set the risk limits, fund the account, and watch. Claude does the rest.

---

## Problem Statement

Algorithmic trading systems require either significant programming expertise to build custom strategies, or trust in black-box systems with no visibility into decision-making. Meanwhile, LLMs have demonstrated strong reasoning capabilities but are typically relegated to an advisory role.

tradecraft explores a different model: give Claude full trading autonomy within hard risk constraints, and let it learn, adapt, and execute. The human provides capital and risk tolerance. The agent provides analysis, strategy, and execution.

---

## Goals

| Goal | Success Criteria |
|------|------------------|
| Build autonomous trading agent | Claude independently executes trades without human approval |
| Implement robust risk guardrails | Hard limits enforced at system level, not bypassable by agent |
| Provide full transparency | Every decision logged with reasoning, fully auditable |
| Enable backtesting before live | Agent can prove strategy viability on historical data |
| Ship MVP in one day | Core autonomy working by end of day |

---

## Non-Goals (v1)

- Human-in-the-loop trade approval (agent is fully autonomous)
- Live broker integration (paper trading only for v1)
- Multi-asset class support (equities only for v1)
- Mobile or web interface
- Multi-user or multi-agent support
- Options or derivatives
- High-frequency trading (minimum 30s loop interval)

---

## User Stories

**As an operator, I want to:**

1. Configure risk limits that the agent cannot exceed under any circumstances
2. Watch the agent's reasoning in real-time as it makes decisions
3. See current portfolio state and performance metrics at a glance
4. Review a complete audit log of every trade with full reasoning
5. Pause or kill the agent immediately if needed
6. Backtest the agent's strategy approach before enabling live trading
7. Receive alerts when the agent hits risk limits or circuit breakers

**As the agent (Claude), I will:**

1. Continuously analyze market conditions and portfolio state
2. Develop and refine trading hypotheses based on available data
3. Execute trades autonomously within defined risk parameters
4. Log all reasoning and decisions for human review
5. Respect hard limits even when my analysis suggests otherwise
6. Halt trading when circuit breakers trigger

---

## Functional Requirements

### FR-0: Setup TUI

A first-run setup wizard guides users through initial configuration. The setup TUI launches automatically when no config file exists, or can be triggered manually via `bun run setup`.

**Design Language:**

The UI uses an amber accent color throughout for highlights, active states, and key information. Amber conveys caution and attention appropriate for a trading interface.

```tsx
// Color palette
const colors = {
  accent: "yellow",        // Ink's yellow renders as amber in most terminals
  positive: "green",       // Gains, successful operations
  negative: "red",         // Losses, errors, warnings
  muted: "gray",           // Secondary information
  text: "white",           // Primary text
};

// Example header component
<Box>
  <Text bold color="yellow">◆ tradecraft</Text>
  <Text color="gray"> | </Text>
  <Text inverse={tab === "portfolio"} color="yellow"> 1:Portfolio </Text>
  <Text inverse={tab === "trades"} color="yellow"> 2:Trades </Text>
  <Text inverse={tab === "journal"} color="yellow"> 3:Journal </Text>
  <Text inverse={tab === "agent"} color="yellow"> 4:Agent </Text>
  <Text color="gray"> | </Text>
  <Text color={agentState === "RUNNING" ? "green" : "red"}>{agentState}</Text>
</Box>
```

**Setup Flow:**

```
┌─────────────────────────────────────────────────────────────┐
│  tradecraft setup                                           │
│─────────────────────────────────────────────────────────────│
│                                                             │
│  Welcome. Let's configure your autonomous trading agent.    │
│                                                             │
│  Step 1 of 7: Data Provider                                 │
│                                                             │
│  ○ Alpha Vantage (free tier, 5 calls/min)                  │
│  ● Polygon.io (free tier, delayed quotes)                  │
│  ○ Yahoo Finance (unofficial, no key needed)               │
│  ○ Manual CSV import                                        │
│                                                             │
│  [Enter] Select   [↑↓] Navigate   [Tab] Next               │
└─────────────────────────────────────────────────────────────┘
```

**Setup Steps:**

| Step | Screen | Inputs |
|------|--------|--------|
| 1 | Data Provider | Select provider, enter API key if required |
| 2 | Anthropic API | Enter API key, select model (Sonnet/Opus) |
| 3 | Risk Limits | Configure position size, loss limits, drawdown threshold |
| 4 | Trading Universe | Select which tickers the agent can trade |
| 5 | Agent Parameters | Loop interval, context size, trading hours |
| 6 | Starting Capital | Set initial paper trading balance |
| 7 | Confirmation | Review all settings, acknowledge autonomous operation |

**Setup Screens Detail:**

**Step 1: Data Provider**
- Radio select for provider choice
- Conditional text input for API key
- Test connection button to validate credentials
- Show rate limit info for selected provider

**Step 2: Anthropic API**
- Text input for API key (masked)
- Radio select for default model
- Test connection with simple prompt
- Display estimated cost per query

**Step 3: Risk Limits**
- Slider or numeric input for each limit
- Show defaults, allow customization
- Visual indicator showing how conservative/aggressive settings are

```
Max position size:    [████████░░] 10%
Daily loss limit:     [████░░░░░░]  2%
Max drawdown:         [██████████] 10%

                      Conservative ←──────→ Aggressive
                           Your settings: ███░░ Moderate
```

**Step 4: Trading Universe**
- Multi-select for allowed tickers
- Preset options: "S&P 100", "NASDAQ 100", "Custom"
- Warning if universe is too large (API cost implications)

**Step 5: Agent Parameters**
- Loop interval (how often agent analyzes): 30s / 60s / 5m / 15m
- Trading hours: market hours only vs 24/7 (for crypto)
- Context window size: how many recent trades to include
- Backtest requirement: must pass backtest before live trading (on/off)

**Step 6: Starting Capital**
- Numeric input for initial balance
- Dropdown for currency (USD default)
- Toggle: Paper trading vs Live trading
- Live trading requires additional confirmation

**Step 7: Confirmation**
- Display all configured values
- Explicit acknowledgment checkbox:
  ```
  [ ] I understand the agent will execute trades autonomously
      and I have configured risk limits I am comfortable with.
  ```
- Show path where config will be written
- Confirm or go back to edit

**Post-Setup:**
- Write `~/.config/tradecraft/config.toml`
- Create necessary directories (`/cache`, `/logs`, `/journal`)
- Launch main application automatically

**Re-running Setup:**
- `bun run setup` launches setup TUI anytime
- `bun run setup --reset` clears existing config first
- Individual sections editable via `bun run setup --step 3`

### FR-1: Portfolio View

- Display current cash balance (settled and unsettled)
- List all open positions with ticker, shares, average cost, current price, and unrealized P&L
- Show total portfolio value and daily change
- Render ASCII equity curve (last 30 data points minimum)

### FR-2: Order Monitor

- Display all pending, partial, and recently filled orders
- Show order state: pending, partial, filled, rejected, cancelled
- Display execution quality metrics (slippage vs. limit price)
- Real-time updates as agent places and fills orders
- Historical view of all orders for the day/week
- Filter by ticker, side, status

### FR-3: Backtest Engine

- Load historical OHLCV data from cache or fetch from data provider
- Simulate order fills with configurable slippage model
- Track simulated portfolio state through time
- Generate performance report: total return, Sharpe ratio, max drawdown, win rate

### FR-4: Agent Core (Autonomous Execution)

- Agent runs in continuous loop: observe → reason → act → log
- Full execution authority within risk limits
- Structured tool interface via MCP server:
  - `mcp__tradecraft__get_portfolio()` - current state
  - `mcp__tradecraft__get_market_data(ticker, range)` - historical and current prices
  - `mcp__tradecraft__place_order(ticker, side, qty, type, limit_price?)` - execute trade
  - `mcp__tradecraft__cancel_order(order_id)` - cancel pending order
  - `mcp__tradecraft__get_risk_status()` - current limit utilization
- Built-in Claude Code tools (via SDK preset):
  - `Bash` - execute shell commands in sandboxed environment
  - `Read` - read files from allowed directories
  - `Write` - create files in working directory
  - `Edit` - modify existing files with precise replacements
  - `Glob` - find files by pattern
  - `Grep` - search file contents with regex
- Bash tool (sandboxed) enables:
  - Running data processing scripts
  - File system operations (reading strategy files, logs)
  - Executing external analysis tools
- SDK hooks provide:
  - `PreToolUse` - log all tool calls, validate orders against risk limits
  - `PostToolUse` - log results, update UI
  - `Stop` - check for kill switch activation
- All tool calls logged with full context
- Agent cannot modify risk limits or disable circuit breakers
- Agent receives notification when approaching limits (80% threshold)
- Agent must provide reasoning string with every order

**Agent Loop:**

```
while running:
    market_state = get_market_data()
    portfolio = get_portfolio()
    risk_status = get_risk_status()
    
    decision = claude.analyze(market_state, portfolio, risk_status)
    
    if decision.action == "trade":
        if risk_manager.allows(decision.order):
            result = execute(decision.order)
            journal.log(decision, result)
        else:
            journal.log_blocked(decision, risk_manager.reason)
    
    sleep(interval)
```

**Configurable Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Loop interval | 60s | Time between analysis cycles |
| Context window | 50 trades | Recent trades included in prompt |
| Market lookback | 30 days | Historical data provided to agent |

### FR-5: Trade Journal

- Append-only log of all executed trades
- Each entry includes: timestamp, ticker, side, quantity, price, rationale
- Support tagging trades by strategy
- Calculate per-trade and per-strategy statistics

### FR-6: Risk Management

- Maximum position size per ticker (configurable, default 10% of portfolio)
- Maximum portfolio concentration in any sector (configurable, default 25%)
- Daily loss limit (configurable, default 2% of portfolio)
- Weekly loss limit (configurable, default 5% of portfolio)
- Maximum drawdown circuit breaker (configurable, default 10%)
- All limits enforced at the engine level, not UI level

### FR-7: Navigation and Controls

- Tab switching via number keys (1-4)
- Quit via 'q'
- **Kill switch via 'k'** - immediately halts agent, cancels pending orders
- **Pause via 'p'** - pauses agent loop, existing orders remain
- **Resume via 'r'** - resumes paused agent
- Scroll support for long lists (positions, journal entries, agent log)
- Status bar shows agent state: RUNNING | PAUSED | STOPPED | HALTED (circuit breaker)

---

## Technical Architecture

```
/tradecraft
  /src
    /setup
      index.tsx         # setup TUI entry point
      /screens
        Welcome.tsx     # intro screen
        DataProvider.tsx
        AnthropicKey.tsx
        RiskLimits.tsx
        Capital.tsx
        Confirm.tsx
      /components
        RadioSelect.tsx
        Slider.tsx
        MaskedInput.tsx
        TestConnection.tsx
      config-writer.ts  # writes config.toml
    /data
      fetcher.ts        # market data retrieval
      cache.ts          # local data cache management
      types.ts          # OHLCV, quote, and tick types
    /backtest
      engine.ts         # simulation loop
      fills.ts          # order fill modeling with slippage
      report.ts         # performance analytics
    /risk
      limits.ts         # position and exposure limits
      monitor.ts        # real-time limit checking
      circuit.ts        # drawdown and loss circuit breakers
    /agent
      index.ts          # Main agent loop using SDK query()
      mcp-server.ts     # Trading tools MCP server (place_order, get_market_data, etc.)
      hooks.ts          # PreToolUse, PostToolUse, Stop hooks for logging/control
      permissions.ts    # canUseTool implementation for risk validation
      prompts.ts        # System prompt construction
      state.ts          # Agent state machine (running/paused/stopped/halted)
    /portfolio
      state.ts          # portfolio state management
      orders.ts         # order lifecycle management
      ledger.ts         # transaction history
    /journal
      writer.ts         # append-only trade log
      reader.ts         # query and filter trades
    /strategies
      /generated        # AI-generated strategy files
      /manual           # hand-written strategies
    /ui
      App.tsx           # main layout and tab routing
      /components
        Portfolio.tsx   # portfolio view with chart
        Trades.tsx      # order book and execution panel
        Journal.tsx     # trade history browser
        AgentLog.tsx    # agent conversation display
        Chart.tsx       # ASCII sparkline renderer
        Input.tsx       # command input handler
        StatusBar.tsx   # risk limit status indicators
    /cli
      index.ts          # main app entry point
      setup.ts          # setup TUI entry point
  /cache                # local data storage
  /logs                 # agent and system logs
  ~/.config/tradecraft  # user config location (external)
    config.toml         # main configuration file
  bunfig.toml
  package.json
  tsconfig.json
```

---

## Risk Management Specifications

### Position Limits

| Limit Type | Default | Configurable |
|------------|---------|--------------|
| Max position size (% of portfolio) | 10% | Yes |
| Max sector concentration | 25% | Yes |
| Max single-day position change | 5% | Yes |

### Loss Limits

| Limit Type | Default | Action |
|------------|---------|--------|
| Daily loss limit | 2% | Block new positions |
| Weekly loss limit | 5% | Block new positions |
| Max drawdown | 10% | Halt all trading |

### Implementation Notes

- All limits checked synchronously before order submission
- Limits enforced in `/src/risk/monitor.ts`, not in UI components
- Circuit breaker state persisted to disk to survive restarts
- Manual override requires explicit flag and is logged

### Bash & Code Execution Security

The Agent SDK provides built-in sandboxing for bash commands. Security is configured via the `sandbox` option in `query()`.

**SDK Sandbox Configuration:**

```typescript
sandbox: {
  enabled: true,
  autoAllowBashIfSandboxed: true,  // Auto-approve bash when sandboxed
  network: {
    allowLocalBinding: false,       // No local port binding
    allowUnixSockets: []            // No unix socket access
  }
}
```

**Filesystem Restrictions:**

| Access Type | Allowed Paths | Configured Via |
|-------------|---------------|----------------|
| Read | `/home/agent`, `/data/market`, `/data/strategies`, `/logs` | `additionalDirectories` option |
| Write | `/home/agent` only | `cwd` option (working directory) |

**Risk Validation via `canUseTool`:**

All order-related tool calls pass through the `canUseTool` function before execution:

```typescript
canUseTool: async (toolName, input) => {
  if (toolName === "mcp__tradecraft__place_order") {
    const check = await riskManager.preValidate(input);
    if (!check.passed) {
      return {
        behavior: "deny",
        message: `Risk limit exceeded: ${check.reason}`,
        interrupt: check.shouldHalt  // Triggers circuit breaker
      };
    }
  }
  return { behavior: "allow", updatedInput: input };
}
```

**Hook-Based Audit Trail:**

All tool calls are logged via SDK hooks:

```typescript
hooks: {
  PreToolUse: [{
    hooks: [async (input, toolUseId) => {
      await auditLog.append({
        event: "tool_call",
        tool: input.tool_name,
        input: input.tool_input,
        id: toolUseId,
        timestamp: Date.now()
      });
      return {};
    }]
  }],
  PostToolUse: [{
    hooks: [async (input, toolUseId) => {
      await auditLog.append({
        event: "tool_result",
        tool: input.tool_name,
        result: input.tool_response,
        id: toolUseId,
        timestamp: Date.now()
      });
      return {};
    }]
  }]
}
```

---

## Data Requirements

### Market Data

- Source: To be determined (Alpha Vantage, Polygon, or Yahoo Finance)
- Granularity: Daily OHLCV for backtesting, delayed quotes for monitoring
- Cache: Local SQLite or JSON files in `/cache`
- Staleness: Data older than 1 trading day flagged as stale

### Portfolio Data

- Stored in memory during session
- Persisted to `/cache/portfolio.json` on change
- Schema versioned for future migrations

---

## Agent Behavior Specification

### Authority

The agent has full authority to:
- Analyze any available market data via MCP tools
- Place buy and sell orders for any configured ticker
- Set limit prices and order types
- Cancel pending orders
- Adjust position sizes within risk limits
- Develop and iterate on trading strategies
- Execute sandboxed bash commands for data processing
- Read files from `/data/market`, `/data/strategies`, `/logs`
- Write files to `/home/agent` working directory
- Use Claude Code's built-in tools (Read, Write, Edit, Glob, Grep)
- Chain multiple tool calls in a single reasoning turn

### Hard Constraints (System-Enforced)

The agent cannot, under any circumstances:
- Exceed position size limits (enforced via `canUseTool`)
- Trade when daily/weekly loss limits are breached
- Continue trading after drawdown circuit breaker triggers
- Modify its own risk parameters
- Access external systems beyond provided MCP tools
- Trade tickers not in the approved universe
- Execute bash commands with network access (sandbox `allowLocalBinding: false`)
- Write files outside `/home/agent` directory
- Read files outside allowed directories
- Bypass the `canUseTool` permission function

These constraints are enforced at the execution layer, not via prompting. Even if the agent attempts to exceed limits, the system will reject the order.

### Soft Guidelines (Prompt-Based)

The agent is instructed to:
- Diversify across positions
- Avoid chasing momentum
- Cut losses early, let winners run
- Document reasoning thoroughly
- Be skeptical of its own predictions

### System Prompt Structure

```
You are an autonomous trading agent managing a live portfolio.

HARD CONSTRAINTS (enforced by system, you cannot override):
- Max position: {max_position_pct}% of portfolio
- Daily loss limit: {daily_loss_pct}% - trading halts if breached
- Max drawdown: {max_drawdown_pct}% - full stop if breached
- Bash: sandboxed, no network access
- File access: restricted to /home/agent, /data (read), /logs (write)

CURRENT STATE:
Portfolio value: ${portfolio_value}
Cash available: ${cash}
Positions: {positions_json}
Risk utilization: {risk_status}

MARKET DATA:
{market_context}

RECENT TRADES:
{recent_trades}

BUILT-IN TOOLS (from Claude Code):
- Bash: execute shell commands (sandboxed)
- Read: read files from allowed directories  
- Write: create/overwrite files in /home/agent
- Edit: modify existing files
- Glob: find files by pattern
- Grep: search file contents

TRADING TOOLS (via MCP server "tradecraft"):
- mcp__tradecraft__place_order(ticker, side, quantity, order_type, limit_price?)
- mcp__tradecraft__cancel_order(order_id)
- mcp__tradecraft__get_market_data(ticker, range)
- mcp__tradecraft__get_portfolio()
- mcp__tradecraft__get_risk_status()

WORKFLOW:
1. Call get_portfolio() and get_risk_status() to understand current state
2. Call get_market_data() for tickers you want to analyze
3. Use Bash to run analysis scripts or Read to check strategy files
4. If you decide to trade, call place_order() with your reasoning
5. If you decide to hold, explain why

You can batch multiple operations using code. For example:
```python
for ticker in ["NVDA", "AAPL", "MSFT"]:
    data = await mcp__tradecraft__get_market_data(ticker, "1mo")
    # analyze and potentially trade
```

Every decision must include clear reasoning that can be audited later.
```

### Failure Modes

| Scenario | System Response |
|----------|-----------------|
| Agent attempts order exceeding limits | `canUseTool` returns deny, order blocked, agent notified |
| Agent enters infinite reasoning loop | `maxTurns` limit reached, cycle ends |
| API error during execution | SDK handles retry, logged via hooks |
| Agent returns malformed output | SDK parses gracefully, logs error |
| Market data unavailable | MCP tool returns error, agent handles |
| Bash command timeout | SDK enforces timeout, returns error |
| Bash attempts network access | Sandbox blocks, returns permission error |
| Budget exceeded | `maxBudgetUsd` triggers, cycle ends early |
| Kill switch activated | `Stop` hook returns `continue: false` |

### Observability

Every agent cycle produces a structured log entry based on SDK message types:

```json
{
  "timestamp": "2026-02-02T14:30:00Z",
  "cycle_id": "abc123",
  "session_id": "sess_xyz789",
  "duration_ms": 4521,
  "market_snapshot": { ... },
  "portfolio_snapshot": { ... },
  "sdk_result": {
    "type": "result",
    "subtype": "success",
    "num_turns": 3,
    "total_cost_usd": 0.042,
    "usage": {
      "input_tokens": 4521,
      "output_tokens": 892,
      "cache_read_input_tokens": 2100
    }
  },
  "tool_calls": [
    {
      "tool": "mcp__tradecraft__get_market_data",
      "input": {"ticker": "NVDA", "range": "1mo"},
      "output": "[{...ohlcv data...}]",
      "tool_use_id": "toolu_abc"
    },
    {
      "tool": "Bash",
      "input": {"command": "cat /data/strategies/momentum.py"},
      "output": "# Strategy file contents...",
      "tool_use_id": "toolu_def"
    },
    {
      "tool": "mcp__tradecraft__place_order",
      "input": {
        "ticker": "NVDA",
        "side": "buy",
        "quantity": 5,
        "order_type": "limit",
        "limit_price": 134.50
      },
      "output": {"order_id": "ord_123", "status": "filled", "fill_price": 134.48},
      "tool_use_id": "toolu_ghi"
    }
  ],
  "risk_check": {
    "passed": true,
    "position_utilization": 0.08,
    "daily_loss_utilization": 0.01
  },
  "reasoning_summary": "NVDA showing strength above 20-day MA with increasing volume..."
}
```

Logs stored in `/logs/agent/YYYY-MM-DD.jsonl` (JSON Lines format).

**Real-time UI Updates:**

The agent loop streams `SDKAssistantMessage` events to the UI:

```typescript
for await (const message of result) {
  if (message.type === "assistant") {
    // Update agent log panel with reasoning
    ui.appendAgentLog(message.message.content);
  }
  if (message.type === "result") {
    // Cycle complete, update metrics
    ui.updateCycleMetrics(message);
  }
}
```

**Hook-Based Audit Log:**

All tool calls captured via `PreToolUse` and `PostToolUse` hooks:

```json
{
  "timestamp": "2026-02-02T14:30:01Z",
  "session_id": "sess_xyz789",
  "hook": "PreToolUse",
  "tool_name": "mcp__tradecraft__place_order",
  "tool_input": {"ticker": "NVDA", "side": "buy", "quantity": 5, ...},
  "tool_use_id": "toolu_ghi"
}
```

Stored in `/logs/audit/YYYY-MM-DD.jsonl`.

---

## Dependencies

```json
{
  "dependencies": {
    "ink": "^5.0.1",
    "ink-text-input": "^6.0.0",
    "ink-spinner": "^5.0.0",
    "react": "^18.3.1",
    "@anthropic-ai/claude-agent-sdk": "latest",
    "zod": "^3.25.0",
    "asciichart": "^1.5.25"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "typescript": "^5.5.0"
  }
}
```

### Runtime

- Bun 1.x (latest stable)
- Recommended flags for development: `bun --watch run src/cli/index.ts`
- Recommended flags for constrained environments: `bun --smol run src/cli/index.ts`

### Claude Agent SDK Configuration

The agent uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) for autonomous operation. This provides built-in tools (Bash, Read, Write, Edit, Glob, Grep), MCP server support for custom tools, hooks for observability, and sandboxed execution.

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Define trading tools as an MCP server
const tradingServer = createSdkMcpServer({
  name: "tradecraft",
  version: "1.0.0",
  tools: [
    tool(
      "place_order",
      "Execute a trade order. Returns order ID and status.",
      {
        ticker: z.string().describe("Stock ticker symbol"),
        side: z.enum(["buy", "sell"]),
        quantity: z.number().int().positive().describe("Number of shares"),
        order_type: z.enum(["market", "limit", "stop"]),
        limit_price: z.number().optional().describe("Limit price (required for limit orders)")
      },
      async (args) => {
        // Validate against risk limits before execution
        const riskCheck = await riskManager.validate(args);
        if (!riskCheck.passed) {
          return { content: [{ type: "text", text: `Order blocked: ${riskCheck.reason}` }], isError: true };
        }
        const result = await orderExecutor.execute(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
    ),
    
    tool(
      "get_market_data",
      "Fetch OHLCV data for a ticker. Returns JSON array of daily bars.",
      {
        ticker: z.string(),
        range: z.enum(["1d", "5d", "1mo", "3mo", "1y"])
      },
      async (args) => {
        const data = await dataProvider.getOHLCV(args.ticker, args.range);
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      }
    ),
    
    tool(
      "get_portfolio",
      "Get current portfolio state including cash, positions, and P&L.",
      {},
      async () => {
        const portfolio = await portfolioManager.getState();
        return { content: [{ type: "text", text: JSON.stringify(portfolio) }] };
      }
    ),
    
    tool(
      "get_risk_status",
      "Get current risk limit utilization and circuit breaker status.",
      {},
      async () => {
        const status = await riskManager.getStatus();
        return { content: [{ type: "text", text: JSON.stringify(status) }] };
      }
    ),
    
    tool(
      "cancel_order",
      "Cancel a pending order by ID.",
      {
        order_id: z.string()
      },
      async (args) => {
        const result = await orderExecutor.cancel(args.order_id);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
    )
  ]
});

// Agent loop configuration
async function runAgentCycle() {
  const result = query({
    prompt: buildPrompt(),  // Current market state, portfolio, risk status
    options: {
      model: "claude-sonnet-4-5",
      
      // Use Claude Code's built-in tools (Bash, Read, Write, etc.)
      tools: { type: "preset", preset: "claude_code" },
      
      // Custom trading tools via MCP
      mcpServers: {
        tradecraft: tradingServer
      },
      
      // System prompt for autonomous trading
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: TRADING_SYSTEM_PROMPT  // Trading-specific instructions
      },
      
      // Sandbox bash commands for security
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        network: {
          allowLocalBinding: false  // No network access from bash
        }
      },
      
      // Permission handling via custom function
      permissionMode: "default",
      canUseTool: async (toolName, input, { signal }) => {
        // Risk manager validates all order-related tools
        if (toolName === "mcp__tradecraft__place_order") {
          const check = await riskManager.preValidate(input);
          if (!check.passed) {
            return {
              behavior: "deny",
              message: `Risk limit exceeded: ${check.reason}`,
              interrupt: check.shouldHalt  // Halt agent if circuit breaker
            };
          }
        }
        return { behavior: "allow", updatedInput: input };
      },
      
      // Hooks for observability and control
      hooks: {
        PreToolUse: [{
          hooks: [async (input, toolUseId) => {
            logger.logToolCall(input.tool_name, input.tool_input, toolUseId);
            return {};
          }]
        }],
        PostToolUse: [{
          hooks: [async (input, toolUseId) => {
            logger.logToolResult(input.tool_name, input.tool_response, toolUseId);
            return {};
          }]
        }],
        Stop: [{
          hooks: [async (input) => {
            if (agentState === "KILLED") {
              return { continue: false, stopReason: "Kill switch activated" };
            }
            return { continue: true };
          }]
        }]
      },
      
      // Budget and turn limits
      maxTurns: 10,           // Max reasoning steps per cycle
      maxBudgetUsd: 0.50,     // Max spend per cycle
      
      // Working directory for file operations
      cwd: "/home/agent",
      additionalDirectories: ["/data/market", "/data/strategies"]
    }
  });

  // Process agent messages
  for await (const message of result) {
    if (message.type === "assistant") {
      ui.updateAgentLog(message);
    }
    if (message.type === "result") {
      logger.logCycleComplete(message);
      return message;
    }
  }
}
```

**Key SDK Features Used:**

| Feature | Usage |
|---------|-------|
| Built-in tools | `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep` for file and system operations |
| MCP servers | Custom trading tools (`place_order`, `get_market_data`, etc.) |
| Sandbox mode | Bash commands run in isolated environment |
| `canUseTool` | Risk validation before any order execution |
| Hooks | Logging all tool calls for audit trail |
| `maxBudgetUsd` | Prevent runaway API costs |
| `maxTurns` | Limit reasoning depth per cycle |

**Programmatic Tool Calling:**

The Agent SDK allows the agent to batch multiple MCP tool operations efficiently in a single reasoning turn:

```python
# Agent can write code like this in a single turn:
tickers = ["NVDA", "AAPL", "MSFT"]
results = []
for ticker in tickers:
    data = await mcp__tradecraft__get_market_data(ticker, "1mo")
    if analyze_bullish(data):
        order = await mcp__tradecraft__place_order(ticker, "buy", 10, "limit", calculate_entry(data))
        results.append(order)
print(f"Placed {len(results)} orders")
```

This reduces latency and token consumption for multi-step operations.

**Session Management:**

The SDK supports session persistence via the `resume` option:

```typescript
// Resume from last session (if agent was paused/restarted)
const result = query({
  prompt: "Continue analyzing the market",
  options: {
    resume: lastSessionId,  // Resume previous session
    // or
    continue: true,         // Continue most recent conversation
  }
});
```

Session IDs are available in `SDKResultMessage.session_id` and can be persisted to disk for recovery after application restart.

---

## Timeline

| Milestone | Target | Status |
|-----------|--------|--------|
| Project scaffolding and dependencies | Feb 2, Morning | Pending |
| Setup TUI (config wizard) | Feb 2, Morning | Pending |
| Portfolio state and UI shell (Ink) | Feb 2, Late Morning | Pending |
| Risk management module | Feb 2, Midday | Pending |
| MCP trading tools server | Feb 2, Midday | Pending |
| Agent SDK integration (`query()`, hooks, permissions) | Feb 2, Early Afternoon | Pending |
| Backtest engine (basic) | Feb 2, Afternoon | Pending |
| Agent loop with real-time UI updates | Feb 2, Afternoon | Pending |
| Journal and persistence | Feb 2, Evening | Pending |
| Integration testing | Feb 2, Evening | Pending |

---

## Success Metrics

### Functional

- [ ] Setup TUI completes full configuration flow
- [ ] Setup validates API keys before saving
- [ ] Agent executes trades autonomously without human intervention
- [ ] Risk limits block orders via `canUseTool` deny
- [ ] Kill switch halts agent via `Stop` hook within 1 second
- [ ] All agent decisions logged via SDK hooks
- [ ] Circuit breaker triggers via `canUseTool` interrupt flag
- [ ] Backtest completes and reports performance metrics
- [ ] Bash commands execute within SDK sandbox
- [ ] MCP trading tools respond correctly
- [ ] `maxTurns` and `maxBudgetUsd` limits enforced

### Performance

- Startup time under 500ms
- UI renders at 60fps (no perceptible lag on keypress)
- Agent cycle completes within `maxTurns` limit
- Backtest of 1 year daily data completes in under 5 seconds
- SDK `query()` streams messages to UI in real-time

---

## Future Considerations (v2+)

- Live broker integration (Alpaca, Interactive Brokers)
- Real-time streaming quotes
- Options chain visualization
- Strategy version control and A/B testing
- Multi-portfolio support
- Web dashboard for monitoring when away from terminal
- Webhook alerts for limit breaches

---

## Open Questions

1. Which market data provider offers the best free tier for personal use?
2. Should the agent have memory across sessions via SDK's `resume` option?
3. What's the minimum backtest performance threshold before allowing live trading?
4. Should there be a "shadow mode" where agent decisions are logged but MCP tools return mock results?
5. How should the agent handle earnings announcements and other scheduled volatility events?
6. What are the right values for `maxBudgetUsd` and `maxTurns` per cycle?
7. Should we use SDK's `outputFormat` for structured trade decisions?
8. Should the MCP server run in-process or as a separate stdio server?

---

## Appendix A: CLI Commands

| Command | Action |
|---------|--------|
| `bun run start` | Launch main application (runs setup if no config) |
| `bun run setup` | Launch setup TUI |
| `bun run setup --reset` | Clear config and run setup fresh |
| `bun run setup --step N` | Jump to specific setup step |
| `bun run backtest <strategy>` | Run backtest headless |
| `bun run journal` | Export journal to CSV |

## Appendix B: Keyboard Shortcuts (Main App)

| Key | Action |
|-----|--------|
| 1 | Switch to Portfolio tab |
| 2 | Switch to Trades tab |
| 3 | Switch to Journal tab |
| 4 | Switch to Agent tab |
| p | Pause agent (holds position, stops new trades) |
| r | Resume agent |
| k | Kill switch (halt agent, cancel all pending orders) |
| q | Quit application (agent continues in background if daemonized) |
| Ctrl+C | Force quit (stops everything) |

---

## Appendix C: Risk Limit Configuration

Limits are configured in `bunfig.toml` or via environment variables:

```toml
[tradecraft.risk]
max_position_pct = 0.10
max_sector_pct = 0.25
daily_loss_limit_pct = 0.02
weekly_loss_limit_pct = 0.05
max_drawdown_pct = 0.10
```

Environment variable overrides:
```bash
TC_MAX_POSITION_PCT=0.15
TC_DAILY_LOSS_LIMIT_PCT=0.03
```

---

## Appendix D: UI Theme (Amber Accent)

The terminal UI uses an amber accent color scheme throughout. In Ink, this is achieved using the `yellow` color which renders as amber in most terminal emulators.

**Color Palette:**

| Role | Ink Color | Hex (approx) | Usage |
|------|-----------|--------------|-------|
| Accent | `yellow` | #FFBF00 | Headers, active tabs, highlights |
| Positive | `green` | #00FF00 | Gains, successful fills, running state |
| Negative | `red` | #FF0000 | Losses, errors, stopped state |
| Muted | `gray` | #808080 | Separators, secondary text |
| Text | `white` | #FFFFFF | Primary content |

**Main Layout Example:**

```
┌──────────────────────────────────────────────────────────────────┐
│ ◆ tradecraft │ 1:Portfolio  2:Trades  3:Journal  4:Agent │ ●RUN │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Cash: $8,420.00                      Risk: ████░░░░░░ 42%      │
│                                                                  │
│  POSITIONS                                                       │
│  ──────────────────────────────────────────────────────────────  │
│  NVDA    10 @ 134.50    +$142.00  (+10.5%)                      │
│  AAPL    15 @ 182.00     -$45.00   (-1.6%)                      │
│  MSFT     8 @ 415.00     +$88.00   (+2.6%)                      │
│                                                                  │
│  EQUITY                                                          │
│  ──────────────────────────────────────────────────────────────  │
│       10500 ┤                                           ╭───     │
│       10400 ┤                                     ╭─────╯        │
│       10300 ┤                              ╭──────╯              │
│       10200 ┤                    ╭─────────╯                     │
│       10100 ┤          ╭────────╯                                │
│       10000 ┼──────────╯                                         │
│             └────────────────────────────────────────────────    │
│              Jan 15        Jan 22        Jan 29        Feb 02    │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ ◆ Agent analyzing... (cycle 847)                                 │
└──────────────────────────────────────────────────────────────────┘
```

**Component Styling:**

```tsx
// Header with amber accent
<Box borderStyle="single" borderColor="yellow">
  <Text bold color="yellow">◆ tradecraft</Text>
</Box>

// Tab bar
{tabs.map(tab => (
  <Text 
    key={tab.id}
    color={activeTab === tab.id ? "yellow" : "gray"}
    bold={activeTab === tab.id}
    inverse={activeTab === tab.id}
  >
    {` ${tab.key}:${tab.label} `}
  </Text>
))}

// Agent status indicator
<Text color={agentState === "RUNNING" ? "green" : agentState === "PAUSED" ? "yellow" : "red"}>
  ●{agentState}
</Text>

// Risk utilization bar (amber fill)
<Text>
  Risk: <Text color="yellow">{"█".repeat(Math.floor(riskPct * 10))}</Text>
  <Text color="gray">{"░".repeat(10 - Math.floor(riskPct * 10))}</Text>
  {` ${(riskPct * 100).toFixed(0)}%`}
</Text>

// P&L coloring
<Text color={pnl >= 0 ? "green" : "red"}>
  {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} ({pnlPct.toFixed(1)}%)
</Text>
```

---

*End of Document*