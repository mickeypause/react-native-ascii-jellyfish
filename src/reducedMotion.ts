import type { AccessibilityInfo } from "react-native";

export function observeReducedMotion(
  accessibility: Pick<typeof AccessibilityInfo, "isReduceMotionEnabled" | "addEventListener">,
  onChange: (enabled: boolean) => void,
) {
  let active = true;
  let changed = false;
  const subscription = accessibility.addEventListener("reduceMotionChanged", (enabled) => {
    changed = true;
    if (active) onChange(enabled);
  });
  accessibility.isReduceMotionEnabled().then(
    (enabled) => {
      if (active && !changed) onChange(enabled);
    },
    () => {
      // Keep the initial paused state if the native setting cannot be read.
    },
  );
  return () => {
    active = false;
    subscription.remove();
  };
}
