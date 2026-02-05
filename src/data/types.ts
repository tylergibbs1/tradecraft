/**
 * Core market data types
 */

export interface OHLCV {
  timestamp: number; // Unix timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  last: number;
  bid?: number;
  ask?: number;
  volume: number;
  timestamp: number; // Unix timestamp in milliseconds
}

export type TimeFrame = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

export interface DataProviderInterface {
  name: string;
  getQuote(symbol: string): Promise<Quote>;
  getHistory(
    symbol: string,
    timeframe: TimeFrame,
    startDate: Date,
    endDate: Date
  ): Promise<OHLCV[]>;
  isAvailable(): Promise<boolean>;
}
