import { Box, Text, useInput } from "ink";
import { useState } from "react";

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format?: (value: number) => string;
  onSubmit: (value: number) => void;
}

export function Slider({ label, min, max, step, defaultValue, format = (v) => v.toString(), onSubmit }: SliderProps) {
  const [value, setValue] = useState(defaultValue);

  useInput((_input, key) => {
    if (key.leftArrow) {
      setValue((v) => Math.max(min, v - step));
    } else if (key.rightArrow) {
      setValue((v) => Math.min(max, v + step));
    } else if (key.return) {
      onSubmit(value);
    }
  });

  const percentage = ((value - min) / (max - min)) * 100;
  const barWidth = 30;
  const filledWidth = Math.round((percentage / 100) * barWidth);

  return (
    <Box flexDirection="column">
      <Text>
        {label}: <Text color="cyan">{format(value)}</Text>
      </Text>
      <Box marginTop={1}>
        <Text>[</Text>
        <Text color="cyan">{"█".repeat(filledWidth)}</Text>
        <Text color="gray">{"░".repeat(barWidth - filledWidth)}</Text>
        <Text>]</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">←→ to adjust, Enter to confirm</Text>
      </Box>
    </Box>
  );
}
