// Alternate liquid shader v2: curl-like flow field + complementary hue shift
// Bindings match other compute liquid shaders so it can be reused by the renderer
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>;      // time, rippleCount, resolutionX, resolutionY
  ripples: array<vec4<f32>, 50>; // x, y, startTime, unused
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// Helpers: RGB <-> HSV
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y)/(6.0*d + e)), d/(q.x + e), q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// Simple pseudo-random hash for small kernels
fn hash11(x: f32) -> f32 { return fract(sin(x) * 43758.5453123); }
fn hash21(p: vec2<f32>) -> f32 { return hash11(dot(p, vec2<f32>(127.1, 311.7))); }

// 2D noise (cheap)
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  // smoothstep interpolation
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i + vec2<f32>(0.0,0.0));
  let b = hash21(i + vec2<f32>(1.0,0.0));
  let c = hash21(i + vec2<f32>(0.0,1.0));
  let d = hash21(i + vec2<f32>(1.0,1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Flow field based on multiple scales of noise to get curl-like patterns
fn flowField(p: vec2<f32>, t: f32) -> vec2<f32> {
  // base frequencies
  let f1 = noise(p * 6.0 + t * 0.12);
  let f2 = noise(p * 12.0 - t * 0.18);
  let f3 = noise(p * 24.0 + t * 0.33);
  // make a pseudo-curl by sampling noise rotated
  let angle = (f1 - f2) * 6.28318 + f3 * 0.8;
  return vec2<f32>(cos(angle), sin(angle)) * (0.005 + 0.01 * f1);
}

// Small helper to compute average hue of a kxk neighborhood (cheap: 3x3)
fn avgHue(centerUV: vec2<f32>, texRes: vec2<f32>) -> f32 {
  let inv = 1.0 / texRes;
  var sumH = 0.0;
  var count = 0.0;
  for (var oy: i32 = -1; oy <= 1; oy = oy + 1) {
    for (var ox: i32 = -1; ox <= 1; ox = ox + 1) {
      let s = clamp(centerUV + vec2<f32>(f32(ox), f32(oy)) * inv, vec2<f32>(0.0), vec2<f32>(1.0));
      let c = textureSampleLevel(readTexture, u_sampler, s, 0.0).rgb;
      let hsv = rgb2hsv(c);
      sumH = sumH + hsv.x;
      count = count + 1.0;
    }
  }
  return sumH / count;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texSize = u.config.zw;
  let resolution = texSize;
  let uv = vec2<f32>(global_id.xy) / resolution;
  let t = u.config.x;

  // base depth and simple ambient flow based on depth
  let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
  let bgFactor = 1.0 - smoothstep(0.0, 0.2, depth);

  // compose flow from multiple scales and ripples
  var flow = vec2<f32>(0.0, 0.0);
  flow = flow + flowField(uv * 1.0, t) * (0.7 + 0.8 * bgFactor);
  flow = flow + flowField(uv * 0.5 + vec2<f32>(12.0, 5.0), t * 1.1) * 0.5;

  // incorporate ripples: stronger local displacement around ripple centers
  let rippleCount = u32(u.config.y);
  for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
    let rp = u.ripples[i];
    let rc = rp.xy;
    let rt = rp.z;
    let dt = t - rt;
    if (dt > 0.0 && dt < 3.5) {
      let d = distance(uv, rc);
      let rippleStrength = 0.02 * exp(-d * 8.0) * (1.0 - dt / 3.5);
      let dir = normalize(uv - rc + vec2<f32>(0.0001, 0.0002));
      flow = flow + dir * rippleStrength;
    }
  }

  // sample displaced color
  let sampleUV = clamp(uv + flow, vec2<f32>(0.0), vec2<f32>(1.0));
  let baseColor = textureSampleLevel(readTexture, u_sampler, sampleUV, 0.0).rgb;

  // compute neighborhood avg hue and derive complementary shift
  let hAvg = avgHue(sampleUV, resolution);
  // complementary hue (opposite hue) with time modulation
  let compHue = fract(hAvg + 0.5 + 0.06 * sin(t * 0.8 + hAvg * 6.28318));

  // convert base color to hsv and nudge towards complementary selectivey
  var hsv = rgb2hsv(baseColor);
  // preserve luminance, reduce saturation slightly before remapping
  let satBoost = 1.0 + 0.15 * (1.0 - depth);
  let hueMix = 0.45 * (1.0 - smoothstep(0.02, 0.15, length(flow)) ); // less hue swap where flow strong
  hsv.x = fract(mix(hsv.x, compHue, hueMix));
  hsv.y = clamp(hsv.y * satBoost, 0.0, 1.0);
  hsv.z = clamp(hsv.z * (0.95 + 0.1 * bgFactor), 0.0, 1.0);

  var finalRGB = hsv2rgb(hsv);

  // subtle color grading: add depth-based tint and gentle filmic rolloff
  let depthTint = mix(vec3<f32>(1.03, 1.0, 0.96), vec3<f32>(0.92, 0.95, 1.05), depth);
  finalRGB = clamp(finalRGB * depthTint, vec3<f32>(0.0), vec3<f32>(1.0));

  // lightweight edge softening to reduce artifacting
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  finalRGB = mix(vec3<f32>(0.02, 0.02, 0.03), finalRGB, smoothstep(0.01, 0.08, edge));

  textureStore(writeTexture, global_id.xy, vec4<f32>(finalRGB, 1.0));

  // write depth (slightly blurred via sampling along flow)
  let depthSampleUV = clamp(uv + flow * 0.5, vec2<f32>(0.0), vec2<f32>(1.0));
  let newDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, depthSampleUV, 0.0).r;
  textureStore(writeDepthTexture, global_id.xy, vec4<f32>(newDepth, 0.0, 0.0, 0.0));
}

