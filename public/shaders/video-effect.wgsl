// video-effect.wgsl
// Real-time video effect: chromatic aberration + animated hue-shift
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_videoTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u : vec4<f32>; // time, (others unused)

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) fragUV: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
  var out: VertexOutput;
  let x = f32(in_vertex_index / 2u) * 4.0 - 1.0;
  let y = f32(in_vertex_index % 2u) * 4.0 - 1.0;
  out.position = vec4<f32>(x, -y, 0.0, 1.0);
  out.fragUV = vec2<f32>((x + 1.0) * 0.5, (y + 1.0) * 0.5);
  return out;
}

// cheap stylized hue shift (small, fast approximation)
fn hueRotateApprox(c: vec3<f32>, angle: f32) -> vec3<f32> {
  let avg = (c.x + c.y + c.z) / 3.0;
  let chroma = c - vec3<f32>(avg, avg, avg);
  let ca = cos(angle);
  let sa = sin(angle);
  let r = chroma.x * ca - chroma.y * sa;
  let g = chroma.x * sa + chroma.y * ca;
  let b = chroma.z;
  return clamp(vec3<f32>(r, g, b) + vec3<f32>(avg, avg, avg), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
  let t = u.x;

  // animated subtle offsets for chromatic effect
  let baseOffset = 0.002;
  let osc = 0.002 * sin(t * 0.8);
  let offs = baseOffset + osc;

  let uvR = fragUV + vec2<f32>( offs,  offs * 0.4);
  let uvG = fragUV;
  let uvB = fragUV - vec2<f32>( offs * 0.6, offs * 0.2);

  let cR = textureSample(u_videoTexture, u_sampler, uvR).rgb;
  let cG = textureSample(u_videoTexture, u_sampler, uvG).rgb;
  let cB = textureSample(u_videoTexture, u_sampler, uvB).rgb;

  // compose channels in a stylized way: use channel components
  let videoColor = vec3<f32>(cR.r, cG.g, cB.b);

  // animated hue-shift amount (small)
  let hueAmt = 0.6 * sin(t * 0.2);

  let shifted = hueRotateApprox(videoColor, hueAmt);

  // subtle desaturation + slight brightness modulation
  let lum = dot(shifted, vec3<f32>(0.2126, 0.7152, 0.0722));
  let desat = mix(shifted, vec3<f32>(lum, lum, lum), 0.12);
  let bright = desat * (1.0 + 0.06 * sin(t * 1.5));

  return vec4<f32>(clamp(bright, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

