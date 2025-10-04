@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;

struct Uniforms {
  config: vec4<f32>,          // time, rippleCount, resolutionX, resolutionY
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

struct AudioData {
  values: array<vec4<f32>, 32>
};
@group(0) @binding(4) var<uniform> audio: AudioData;

fn getAudioValue(index: u32) -> f32 {
  let vecIndex = index / 4u;
  let compIndex = index % 4u;
  return audio.values[vecIndex][compIndex];
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) {
    return; // Boundary check
  }
  let uv = vec2<f32>(global_id.xy) / resolution;
  
  // --- NEW: Sample the original texture to get brightness at this pixel ---
  let originalColor = textureSampleLevel(readTexture, u_sampler, uv, 0.0);
  let brightness = (originalColor.r + originalColor.g + originalColor.b) / 3.0;
  
  // --- NEW: Create a motion sensitivity factor based on brightness ---
  // We use mix() to map brightness [0, 1] to a sensitivity range [0.1, 1.0].
  // This means dark areas (brightness=0) still have 10% movement, while
  // bright areas (brightness=1) have 100% movement. Tweak these values!
  let motion_sensitivity = mix(0.1, 1.0, brightness);

  var totalDisplacement = vec2<f32>(0.0, 0.0);
  let currentTime = u.config.x;

  // --- Audio Visualization ---
  // Average the low frequencies (bass)
  var bass: f32 = 0.0;
  for (var i: u32 = 0u; i < 8u; i = i + 1u) {
    bass = bass + getAudioValue(i);
  }
  bass = bass / 8.0 / 255.0; // Normalize

  // Average the high frequencies (treble)
  var treble: f32 = 0.0;
  for (var i: u32 = 64u; i < 128u; i = i + 1u) {
    treble = treble + getAudioValue(i);
  }
  treble = treble / 64.0 / 255.0; // Normalize

  // --- MODIFIED: Apply motion_sensitivity to audio effects ---
  // The speed of the animation now pulses more in bright areas
  let bass_speed_mod = bass * 2.0 * motion_sensitivity; 
  let time = currentTime * (0.5 + bass_speed_mod);
  
  // The strength of the ambient wobble is now greater in bright areas
  let ambient_strength = (0.02 + treble * 0.05) * motion_sensitivity;
  
  let ambient_freq = 15.0;
  let d1 = sin(uv.x * ambient_freq + time) * ambient_strength;
  let d2 = cos(uv.y * ambient_freq * 0.7 + time) * ambient_strength;
  totalDisplacement += vec2<f32>(d1, d2);

  // --- Ripples ---
  let rippleCount = u32(u.config.y);
  for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
    let rippleData = u.ripples[i];
    let rippleCenter = rippleData.xy;
    let rippleStartTime = rippleData.z;
    let timeSinceClick = currentTime - rippleStartTime;
    if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
      let direction_vec = uv - rippleCenter;
      let dist = length(direction_vec);
      if (dist > 0.0001) {
        let ripple_speed = 2.0;
        let ripple_frequency = 25.0;
        let ripple_amplitude = 0.015;
        let wave = sin(dist * ripple_frequency - timeSinceClick * ripple_speed);
        let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / 3.0);
        let falloff = 1.0 / (dist * 20.0 + 1.0);
        
        // --- Optional MODIFICATION: Make ripples also sensitive to brightness ---
        // You could apply the sensitivity here as well if you like the effect.
        // let displacement = wave * ripple_amplitude * attenuation * falloff * motion_sensitivity;
        let displacement = wave * ripple_amplitude * attenuation * falloff;
        
        let direction = direction_vec / dist;
        totalDisplacement += direction * displacement;
      }
    }
  }

  let displacedUV = uv + totalDisplacement;
  let color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
  textureStore(writeTexture, global_id.xy, color);
}
