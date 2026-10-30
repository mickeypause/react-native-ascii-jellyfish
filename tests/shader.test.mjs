import assert from "node:assert/strict";
import { test } from "node:test";
import CanvasKitInit from "canvaskit-wasm";
import { ASCII_GLYPHS, asciiShader } from "../src/asciiShader.ts";
import { createSceneFrame, jellyPose } from "../src/jellyScene.ts";

test("3D scene is deterministic, bounded, and animated", () => {
  const frame = createSceneFrame(402, 874, 0);
  assert.equal(frame.pixels.length, frame.columns * frame.rows * 4);
  assert.deepEqual(frame.pixels, createSceneFrame(402, 874, 0).pixels);
  assert.notDeepEqual(frame.pixels, createSceneFrame(402, 874, 2).pixels);
  let occupied = 0;
  for (let i = 0; i < frame.pixels.length; i += 4) {
    if (frame.pixels[i] > 10) occupied++;
    assert.equal(frame.pixels[i + 3], 255);
  }
  assert.ok(occupied > 700 && occupied < frame.columns * frame.rows * 0.4);
  const poses = Array.from({ length: 100 }, (_, i) => jellyPose(i / 10, 1.4, 250, 360, 90));
  assert.ok(
    Math.max(...poses.map((p) => p.roll)) - Math.min(...poses.map((p) => p.roll)) > 0.5,
    "Bell must change orientation",
  );
  assert.ok(
    Math.max(...poses.map((p) => p.squeeze)) > 0.95 &&
      Math.min(...poses.map((p) => p.squeeze)) < 0.01,
    "Complete contraction and recovery",
  );
});

test("turns and delayed appendages remain continuous between animation frames", () => {
  for (let time = 0; time < 20; time += 0.75) {
    const a = createSceneFrame(402, 874, time).pixels;
    const b = createSceneFrame(402, 874, time + 1 / 60).pixels;
    let changed = 0,
      occupied = 0;
    for (let i = 0; i < a.length; i += 4) {
      const wasVisible = a[i] > 10,
        isVisible = b[i] > 10;
      if (wasVisible || isVisible) occupied++;
      if (wasVisible !== isVisible) changed++;
    }
    assert.ok(changed / occupied < 0.12, `Discontinuous silhouette at ${time}s`);
  }
});

test("Skia renders animated jellyfish through a transparent glyph atlas", async () => {
  const skia = await CanvasKitInit();
  let error = "";
  const effect = skia.RuntimeEffect.Make(asciiShader, (message) => {
    error = message;
  });
  assert.ok(effect, error);
  const surface = skia.MakeSurface(240, 480);
  assert.ok(surface);
  // H-shaped fixture glyphs exercise atlas coordinates without platform fonts.
  const atlasWidth = ASCII_GLYPHS.length * 16;
  const atlasPixels = new Uint8Array(atlasWidth * 22 * 4);
  for (let glyph = 1; glyph < ASCII_GLYPHS.length; glyph++) {
    for (let y = 3; y < 19; y++)
      for (let x = 3; x < 13; x++) {
        if (x > 4 && x < 11 && y !== 10 && y !== 11) continue;
        const at = (y * atlasWidth + glyph * 16 + x) * 4;
        atlasPixels.fill(255, at, at + 4);
      }
  }
  const atlas = skia.MakeImage(
    {
      width: atlasWidth,
      height: 22,
      colorType: skia.ColorType.RGBA_8888,
      alphaType: skia.AlphaType.Unpremul,
      colorSpace: skia.ColorSpace.SRGB,
    },
    atlasPixels,
    atlasWidth * 4,
  );
  const child = atlas.makeShaderOptions(
    skia.TileMode.Clamp,
    skia.TileMode.Clamp,
    skia.FilterMode.Nearest,
    skia.MipmapMode.None,
  );
  const paint = new skia.Paint();
  function frame(time, source = effect) {
    const scene = createSceneFrame(240, 480, time);
    const field = skia.MakeImage(
      {
        width: scene.columns,
        height: scene.rows,
        colorType: skia.ColorType.RGBA_8888,
        alphaType: skia.AlphaType.Unpremul,
        colorSpace: skia.ColorSpace.SRGB,
      },
      scene.pixels,
      scene.columns * 4,
    );
    const radiance = field.makeShaderOptions(
      skia.TileMode.Decal,
      skia.TileMode.Decal,
      skia.FilterMode.Nearest,
      skia.MipmapMode.None,
    );
    const shader = source.makeShaderWithChildren([240, 480, 4.6, 6.6, time], [radiance, child]);
    paint.setShader(shader);
    surface.getCanvas().drawPaint(paint);
    surface.flush();
    const image = surface.makeImageSnapshot();
    const pixels = image.readPixels(0, 0, {
      width: 240,
      height: 480,
      colorType: skia.ColorType.RGBA_8888,
      alphaType: skia.AlphaType.Unpremul,
      colorSpace: skia.ColorSpace.SRGB,
    });
    const copy = new Uint8Array(pixels);
    image.delete();
    shader.delete();
    radiance.delete();
    field.delete();
    return copy;
  }
  const initial = frame(0);
  assert.ok(
    initial.some((value, i) => i % 4 !== 3 && value > 75),
    "Jellyfish must be visible",
  );
  assert.notDeepEqual(initial, frame(2), "Time must animate geometry");
  assert.deepEqual(initial, frame(0), "Frozen time must be deterministic");
  const broken = skia.RuntimeEffect.Make(
    asciiShader
      .replace("index * 16. + local.x * 16., local.y * 22.", "-1000., -1000.")
      .replace("nextIndex * 16. + local.x * 16., local.y * 22.", "-1000., -1000."),
  );
  assert.ok(broken);
  const withoutGlyphs = frame(0, broken);
  const bright = (pixels) =>
    pixels.reduce((count, value, i) => count + (i % 4 === 0 && value > 100 ? 1 : 0), 0);
  assert.ok(
    bright(initial) > bright(withoutGlyphs) + 100,
    "Bright strokes must come from glyph sampling",
  );
  paint.delete();
  child.delete();
  atlas.delete();
  surface.delete();
  effect.delete();
  broken.delete();
});
