import { Box, Text, useInput } from "ink";
import { useState } from "react";

interface MaskedInputProps {
  label: string;
  placeholder?: string;
  masked?: boolean;
  onSubmit: (value: string) => void;
  validate?: (value: string) => string | null; // Returns error message or null
}

export function MaskedInput({ label, placeholder = "", masked = false, onSubmit, validate }: MaskedInputProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.return) {
      if (validate) {
        const validationError = validate(value);
        if (validationError) {
          setError(validationError);
          return;
        }
      }
      onSubmit(value);
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setError(null);
    } else if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
      setError(null);
    }
  });

  const displayValue = masked ? "•".repeat(value.length) : value;

  return (
    <Box flexDirection="column">
      <Text>
        {label}: <Text color="cyan">{displayValue || <Text color="gray">{placeholder}</Text>}</Text>
        <Text color="cyan">▋</Text>
      </Text>
      {error && (
        <Box marginTop={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Type your input, Enter to confirm</Text>
      </Box>
    </Box>
  );
}
