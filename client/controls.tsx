import { Pressable, Text } from "react-native";
import type { Styles } from "./styles.ts";

// Small themed pieces shared by the Planning and Discover screens.

export function Button({ styles, label, onPress, disabled }: { styles: Styles; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? styles.buttonDisabled : styles.button}
    >
      <Text style={disabled ? styles.text.buttonDisabled : styles.text.button}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ styles, text }: { styles: Styles; text: string }) {
  return <Text style={styles.text.pill}>{text}</Text>;
}
