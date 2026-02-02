import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface TextInputProps {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
}

export function TextInput({
  label,
  placeholder = "",
  defaultValue = "",
  onSubmit,
}: TextInputProps) {
  const [value, setValue] = useState(defaultValue);

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>
        {label}:{" "}
        <Text color="cyan">
          {value || <Text color="gray">{placeholder}</Text>}
        </Text>
        <Text color="cyan">▋</Text>
      </Text>
      <Box marginTop={1}>
        <Text color="gray">Type your input, Enter to confirm</Text>
      </Box>
    </Box>
  );
}
