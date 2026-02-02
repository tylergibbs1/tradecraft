import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface NumberInputProps {
  label: string;
  defaultValue: number;
  min?: number;
  max?: number;
  format?: (value: number) => string;
  onSubmit: (value: number) => void;
}

export function NumberInput({
  label,
  defaultValue,
  min = 0,
  max = Infinity,
  format = (v) => v.toString(),
  onSubmit,
}: NumberInputProps) {
  const [value, setValue] = useState(defaultValue.toString());
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.return) {
      const num = parseFloat(value);
      if (isNaN(num)) {
        setError("Please enter a valid number");
        return;
      }
      if (num < min) {
        setError(`Value must be at least ${format(min)}`);
        return;
      }
      if (num > max) {
        setError(`Value must be at most ${format(max)}`);
        return;
      }
      onSubmit(num);
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setError(null);
    } else if (
      (input && /[0-9.]/.test(input)) ||
      (input === "-" && value.length === 0)
    ) {
      setValue((v) => v + input);
      setError(null);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>
        {label}:{" "}
        <Text color="cyan">
          {value || "0"}
        </Text>
        <Text color="cyan">▋</Text>
      </Text>
      {error && (
        <Box marginTop={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">
          Enter a number{min > -Infinity ? ` (min: ${format(min)})` : ""}
          {max < Infinity ? ` (max: ${format(max)})` : ""}, Enter to confirm
        </Text>
      </Box>
    </Box>
  );
}
