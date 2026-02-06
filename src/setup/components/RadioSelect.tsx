import { Box, Text, useInput } from "ink";
import { useState } from "react";

interface Option<T> {
  label: string;
  value: T;
  description?: string;
}

interface RadioSelectProps<T> {
  options: Option<T>[];
  onSelect: (value: T) => void;
  defaultValue?: T;
}

export function RadioSelect<T>({ options, onSelect, defaultValue }: RadioSelectProps<T>) {
  const defaultIndex = defaultValue ? options.findIndex((o) => o.value === defaultValue) : 0;
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex >= 0 ? defaultIndex : 0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : options.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => (i < options.length - 1 ? i + 1 : 0));
    } else if (key.return) {
      const selected = options[selectedIndex];
      if (selected) {
        onSelect(selected.value);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((option, index) => (
        <Box key={`option-${index}`}>
          <Text color={index === selectedIndex ? "cyan" : "white"}>
            {index === selectedIndex ? "❯ " : "  "}
            {option.label}
          </Text>
          {option.description && index === selectedIndex && <Text color="gray"> - {option.description}</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="gray">↑↓ to move, Enter to select</Text>
      </Box>
    </Box>
  );
}
