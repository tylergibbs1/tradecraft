import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { Order, Trade } from "../../portfolio/types.js";

interface TradesProps {
  openOrders: Order[];
  recentTrades: Trade[];
}

type ViewMode = "orders" | "trades";

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString();
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function Trades({ openOrders, recentTrades }: TradesProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("orders");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = viewMode === "orders" ? openOrders : recentTrades;
  const maxIndex = items.length - 1;

  useInput((input, key) => {
    if (input === "o") {
      setViewMode("orders");
      setSelectedIndex(0);
    } else if (input === "t") {
      setViewMode("trades");
      setSelectedIndex(0);
    } else if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < maxIndex) {
      setSelectedIndex(selectedIndex + 1);
    }
  });

  return (
    <Box flexDirection="column">
      {/* View Toggle */}
      <Box marginBottom={1}>
        <Text color={viewMode === "orders" ? "cyan" : "gray"} bold={viewMode === "orders"}>
          [o] Open Orders ({openOrders.length})
        </Text>
        <Text> │ </Text>
        <Text color={viewMode === "trades" ? "cyan" : "gray"} bold={viewMode === "trades"}>
          [t] Recent Trades ({recentTrades.length})
        </Text>
      </Box>

      {viewMode === "orders" ? (
        <OrdersView orders={openOrders} selectedIndex={selectedIndex} />
      ) : (
        <TradesView trades={recentTrades} selectedIndex={selectedIndex} />
      )}
    </Box>
  );
}

function OrdersView({ orders, selectedIndex }: { orders: Order[]; selectedIndex: number }) {
  if (orders.length === 0) {
    return <Text color="gray">No open orders</Text>;
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold color="gray">
          {"".padEnd(2)}
          {"Symbol".padEnd(8)}
          {"Side".padEnd(6)}
          {"Type".padEnd(10)}
          {"Qty".padStart(8)}
          {"Price".padStart(12)}
          {"Status".padEnd(12)}
          {"Time".padEnd(12)}
        </Text>
      </Box>
      {/* Rows */}
      {orders.map((order, i) => (
        <Box key={order.id}>
          <Text color={i === selectedIndex ? "cyan" : undefined}>
            {i === selectedIndex ? "❯ " : "  "}
            {order.symbol.padEnd(8)}
            {order.side.toUpperCase().padEnd(6)}
            {order.type.padEnd(10)}
            {order.quantity.toString().padStart(8)}
            {(order.price ? formatCurrency(order.price) : "MKT").padStart(12)}
            {order.status.padEnd(12)}
            {formatTime(order.createdAt).padEnd(12)}
          </Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="gray">Order ID: {orders[selectedIndex]?.id.slice(0, 8) ?? "N/A"}</Text>
      </Box>
    </Box>
  );
}

function TradesView({ trades, selectedIndex }: { trades: Trade[]; selectedIndex: number }) {
  if (trades.length === 0) {
    return <Text color="gray">No trades yet</Text>;
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold color="gray">
          {"".padEnd(2)}
          {"Symbol".padEnd(8)}
          {"Side".padEnd(6)}
          {"Qty".padStart(8)}
          {"Price".padStart(12)}
          {"Value".padStart(14)}
          {"P&L".padStart(12)}
          {"Time".padEnd(12)}
        </Text>
      </Box>
      {/* Rows */}
      {trades.map((trade, i) => (
        <Box key={trade.id}>
          <Text color={i === selectedIndex ? "cyan" : undefined}>
            {i === selectedIndex ? "❯ " : "  "}
            {trade.symbol.padEnd(8)}
            {trade.side.toUpperCase().padEnd(6)}
            {trade.quantity.toString().padStart(8)}
            {formatCurrency(trade.price).padStart(12)}
            {formatCurrency(trade.value).padStart(14)}
          </Text>
          {trade.pnl !== undefined ? (
            <Text color={trade.pnl >= 0 ? "green" : "red"}>{formatCurrency(trade.pnl).padStart(12)}</Text>
          ) : (
            <Text color="gray">{"N/A".padStart(12)}</Text>
          )}
          <Text color={i === selectedIndex ? "cyan" : undefined}>{formatTime(trade.executedAt).padEnd(12)}</Text>
        </Box>
      ))}
    </Box>
  );
}
