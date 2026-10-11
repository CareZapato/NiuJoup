import type { ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import { COLORS, FONT } from '../theme';

export function Txt({ children, size = 18, color = COLORS.text, style, title, numberOfLines }: { children: ReactNode; size?: number; color?: string; style?: TextStyle; title?: boolean; numberOfLines?: number }) {
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontFamily: title ? FONT.title : FONT.body, fontSize: title ? size * 0.6 : size, color, textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 0 }, style]}>
      {children}
    </Text>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function Bar({ value, max, color, height = 8, width, bg = '#222244' }: { value: number; max: number; color: string; height?: number; width?: number | `${number}%`; bg?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={{ height, width: width ?? '100%', backgroundColor: bg, borderWidth: 1, borderColor: '#000' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color }} />
    </View>
  );
}

export function PixelButton({ label, onPress, disabled, active, small, testID }: { label: string; onPress: () => void; disabled?: boolean; active?: boolean; small?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.btn, small && styles.btnSmall, active && styles.btnActive, disabled && styles.btnDisabled, pressed && !disabled && styles.btnPressed]}
    >
      <Txt size={small ? 16 : 22} color={disabled ? COLORS.dim : COLORS.text}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: COLORS.panel, borderWidth: 2, borderColor: COLORS.borderDim, padding: 8 },
  btn: { borderWidth: 2, borderColor: COLORS.border, backgroundColor: '#1a1c3a', paddingVertical: 6, paddingHorizontal: 14, marginVertical: 3, alignItems: 'center' },
  btnSmall: { paddingVertical: 2, paddingHorizontal: 8, marginVertical: 2, marginHorizontal: 2 },
  btnActive: { backgroundColor: '#3a3a7a' },
  btnDisabled: { borderColor: '#444466', backgroundColor: '#14142a' },
  btnPressed: { backgroundColor: '#5a4a1a' },
});
