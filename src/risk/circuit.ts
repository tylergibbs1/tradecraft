import * as fs from "node:fs";
import * as path from "node:path";
import type { CircuitBreakerState, CircuitBreakerStatus } from "./types.js";

const DATA_DIR = path.join(process.cwd(), "data");
const CIRCUIT_BREAKER_FILE = path.join(DATA_DIR, "circuit_breaker.json");

export interface CircuitBreakerConfig {
  cooldownMs: number; // How long to stay in open state
  halfOpenTestCount: number; // Number of test trades in half-open
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  cooldownMs: 24 * 60 * 60 * 1000, // 24 hours
  halfOpenTestCount: 3,
};

interface PersistedState {
  state: CircuitBreakerState;
  reason?: string;
  triggeredAt?: string;
  cooldownEndsAt?: string;
  halfOpenTestsRemaining?: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private reason?: string;
  private triggeredAt?: Date;
  private cooldownEndsAt?: Date;
  private halfOpenTestsRemaining: number = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadState();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadState(): void {
    try {
      if (fs.existsSync(CIRCUIT_BREAKER_FILE)) {
        const data = fs.readFileSync(CIRCUIT_BREAKER_FILE, "utf-8");
        const persisted: PersistedState = JSON.parse(data);

        this.state = persisted.state;
        this.reason = persisted.reason;
        this.triggeredAt = persisted.triggeredAt ? new Date(persisted.triggeredAt) : undefined;
        this.cooldownEndsAt = persisted.cooldownEndsAt ? new Date(persisted.cooldownEndsAt) : undefined;
        this.halfOpenTestsRemaining = persisted.halfOpenTestsRemaining ?? 0;

        // Check if cooldown has expired
        if (this.state === "open" && this.cooldownEndsAt) {
          if (new Date() >= this.cooldownEndsAt) {
            this.transitionToHalfOpen();
          }
        }
      }
    } catch {
      // Start with closed state if file doesn't exist or is invalid
      this.state = "closed";
    }
  }

  private saveState(): void {
    this.ensureDataDir();

    const persisted: PersistedState = {
      state: this.state,
      reason: this.reason,
      triggeredAt: this.triggeredAt?.toISOString(),
      cooldownEndsAt: this.cooldownEndsAt?.toISOString(),
      halfOpenTestsRemaining: this.halfOpenTestsRemaining,
    };

    fs.writeFileSync(CIRCUIT_BREAKER_FILE, JSON.stringify(persisted, null, 2));
  }

  private transitionToHalfOpen(): void {
    this.state = "half_open";
    this.halfOpenTestsRemaining = this.config.halfOpenTestCount;
    this.saveState();
  }

  /**
   * Trip the circuit breaker - called when risk limit is exceeded
   */
  trip(reason: string): void {
    this.state = "open";
    this.reason = reason;
    this.triggeredAt = new Date();
    this.cooldownEndsAt = new Date(Date.now() + this.config.cooldownMs);
    this.saveState();
  }

  /**
   * Record a successful trade in half-open state
   */
  recordSuccess(): void {
    if (this.state === "half_open") {
      this.halfOpenTestsRemaining--;
      if (this.halfOpenTestsRemaining <= 0) {
        this.reset();
      } else {
        this.saveState();
      }
    }
  }

  /**
   * Record a failure in half-open state - reopens the circuit
   */
  recordFailure(reason: string): void {
    if (this.state === "half_open") {
      this.trip(reason);
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = "closed";
    this.reason = undefined;
    this.triggeredAt = undefined;
    this.cooldownEndsAt = undefined;
    this.halfOpenTestsRemaining = 0;
    this.saveState();
  }

  /**
   * Check if trading is allowed
   */
  canTrade(): boolean {
    // Check if cooldown has expired
    if (this.state === "open" && this.cooldownEndsAt) {
      if (new Date() >= this.cooldownEndsAt) {
        this.transitionToHalfOpen();
      }
    }

    return this.state !== "open";
  }

  /**
   * Get current status
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      reason: this.reason,
      triggeredAt: this.triggeredAt?.toISOString(),
      cooldownEndsAt: this.cooldownEndsAt?.toISOString(),
    };
  }

  /**
   * Get the current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }
}
