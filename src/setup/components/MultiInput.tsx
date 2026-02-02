import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface MultiInputProps {
  label: string;
  placeholder?: string;
  defaultValues?: string[];
  onSubmit: (values: string[]) => void;
}

export function MultiInput({
  label,
  placeholder = "Type and press Enter to add, Enter on empty to finish",
  defaultValues = [],
  onSubmit,
}: MultiInputProps) {
  const [values, setValues] = useState<string[]>(defaultValues);
  const [currentInput, setCurrentInput] = useState("");

  useInput((input, key) => {
    if (key.return) {
      if (currentInput.trim()) {
        setValues((v) => [...v, currentInput.trim()]);
        setCurrentInput("");
      } else {
        onSubmit(values);
      }
    } else if (key.backspace || key.delete) {
      if (currentInput.length === 0 && values.length > 0) {
        setValues((v) => v.slice(0, -1));
      } else {
        setCurrentInput((v) => v.slice(0, -1));
      }
    } else if (input && !key.ctrl && !key.meta) {
      setCurrentInput((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{label}:</Text>
      <Box marginTop={1} flexDirection="column">
        {values.map((v, i) => (
          <Text key={`value-${i}-${v}`} color="green">
            • {v}
          </Text>
        ))}
        <Text>
          <Text color="cyan">+ {currentInput}</Text>
          <Text color="cyan">▋</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">{placeholder}</Text>
      </Box>
    </Box>
  );
}
