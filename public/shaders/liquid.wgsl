@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;

@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;

struct Ripple {
  center: vec2<f32>,
  startTime: f32,
  intensity: f32,
  color: vec3<f32>,
};

struct Uniforms {
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
  let u = f * f * (3.0 - 2.0 * f);
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

// --- Color Grading Function ---
fn color_grade(color: vec3<f32>) -> vec3<f32> {
  let contrasted = smoothstep(0.1, 0.9, color);
  let luma = dot(contrasted, vec3(0.299, 0.587, 0.114));
  let saturated = mix(vec3(luma), contrasted, 1.2);
  return saturated;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) { return; }
  let uv = vec2<f32>(global_id.xy) / resolution;
  let time = u.config.x;
  var totalDisplacement = vec2<f32>(0.0);
  var specular = 0.0;
  var addedColor = vec3<f32>(0.0);
  var causticStrength = 0.0;
  // Calculate ambient motion
  let ambient_uv = uv * 4.0;
  let d1 = fbm(ambient_uv + time * 0.1);
  let d2 = fbm(ambient_uv - time * 0.1 + vec2(5.2, 1.3));
  totalDisplacement += vec2(d1, d2) * 0.015 - 0.0075;
  // Calculate interactive ripples
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
        let displacement = wave * ripple_amplitude * attenuation * falloff * ripple.intensity;
        totalDisplacement += normalize(direction_vec) * displacement;
        let crest = smoothstep(0.8, 1.0, wave);
        specular += pow(crest * attenuation * falloff, 32.0) * 0.9 * ripple.intensity;
        let dye_wave = sin(wave_val - 1.57);
        let dye_strength = smoothstep(0.5, 1.0, dye_wave) * attenuation * falloff;
        addedColor += ripple.color * dye_strength * ripple.intensity;
        causticStrength += abs(displacement) * 200.0;
      }
    }
  }
  // Sample original and refracted colors
  let originalColor = textureSampleLevel(readTexture, u_sampler, uv, 0.0).rgb;
  let refractedColor = vec3(
    textureSampleLevel(readTexture, u_sampler, uv + totalDisplacement * 1.02, 0.0).r,
    textureSampleLevel(readTexture, u_sampler, uv + totalDisplacement, 0.0).g,
    textureSampleLevel(readTexture, u_sampler, uv + totalDisplacement * 0.98, 0.0).b
  );
  // Calculate Caustics
  let caustic_uv = uv + totalDisplacement * 0.1;
  let caustics = fbm(caustic_uv * 12.0 + time * 0.5) * causticStrength;
  let causticColor = vec3(caustics * 0.6);
  // Composite layers
  let refractionAmount = clamp(length(totalDisplacement) * 20.0, 0.0, 1.0);
  var compositedColor = mix(originalColor, refractedColor, refractionAmount);
  compositedColor = mix(compositedColor, addedColor, clamp(length(addedColor), 0.0, 1.0));
  compositedColor += causticColor;
  compositedColor += vec3(specular * 1.5);
  // Apply color grading and store result
  let finalColor = color_grade(compositedColor);
  textureStore(writeTexture, global_id.xy, vec4(finalColor, 1.0));
}
