// ================================================================
// Rich & Complex Water Surface Compute Shader
// ================================================================
// Features:
// - Organic ambient motion using Fractional Brownian Motion (FBM).
// - Interactive ripples with injected "dye" color.
// - Chromatic Aberration for translucent, color-shifting refraction.
// - Specular Highlights on wave crests for a "wet" look.
// - Simulated Caustics for light patterns on the 'floor'.
// ================================================================

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

// --- NEW UNIFORM STRUCTURE ---
// A struct to hold all data for a single ripple.
// WGSL's memory layout rules are strict. This packing is efficient.
// (vec2 is 8 bytes, f32 is 4 bytes. vec3 needs 16-byte alignment).
struct Ripple {
  center: vec2<f32>,     // 8 bytes
  startTime: f32,       // 4 bytes
  intensity: f32,       // 4 bytes. Total so far: 16 bytes.
  color: vec3<f32>,       // Starts at offset 16. Size 12 bytes.
  // Implicit 4 bytes of padding here to align to 16-byte boundary.
}; // Total size per ripple: 32 bytes.

struct Uniforms {
  // config: x=time, y=rippleCount, z=resolutionX, w=resolutionY
  config: vec4<f32>,
  // An array of our new Ripple structs.
  ripples: array<Ripple, 50>,
};

@group(0) @binding(3) var<uniform> u: Uniforms;

// --- Helper Functions for Procedural Noise ---
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
  for (var i = 0; i < 4; i = i + 1) {
    value += amplitude * noise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// --- Main Compute Shader ---
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) {
    return;
  }

  let uv = vec2<f32>(global_id.xy) / resolution;
  let time = u.config.x;

  // --- 1. Calculate the displacement map and other effects ---
  var totalDisplacement = vec2<f32>(0.0);
  var specular = 0.0;
  var addedColor = vec3<f32>(0.0);
  var causticStrength = 0.0;

  // A. Organic Ambient "liquid" effect using FBM
  let ambient_uv = uv * 4.0;
  let d1 = fbm(ambient_uv + time * 0.1);
  let d2 = fbm(ambient_uv - time * 0.1 + vec2(5.2, 1.3));
  totalDisplacement += vec2(d1, d2) * 0.015 - 0.0075;

  // B. Loop through interactive ripples
  let rippleCount = u32(u.config.y);
  for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
    let ripple = u.ripples[i];
    let timeSinceClick = time - ripple.startTime;
    let lifeTime = 4.0;

    if (timeSinceClick > 0.0 && timeSinceClick < lifeTime) {
      let direction_vec = uv - ripple.center;
      let dist = length(direction_vec);

      if (dist > 0.0001) {
        let ripple_speed = 1.5;
        let ripple_frequency = 30.0;
        let ripple_amplitude = 0.012;

        let wave_val = dist * ripple_frequency - timeSinceClick * ripple_speed;
        let wave = sin(wave_val);

        let attenuation = pow(1.0 - smoothstep(0.0, 1.0, timeSinceClick / lifeTime), 2.0);
        let falloff = 1.0 / (1.0 + dist * dist * 400.0);

        // Calculate final displacement from this ripple
        let displacement = wave * ripple_amplitude * attenuation * falloff * ripple.intensity;
        totalDisplacement += normalize(direction_vec) * displacement;

        // Add to specular based on wave crests
        let crest = smoothstep(0.8, 1.0, wave);
        specular += pow(crest * attenuation * falloff, 32.0) * 0.9 * ripple.intensity;

        // Add "dye" to the water
        let dye_wave = sin(wave_val - 1.57); // Phase shifted to be just behind crest
        let dye_strength = smoothstep(0.5, 1.0, dye_wave) * attenuation * falloff;
        addedColor += ripple.color * dye_strength * ripple.intensity;

        // Accumulate strength for caustics
        causticStrength += abs(displacement) * 200.0;
      }
    }
  }

  // --- 2. Apply Effects based on the displacement map ---

  // A. Chromatic Aberration: Displace R,G,B channels by different amounts
  let displacedUV_R = uv + totalDisplacement * 1.02;
  let displacedUV_G = uv + totalDisplacement;
  let displacedUV_B = uv + totalDisplacement * 0.98;

  var finalColor = vec4(
    textureSampleLevel(readTexture, u_sampler, displacedUV_R, 0.0).r,
    textureSampleLevel(readTexture, u_sampler, displacedUV_G, 0.0).g,
    textureSampleLevel(readTexture, u_sampler, displacedUV_B, 0.0).b,
    1.0
  );

  // B. Caustics Simulation: Distort a noise pattern using the displacement
  let caustic_uv = uv + totalDisplacement * 0.1;
  let caustics = fbm(caustic_uv * 12.0 + time * 0.5) * causticStrength;
  finalColor.rgb += vec3(caustics * 0.4);

  // C. Apply added color "dye" and specular highlights
  finalColor.rgb = mix(finalColor.rgb, addedColor, clamp(length(addedColor), 0.0, 1.0));
  finalColor.rgb += vec3(specular);

  // --- 3. Final Output ---
  textureStore(writeTexture, global_id.xy, finalColor);
}
