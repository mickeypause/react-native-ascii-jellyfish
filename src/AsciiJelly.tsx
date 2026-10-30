import { useEffect, useMemo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import {
  AlphaType,
  Canvas,
  ColorType,
  Fill,
  FilterMode,
  ImageShader,
  Shader,
  Skia,
  matchFont,
} from "@shopify/react-native-skia";
import { useFrameCallback, useDerivedValue, useSharedValue } from "react-native-reanimated";
import { ASCII_GLYPHS, asciiShader } from "./asciiShader";
import { CELL_HEIGHT, CELL_WIDTH, createSceneFrame } from "./jellyScene";

const effect = (() => {
  const compiled = Skia.RuntimeEffect.Make(asciiShader);
  if (!compiled) throw new Error("Unable to compile the ASCII jellyfish shader");
  return compiled;
})();

export function AsciiJelly({
  width,
  height,
  paused,
}: {
  width: number;
  height: number;
  paused: boolean;
}) {
  const time = useSharedValue(0);
  const running = useSharedValue(!paused);
  useEffect(() => {
    running.value = !paused;
  }, [paused, running]);
  const frameCallback = useFrameCallback(({ timeSincePreviousFrame }) => {
    if (running.value) {
      const dt = Math.min(timeSincePreviousFrame ?? 16, 100) / 1000;
      time.value += dt;
    }
  }, false);
  useEffect(() => {
    frameCallback.setActive(!paused);
    return () => frameCallback.setActive(false);
  }, [frameCallback, paused]);
  const atlas = useMemo(() => {
    const surface = Skia.Surface.MakeOffscreen(ASCII_GLYPHS.length * 16, 22);
    if (!surface) throw new Error("Unable to create the ASCII glyph atlas");
    const paint = Skia.Paint();
    paint.setColor(Skia.Color("white"));
    paint.setAntiAlias(true);
    const font = matchFont({
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
      fontSize: 18,
    });
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color("transparent"));
    ASCII_GLYPHS.split("").forEach((glyph, i) =>
      canvas.drawText(glyph, i * 16 + 2, 17, paint, font),
    );
    surface.flush();
    // The atlas crosses from the JS-thread surface to Skia's rendering context.
    const image = surface.makeImageSnapshot().makeNonTextureImage();
    if (!image) throw new Error("Unable to read the ASCII glyph atlas");
    return image;
  }, []);
  const field = useDerivedValue(() => {
    const frame = createSceneFrame(width, height, time.value);
    return Skia.Image.MakeImage(
      {
        width: frame.columns,
        height: frame.rows,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      },
      Skia.Data.fromBytes(frame.pixels),
      frame.columns * 4,
    );
  });
  const uniforms = useDerivedValue(() => ({
    resolution: [width, height],
    time: time.value,
    pitch: [CELL_WIDTH, CELL_HEIGHT],
  }));
  return (
    <View
      style={StyleSheet.absoluteFill}
      accessibilityLabel="ASCII jellyfish ocean"
      testID="jelly-ocean"
    >
      <Canvas style={{ width, height }}>
        <Fill>
          <Shader source={effect} uniforms={uniforms}>
            <ImageShader
              image={field}
              fit="none"
              tx="decal"
              ty="decal"
              sampling={{ filter: FilterMode.Nearest }}
            />
            <ImageShader image={atlas} fit="none" tx="clamp" ty="clamp" />
          </Shader>
        </Fill>
      </Canvas>
    </View>
  );
}
