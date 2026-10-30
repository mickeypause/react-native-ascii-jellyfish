import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState, StyleSheet, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AsciiJelly } from "./src/AsciiJelly";
import { observeReducedMotion } from "./src/reducedMotion";

export default function App() {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(true);
  const [background, setBackground] = useState(AppState.currentState !== "active");
  useEffect(() => observeReducedMotion(AccessibilityInfo, setReduceMotion), []);
  useEffect(() => {
    const state = AppState.addEventListener("change", (next) => setBackground(next !== "active"));
    return () => state.remove();
  }, []);
  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <AsciiJelly width={width} height={height} paused={reduceMotion || background} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#04070a" },
});
