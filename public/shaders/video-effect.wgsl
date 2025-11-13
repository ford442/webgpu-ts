// video-effect.wgsl
// PSYCHEDELIC VIDEO EFFECT: Kaleidoscope + Color cycling + Feedback warping
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_videoTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u : vec4<f32>; // time, (others unused)

struct VertexOutput {
  @builtin(position) position: vec4<f32>;
  @location(0) fragUV: vec2<f32>;
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

// Kaleidoscope effect with rotating mirrors
fn kaleidoscope(uv: vec2<f32>, segments: f32, rotation: f32) -> vec2<f32> {
  let center = uv - vec2<f32>(0.5);
  let r = length(center);
  var angle = atan2(center.y, center.x) + rotation;
  
  let segmentAngle = 6.28318530718 / segments;
  angle = abs(fract(angle / segmentAngle) * segmentAngle - segmentAngle * 0.5);
  
  return vec2<f32>(cos(angle), sin(angle)) * r + vec2<f32>(0.5);
}

// Spiral distortion
fn spiral(uv: vec2<f32>, t: f32) -> vec2<f32> {
  let center = uv - vec2<f32>(0.5);
  let r = length(center);
  let angle = atan2(center.y, center.x);
  
  let twist = r * 8.0 + t * 2.0;
  let newAngle = angle + twist;
  
  return vec2<f32>(cos(newAngle), sin(newAngle)) * r + vec2<f32>(0.5);
}

// Radial wave distortion
fn radialWave(uv: vec2<f32>, t: f32) -> vec2<f32> {
  let center = uv - vec2<f32>(0.5);
  let r = length(center);
  let angle = atan2(center.y, center.x);
  
  let wave = sin(r * 20.0 - t * 3.0) * 0.03;
  let newR = r + wave;
  
  return vec2<f32>(cos(angle), sin(angle)) * newR + vec2<f32>(0.5);
}

// RGB to HSV
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// HSV to RGB
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// Posterization effect
fn posterize(c: vec3<f32>, levels: f32) -> vec3<f32> {
  return floor(c * levels) / levels;
}

// Color cycling with multiple frequencies
fn colorCycle(c: vec3<f32>, t: f32) -> vec3<f32> {
  var hsv = rgb2hsv(c);
  
  // Cycle hue rapidly with multiple harmonics
  hsv.x = fract(hsv.x + t * 0.3 + sin(t * 0.7) * 0.2 + sin(t * 1.3) * 0.1);
  
  // Pulse saturation
  hsv.y = clamp(hsv.y * (1.0 + sin(t * 2.0) * 0.5), 0.0, 1.0);
  
  // Pulse brightness
  hsv.z = hsv.z * (0.8 + sin(t * 1.5) * 0.4);
  
  return hsv2rgb(hsv);
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
  let t = u.x;
  
  // Multi-layer distortion
  var uv = fragUV;
  
  // Layer 1: Kaleidoscope with rotation
  let segments = 6.0 + sin(t * 0.5) * 2.0;
  uv = kaleidoscope(uv, segments, t * 0.8);
  
  // Layer 2: Spiral twist
  uv = spiral(uv, t);
  
  // Layer 3: Radial waves
  uv = radialWave(uv, t);
  
  // Add wobble to UV coordinates
  let wobble = vec2<f32>(
    sin(uv.y * 10.0 + t * 2.0) * 0.02,
    cos(uv.x * 10.0 + t * 1.7) * 0.02
  );
  uv = uv + wobble;
  
  // Sample with extreme chromatic aberration
  let chromaStrength = 0.02 + sin(t * 1.2) * 0.015;
  let angle1 = t * 2.0;
  let angle2 = t * 2.0 + 2.094;
  let angle3 = t * 2.0 + 4.189;
  
  let offsetR = vec2<f32>(cos(angle1), sin(angle1)) * chromaStrength;
  let offsetG = vec2<f32>(cos(angle2), sin(angle2)) * chromaStrength;
  let offsetB = vec2<f32>(cos(angle3), sin(angle3)) * chromaStrength;
  
  let cR = textureSample(u_videoTexture, u_sampler, uv + offsetR).rgb;
  let cG = textureSample(u_videoTexture, u_sampler, uv + offsetG).rgb;
  let cB = textureSample(u_videoTexture, u_sampler, uv + offsetB).rgb;
  
  // Recombine with channel mixing
  var color = vec3<f32>(
    cR.r * 0.8 + cG.r * 0.2,
    cG.g * 0.7 + cB.g * 0.3,
    cB.b * 0.8 + cR.b * 0.2
  );
  
  // Apply color cycling
  color = colorCycle(color, t);
  
  // Add rainbow gradient overlay based on position
  let rainbow = vec3<f32>(
    sin(fragUV.x * 3.14159 + t) * 0.5 + 0.5,
    sin(fragUV.y * 3.14159 + t + 2.094) * 0.5 + 0.5,
    sin((fragUV.x + fragUV.y) * 3.14159 + t + 4.189) * 0.5 + 0.5
  );
  color = mix(color, rainbow, 0.3);
  
  // Posterization for that retro psychedelic look
  let posterLevels = 8.0 + sin(t * 0.3) * 3.0;
  color = posterize(color, posterLevels);
  
  // Solarization effect (invert some brightness ranges)
  let lum = dot(color, vec3<f32>(0.299, 0.587, 0.114));
  if (lum > 0.5 && lum < 0.8) {
    color = vec3<f32>(1.0) - color;
  }
  
  // Edge glow
  let edgeDist = min(min(fragUV.x, 1.0 - fragUV.x), min(fragUV.y, 1.0 - fragUV.y));
  let glow = smoothstep(0.0, 0.2, edgeDist);
  color = color * (0.7 + glow * 0.3);
  
  // Vignette with pulsing
  let vignette = length(fragUV - vec2<f32>(0.5)) * (1.0 + sin(t * 3.0) * 0.2);
  color = color * (1.0 - vignette * 0.8);
  
  // Final brightness pulse
  color = color * (0.9 + sin(t * 2.5) * 0.2);
  
  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
