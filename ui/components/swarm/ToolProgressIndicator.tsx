"use client";

export interface ActiveTool {
  agentId: string;
  toolName: string;
  startedAt: string;
}

interface ToolProgressIndicatorProps {
  activeTools: Record<string, ActiveTool>;
}

function Spinner() {
  return (
    <div className="inline-flex items-center gap-0.5">
      <span className="animate-[bounce_1s_ease-in-out_0ms_infinite] w-1 h-1 rounded-full bg-blue-400" />
      <span className="animate-[bounce_1s_ease-in-out_150ms_infinite] w-1 h-1 rounded-full bg-blue-400" />
      <span className="animate-[bounce_1s_ease-in-out_300ms_infinite] w-1 h-1 rounded-full bg-blue-400" />
    </div>
  );
}

function formatAgentName(agentId: string): string {
  // Extract role from agentId like "swarm-pm-fundamental" -> "Fundamental"
  const parts = agentId.split("-");
  const role = parts[parts.length - 1];
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatToolName(toolName: string): string {
  // Convert snake_case to Title Case
  return toolName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function ToolProgressIndicator({ activeTools }: ToolProgressIndicatorProps) {
  const tools = Object.values(activeTools);

  if (tools.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
      <span className="text-xs text-blue-400 font-medium">Active Tools:</span>
      {tools.map((tool) => (
        <div
          key={`${tool.agentId}-${tool.toolName}`}
          className="flex items-center gap-2 px-2 py-1 bg-blue-500/10 rounded text-xs"
        >
          <Spinner />
          <span className="text-muted-foreground">{formatAgentName(tool.agentId)}</span>
          <span className="text-blue-300 font-mono">{formatToolName(tool.toolName)}</span>
        </div>
      ))}
    </div>
  );
}

export default ToolProgressIndicator;
