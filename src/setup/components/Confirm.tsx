import { Box, Text, useInput } from "ink";
import { useState } from "react";

interface ConfirmProps {
  message: string;
  defaultValue?: boolean;
  onConfirm: (confirmed: boolean) => void;
}

export function Confirm({ message, defaultValue = true, onConfirm }: ConfirmProps) {
  const [selected, setSelected] = useState(defaultValue);

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow || input === "y" || input === "n") {
      if (input === "y") {
        setSelected(true);
      } else if (input === "n") {
        setSelected(false);
      } else {
        setSelected((s) => !s);
      }
    } else if (key.return) {
      onConfirm(selected);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{message}</Text>
      <Box marginTop={1}>
        <Text color={selected ? "green" : "gray"}>{selected ? "❯ " : "  "}Yes</Text>
        <Text> / </Text>
        <Text color={!selected ? "red" : "gray"}>{!selected ? "❯ " : "  "}No</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">←→ or y/n to select, Enter to confirm</Text>
      </Box>
    </Box>
  );
}
