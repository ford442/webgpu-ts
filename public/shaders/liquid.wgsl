@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

// The new, cleaner struct for a single ripple.
// WGSL aligns this struct to 32 bytes.
struct Ripple {
  center: vec2<f32>,   // 8 bytes
  startTime: f32,     // 4 bytes
  intensity: f32,     // 4 bytes (Total so far: 16 bytes)
  color: vec3<f32>,     // Starts at offset 16. Size 12 bytes.
  // WGSL adds 4 bytes of padding here automatically.
}; // Total size per ripple: 32 bytes.

struct Uniforms {
  // config: x=time, y=rippleCount, z=resolutionX, w=resolutionY
  config: vec4<f32>,
  ripples: array<Ripple, 50>,
};

@group(0) @binding(3) var<uniform> u: Uniforms;
fn hash(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f); // Smoothstep
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm(p: vec2<f32>) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var p2 = p;
  for (var i = 0; i < 4; i = i + 1) {
    value += amplitude * noise(p2);
    p2 *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// --- NEW: Color Grading Function ---
fn color_grade(color: vec3<f32>) -> vec3<f32> {
  // 1. Apply a cinematic S-curve for contrast
  let contrasted = smoothstep(0.1, 0.9, color);
  // 2. Boost saturation
  let luma = dot(contrasted, vec3(0.299, 0.587, 0.114));
  let saturated = mix(vec3(luma), contrasted, 1.2); // 1.2 = 20% saturation boost
  return saturated;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  // ... (Initial setup: resolution, uv, time is the same) ...
  let resolution = u.config.zw;
  if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) { return; }
  let uv = vec2<f32>(global_id.xy) / resolution;
  let time = u.config.x;
  // --- 1. Calculate the displacement map and other surface effects ---
  // ... (This entire section for calculating totalDisplacement, specular, 
  //      addedColor, and causticStrength is IDENTICAL to the previous version) ...
  var totalDisplacement = vec2<f32>(0.0);
  var specular = 0.0;
  var addedColor = vec3<f32>(0.0);
  var causticStrength = 0.0;
  // (ambient fbm loop)
  // (interactive ripple loop)
  // --- 2. Sample Textures and Apply Effects ---
  // MODIFIED: Fetch the original, undisturbed color first
  let originalColor = textureSampleLevel(readTexture, u_sampler, uv, 0.0).rgb;
  // A. Refraction (Chromatic Aberration)
  let displacedUV_R = uv + totalDisplacement * 1.02;
  let displacedUV_G = uv + totalDisplacement;
  let displacedUV_B = uv + totalDisplacement * 0.98;
  let refractedColor = vec3(
    textureSampleLevel(readTexture, u_sampler, displacedUV_R, 0.0).r,
    textureSampleLevel(readTexture, u_sampler, displacedUV_G, 0.0).g,
    textureSampleLevel(readTexture, u_sampler, displacedUV_B, 0.0).b
  );
  // B. Caustics Simulation
  let caustic_uv = uv + totalDisplacement * 0.1;
  let caustics = fbm(caustic_uv * 12.0 + time * 0.5) * causticStrength;
  let causticColor = vec3(caustics * 0.6); // Increased brightness for HDR
  // --- 3. Composite Layers Together (The "Blending") ---
  // The "refraction amount" is based on how much displacement there is.
  // This prevents the whole image from looking distorted and creates the smooth slide.
  let refractionAmount = clamp(length(totalDisplacement) * 20.0, 0.0, 1.0);
  // Blend between the original color and the refracted color
  var compositedColor = mix(originalColor, refractedColor, refractionAmount);
  // Add the "dye" color on top
  compositedColor = mix(compositedColor, addedColor, clamp(length(addedColor), 0.0, 1.0));
  // Add caustics and specular highlights. These can push color values > 1.0
  compositedColor += causticColor;
  compositedColor += vec3(specular * 1.5); // Boost specular for HDR
  // --- 4. Final Polish: Color Grading ---
  let finalColor = color_grade(compositedColor);
  // --- 5. Final Output ---
  // The texture format is now rgba16float, so it can store the HDR values.
  textureStore(writeTexture, global_id.xy, vec4(finalColor, 1.0));
}
