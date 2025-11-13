// video-stained.wgsl
// Stained-Glass Psychedelic: mosaic/patchwork colorization with mild refraction
// Bindings match other video shaders so we can reuse the same bind group
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_videoTexture: texture_2d<f32>;

struct Uniforms {
  resolutions: vec4<f32>, // canvas.xy, source.xy
  config: vec4<f32>,      // time, rippleCount, mode, unused
  stainedParams: vec4<f32>, // cellSize, edgeWidth, refraction, colorStrength
  // ripples follow in buffer (we don't read them here)
};
@group(0) @binding(2) var<uniform> u : Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) fragUV: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
  var out: VertexOutput;
  let x = f32(idx / 2u) * 4.0 - 1.0;
  let y = f32(idx % 2u) * 4.0 - 1.0;
  out.position = vec4<f32>(x, -y, 0.0, 1.0);
  out.fragUV = vec2<f32>((x + 1.0) * 0.5, (y + 1.0) * 0.5);
  return out;
}

fn hash21(p: vec2<f32>) -> f32 {
  let dotp = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(dotp) * 43758.5453);
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
  let x = fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
  let y = fract(sin(dot(p, vec2<f32>(269.5, 183.3))) * 24634.6345);
  return vec2<f32>(x, y);
}

// RGB <-> HSV helpers
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y)/(6.0*d + e)), d/(q.x + e), q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
  let t = u.config.x;

  // Read stained params from uniform
  let baseCell = u.stainedParams.x;                         // cell size
  let edgeWidth = u.stainedParams.y;                        // lead edge width
  let refractStrength = u.stainedParams.z;                  // refraction amount
  let colorStrength = u.stainedParams.w;                    // multiplier for color adjustments

  // Grid setup (UV space)
  let cellSize = baseCell * (1.0 + 0.15*sin(t)); // breathe subtly
  let uv = fragUV;

  // Which cell are we in?
  let cell = floor(uv / cellSize);
  let cellOrigin = cell * cellSize;
  let cellCenter = cellOrigin + cellSize * 0.5;

  // Jitter the sampling point slightly per-cell using a hash
  let j = hash22(cell + vec2<f32>(floor(t*0.2)));
  let jitter = (j - 0.5) * (cellSize * 0.35);
  let sampleUV = clamp(cellCenter + jitter, vec2<f32>(0.0), vec2<f32>(1.0));

  // Slight refraction toward the cell center to mimic glass thickness
  let toCenter = cellCenter - uv;
  let distCenter = length(toCenter) / (cellSize*0.5 + 1e-5);
  let refractAmt = refractStrength * smoothstep(0.0, 1.0, 1.0 - distCenter);
  let refractedUV = clamp(sampleUV + normalize(toCenter) * refractAmt, vec2<f32>(0.0), vec2<f32>(1.0));

  // Sample the underlying video at refracted location
  var color = textureSample(u_videoTexture, u_sampler, refractedUV).rgb;

  // Per-cell palette tweak: hue and slight saturation boost
  var hsv = rgb2hsv(color);
  let cellHueJ = hash21(cell + vec2<f32>(13.2, 7.1));
  hsv.x = fract(hsv.x + 0.08*cellHueJ + 0.05*sin(t*0.3 + cellHueJ*6.28318) * colorStrength);
  hsv.y = clamp(hsv.y * (1.0 + 0.15*(cellHueJ - 0.5) + 0.1*sin(t + cellHueJ*5.0) * colorStrength), 0.0, 1.2);
  color = hsv2rgb(hsv);

  // Soft cell border (lead lines). Thicker near edges of the cell
  let fuv = fract(uv / cellSize);
  let edge = min(min(fuv.x, 1.0 - fuv.x), min(fuv.y, 1.0 - fuv.y));
  let line = smoothstep(0.0, edgeWidth, edge) - smoothstep(edgeWidth, edgeWidth*1.6, edge);
  let lead = mix(vec3<f32>(0.05, 0.05, 0.06), vec3<f32>(0.12, 0.12, 0.14), 0.5 + 0.5*sin(t*1.3));
  color = mix(lead, color, clamp(line*10.0, 0.0, 1.0));

  // Slight bloom-like lift toward highlights
  let lum = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
  color += 0.08 * smoothstep(0.65, 1.0, lum);

  // Gentle vignette to focus center
  let v = length(fragUV - vec2<f32>(0.5));
  color *= (1.0 - 0.5 * smoothstep(0.55, 0.85, v));

  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
