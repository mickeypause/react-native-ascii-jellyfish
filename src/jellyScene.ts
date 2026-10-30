export const CELL_WIDTH = 4.6;
export const CELL_HEIGHT = 6.6;

const BELL_SEGMENTS = [112, 84, 64].map((count) =>
  Array.from({ length: count }, (_, segment) => {
    const angle = (segment / count) * Math.PI * 2;
    return {
      ca: Math.cos(angle),
      sa: Math.sin(angle),
      ribAngle: angle * 12,
      rimWave: Math.cos(angle * 12),
    };
  }),
);
const BELL_RINGS = [24, 18, 13].map((count) =>
  Array.from({ length: count + 1 }, (_, ring) => {
    const theta = (ring / count) * Math.PI * 0.525;
    const radial = Math.sin(theta);
    return {
      radial,
      raised: Math.cos(theta),
      scallopWeight: Math.pow(radial, 12),
      rim: Math.pow(radial, 20),
    };
  }),
);
export interface SceneFrame {
  pixels: Uint8Array;
  columns: number;
  rows: number;
}

interface Pose {
  x: number;
  y: number;
  radius: number;
  roll: number;
  pitch: number;
  yaw: number;
  squeeze: number;
  phase: number;
}

export function jellyPose(time: number, seed: number, x: number, y: number, radius: number): Pose {
  "worklet";
  const phase = time * (1.95 + seed * 0.023) + seed;
  // A short power stroke followed by a longer, softer recovery.
  const squeeze = Math.pow(0.5 + 0.5 * Math.sin(phase), 3);
  const roll = 0.12 + 0.6 * Math.sin(time * 0.47 + seed * 1.8);
  const kick = 0.23 * squeeze + 0.07 * Math.sin(phase - 0.7);
  return {
    x:
      x +
      radius *
        (0.27 * Math.sin(time * 0.27 + seed) +
          0.12 * Math.sin(time * 0.63 + seed) +
          kick * Math.sin(roll)),
    y: y + radius * (0.19 * Math.sin(time * 0.38 + seed) - kick * Math.cos(roll)),
    radius,
    roll,
    pitch: -0.12 + 0.39 * Math.sin(time * 0.48 + seed),
    yaw: time * 0.24 + seed,
    squeeze,
    phase,
  };
}

// Low-resolution radiance/depth raster. Skia maps every occupied cell to a glyph.
export function createSceneFrame(width: number, height: number, time: number): SceneFrame {
  "worklet";
  const columns = Math.ceil(width / CELL_WIDTH);
  const rows = Math.ceil(height / CELL_HEIGHT);
  const pixels = new Uint8Array(columns * rows * 4);
  const depths = new Float32Array(columns * rows);
  depths.fill(-10000);
  for (let n = 3; n < pixels.length; n += 4) pixels[n] = 255;

  const compact = height < width;
  const top = compact ? height * 0.22 : height * 0.17;
  const span = compact ? height * 0.4 : height * 0.56;
  const scale = Math.min(width, height * 0.58);

  for (let creature = 0; creature < 3; creature++) {
    const seed = [1.4, 5.8, 10.2][creature];
    const baseX = width * [0.6, 0.25, 0.19][creature];
    const baseY = top + span * [0.32, 0.85, -0.06][creature];
    const radius = scale * [0.24, 0.155, 0.115][creature] * 1.3;
    const pose = jellyPose(time, seed, baseX, baseY, radius);
    const cy = Math.cos(pose.yaw),
      sy = Math.sin(pose.yaw);
    const hue = [34, 205, 104][creature];
    const depthOffset = [1, 0, -1][creature];
    // Roots use the current pose; tips retain the turn and stroke from 1.45s ago.
    const history = new Float32Array(107 * 8);
    for (let step = 0; step <= 106; step++) {
      const s = step / 106;
      const past = jellyPose(time - s * s * 1.45, seed, baseX, baseY, radius);
      const at = step * 8;
      history[at] = past.x;
      history[at + 1] = past.y;
      history[at + 2] = Math.cos(past.roll);
      history[at + 3] = Math.sin(past.roll);
      history[at + 4] = Math.cos(past.pitch);
      history[at + 5] = Math.sin(past.pitch);
      history[at + 6] = Math.cos(past.yaw);
      history[at + 7] = Math.sin(past.yaw);
    }

    const rootRollCos = history[2],
      rootRollSin = history[3];
    const rootPitchCos = history[4],
      rootPitchSin = history[5];
    function plot(x: number, y: number, z: number, light: number, trailStep = 0) {
      const at = trailStep * 8;
      const yawCos = history[at + 6],
        yawSin = history[at + 7];
      const pitchCos = history[at + 4],
        pitchSin = history[at + 5];
      const rollCos = history[at + 2],
        rollSin = history[at + 3];
      const rx = x * yawCos + z * yawSin;
      const rz = z * yawCos - x * yawSin;
      const ry = y * pitchCos - rz * pitchSin;
      const pz = y * pitchSin + rz * pitchCos;
      const perspective = 4.8 / (4.8 - pz * 0.3);
      const px = history[at] + (rx * rollCos - ry * rollSin) * radius * perspective;
      const py = history[at + 1] + (rx * rollSin + ry * rollCos) * radius * perspective;
      const col = Math.floor(px / CELL_WIDTH);
      const row = Math.floor(py / CELL_HEIGHT);
      const depth = pz + depthOffset * 3;
      if (col < 0 || col >= columns || row < 0 || row >= rows) return;
      const cell = row * columns + col;
      if (depth < depths[cell] - 0.06) return;
      const value = Math.min(255, Math.max(0, light * 255));
      if (depth > depths[cell] + 0.06 || value > pixels[cell * 4]) {
        depths[cell] = depth;
        pixels[cell * 4] = value;
        pixels[cell * 4 + 1] = hue;
        pixels[cell * 4 + 2] = Math.min(255, Math.max(0, 128 + pz * 40));
      }
    }

    // Bell shell: actual radial surface, including a scalloped rim and lit ribs.
    const bellWidth = 1.04 - pose.squeeze * 0.25;
    const bellHeight = 0.76 + pose.squeeze * 0.2;
    const pulse = Math.sin(pose.phase);
    const segments = BELL_SEGMENTS[creature],
      rings = BELL_RINGS[creature];
    const ribs = new Float64Array(segments.length);
    for (let segment = 0; segment < segments.length; segment++) {
      ribs[segment] = Math.pow(0.5 + 0.5 * Math.cos(segments[segment].ribAngle + 0.3 * pulse), 10);
    }
    for (let ring = 0; ring < rings.length; ring++) {
      const { radial, raised, scallopWeight, rim } = rings[ring];
      for (let segment = 0; segment < segments.length; segment++) {
        const { ca, sa, rimWave } = segments[segment];
        const rib = ribs[segment];
        const r = radial * bellWidth * (1 + rib * 0.025);
        const scallop = scallopWeight * (0.06 * rimWave + 0.025 * pulse);
        const x = r * ca,
          y = -bellHeight * raised + scallop,
          z = r * sa * 0.72;
        const nx = (radial * ca) / bellWidth;
        const ny = -raised / bellHeight;
        const nz = (radial * sa) / 0.72;
        const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const rx = nx * cy + nz * sy,
          rz = nz * cy - nx * sy;
        const ry = ny * rootPitchCos - rz * rootPitchSin;
        const front = (ny * rootPitchSin + rz * rootPitchCos) / normalLength;
        const worldX = (rx * rootRollCos - ry * rootRollSin) / normalLength;
        const worldY = (rx * rootRollSin + ry * rootRollCos) / normalLength;
        const diffuse = Math.max(0, -0.35 * worldX - 0.55 * worldY + 0.75 * front);
        const edge = Math.pow(1 - Math.abs(front), 4);
        const light =
          (0.2 + 0.54 * diffuse + 0.15 * rib + 0.35 * rim + 0.1 * edge) *
          (front < -0.15 ? 0.64 : 1);
        plot(x, y, z, light);
      }
    }

    // Oral arms are broad, folded ribbons; their delayed stroke travels down the body.
    for (let arm = 0; arm < 4; arm++) {
      const angle = (arm / 4) * Math.PI * 2 + seed;
      const facing = 0.57 + 0.43 * Math.max(0, Math.sin(angle - pose.yaw));
      const length = 1.62 + 0.33 * Math.sin(arm * 2.4 + seed);
      const steps = [52, 38, 28][creature];
      for (let step = 0; step <= steps; step++) {
        const s = step / steps;
        const lag = time - s * 1.1;
        const wave = lag * 1.35 + seed + arm * 0.94;
        const spread = 0.16 + s * 0.64;
        const cx = Math.cos(angle) * 0.37 + Math.sin(s * 5.2 - wave) * spread;
        const cz = Math.sin(angle) * 0.31 + Math.cos(s * 4.7 - wave * 0.8) * s * 0.51;
        const yy = 0.015 + s * length + Math.sin(s * 6.4 - wave) * s * 0.23;
        const ribbonWidth =
          (0.095 + 0.055 * Math.sin(s * 22 - wave * 2)) * Math.pow(1 - s, 0.55) + 0.012;
        const fold = s * 16 - wave;
        const foldCos = Math.cos(fold),
          foldSin = Math.sin(fold);
        for (let across = -2; across <= 2; across++) {
          const u = across / 2;
          plot(
            cx + u * ribbonWidth * foldCos,
            yy + u * ribbonWidth * 0.23,
            cz + u * ribbonWidth * foldSin,
            (0.45 + 0.24 * Math.cos(fold + u)) * (1 - s * 0.53) * facing,
            Math.round(s * 106),
          );
        }
      }
    }

    // Fine filaments retain their own phase and curl out into the surrounding current.
    for (let strand = 0; strand < 11; strand++) {
      const angle = (strand / 11) * Math.PI * 2 + seed;
      const ca = Math.cos(angle),
        sa = Math.sin(angle);
      const facing = 0.59 + 0.41 * Math.max(0, Math.sin(angle - pose.yaw));
      const length = 1.65 + 0.79 * (0.5 + 0.5 * Math.sin(strand * 4.7 + seed));
      const steps = [80, 60, 44][creature];
      for (let step = 0; step <= steps; step++) {
        const s = step / steps;
        const delayedPhase = pose.phase - s * 2.1;
        const root = 1.04 - Math.pow(0.5 + 0.5 * Math.sin(delayedPhase), 3) * 0.25;
        const current = time * 0.83 + seed + strand * 0.43;
        const curl = Math.sin(s * 5.8 - current);
        const x =
          ca * root * 0.86 + s * s * (0.72 * curl + 0.24 * Math.sin(s * 10.2 - current * 1.23));
        const y = 0.03 + s * length + s * s * 0.5 * Math.cos(s * 6.1 - current);
        const z = sa * root * 0.62 + s * 0.42 * Math.sin(s * 5.4 - current * 0.78);
        const fade = Math.pow(1 - s, 0.47);
        plot(
          x,
          y,
          z,
          (0.38 + 0.25 * (0.5 + 0.5 * Math.cos(s * 24 - delayedPhase + strand))) * fade * facing,
          Math.round(s * 106),
        );
      }
    }
  }
  return { pixels, columns, rows };
}
