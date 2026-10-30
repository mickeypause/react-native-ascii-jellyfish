export const ASCII_GLYPHS = " .,:;!i~+ox%tX$S8#@";

export const asciiShader = `
uniform float2 resolution;
uniform float2 pitch;
uniform float time;
uniform shader radiance;
uniform shader glyphs;

float hash(float2 p) { return fract(sin(dot(p, float2(127.1,311.7))) * 43758.5453); }
float3 tint(float hue) {
  return mix(float3(0.52,0.76,0.81), float3(0.66,0.56,0.87), smoothstep(0.25,0.85,hue));
}
half4 main(float2 xy) {
  float2 cell = floor(xy / pitch);
  float2 local = fract(xy / pitch);
  float4 data = radiance.eval(cell + 0.5);
  float light = data.r;
  float random = hash(cell);
  float cycle = time * 1.8 + random * 7.;
  float shimmer = hash(cell + floor(cycle) * 11.7);
  float next = hash(cell + (floor(cycle) + 1.) * 11.7);
  float index = floor(clamp(3. + light * 6. + shimmer * 10., 1., 18.));
  float nextIndex = floor(clamp(3. + light * 6. + next * 10., 1., 18.));
  float glyphA = glyphs.eval(float2(index * 16. + local.x * 16., local.y * 22.)).a;
  float glyphB = glyphs.eval(float2(nextIndex * 16. + local.x * 16., local.y * 22.)).a;
  float glyph = mix(glyphA,glyphB,smoothstep(0.45,1.,fract(cycle)));
  float3 color = float3(0.012,0.022,0.027);
  float grid = step(0.96, fract(xy.x / 18.4)) + step(0.96, fract(xy.y / 19.8));
  color += float3(0.009,0.015,0.018) * grid * 0.48;
  float3 glow = float3(0.);
  for (int n = 0; n < 8; n++) {
    float angle = float(n) * 0.785398;
    float2 offset = float2(cos(angle), sin(angle));
    float4 near = radiance.eval(cell + 0.5 + offset * 1.7);
    float4 far = radiance.eval(cell + 0.5 + offset * 6.);
    glow += tint(near.g) * near.r * 0.020 + tint(far.g) * far.r * 0.007;
  }
  float3 ink = mix(tint(data.g),float3(0.88,0.95,0.97),smoothstep(0.53,0.96,light)*0.85);
  float alive = step(0.012, light);
  float tile = step(0.09, local.x) * step(local.x,0.91) * step(0.06,local.y) * step(local.y,0.94);
  float brightness = pow(light, 0.72) * mix(0.78,1.12,data.b);
  color += ink * brightness * glyph * (1.05 + random * 0.38) * alive;
  color += ink * brightness * tile * 0.12 * alive;
  color += glow;
  for (int n = 1; n <= 4; n++) {
    float f = float(n);
    float4 wake = radiance.eval(cell + 0.5 + float2(f * 0.35, -f * 2.3));
    color += tint(wake.g) * wake.r * 0.008;
  }
  float2 dustUv = (xy + float2(sin(time * 0.13) * 4., time * 1.6)) / pitch;
  float dustRandom = hash(floor(dustUv));
  float dust = step(0.9982, dustRandom) * (0.5 + 0.5 * sin(time * 0.45 + dustRandom * 120.));
  float dustGlyph = glyphs.eval(float2(16. + fract(dustUv.x) * 16., fract(dustUv.y) * 22.)).a;
  color += float3(0.20,0.31,0.35) * dust * dustGlyph * 0.45;
  float vignette = 1. - 0.26 * pow(length((xy / resolution - 0.5) * float2(1.,0.72)), 1.3);
  return half4(color * vignette, 1.);
}
`;
