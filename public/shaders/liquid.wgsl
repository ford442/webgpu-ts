@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;

struct Uniforms {
  config: vec4<f32>,            // time, rippleCount, resolutionX, resolutionY
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};
@group(0) @binding(3) var<uniform> u: Uniforms;

struct AudioData {
  values: array<vec4<f32>, 32>
};
@group(0) @binding(4) var<uniform> audio: AudioData;

// Helper to safely get audio data.
fn getAudioValue(index: u32) -> f32 {
  // Clamp index to prevent out-of-bounds access
  let safeIndex = clamp(index, 0u, 127u);
  let vecIndex = safeIndex / 4u;
  let compIndex = safeIndex % 4u;
  return audio.values[vecIndex][compIndex];
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  // --- Setup & Constants ---
  let resolution = u.config.zw;
  if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) {
    return; // Out of bounds check
  }
  let uv = vec2<f32>(global_id.xy) / resolution;
  let currentTime = u.config.x;

  // --- Tweaking Knobs ---
  // Adjust these values to change the feel of the effect!
  let BASS_WARP_INTENSITY = 0.08;   // How much bass distorts bright areas
  let MIDS_SHIMMER_INTENSITY = 0.03;  // How much mids make bright areas shimmer
  let TREBLE_JITTER_INTENSITY = 0.01; // High-frequency noise based on treble
  let ambient_strength = 0.0177;

  // --- Step 1: Get Local Pixel Brightness ---
  // Sample the *original* texture to find out how bright this pixel is.
  let sourceColor = textureSampleLevel(readTexture, u_sampler, uv, 0.0);
  // Calculate brightness (luminance). (r+g+b)/3 is a simple and fast way.
  let brightness = (sourceColor.r + sourceColor.g + sourceColor.b) / 3.0;

  // --- Step 2: Deeper Audio Analysis ---
  var bass: f32 = 0.0;
  for (var i: u32 = 0u; i < 8u; i = i + 1u) { // Low frequencies
    bass += getAudioValue(i);
  }
  bass = pow(bass / 8.0 / 255.0, 2.0); // Normalize and use pow() to make it more 'punchy'

  var mids: f32 = 0.0;
  for (var i: u32 = 16u; i < 48u; i = i + 1u) { // Mid frequencies
    mids += getAudioValue(i);
  }
  mids = pow(mids / 32.0 / 255.0, 2.0);

  var treble: f32 = 0.0;
  for (var i: u32 = 64u; i < 128u; i = i + 1u) { // High frequencies
    treble += getAudioValue(i);
  }
  treble = pow(treble / 64.0 / 255.0, 2.0);
  
  // --- Step 3: Calculate Displacements ---
  var totalDisplacement = vec2<f32>(0.0, 0.0);

  // A. The base liquid "wash" (always present, but gentle)
  // This satisfies the "overall still liquid wash around" requirement.
  let time = currentTime * 0.7;
  let ambient_freq = 10.0;
    let d1 = sin(uv.x * ambient_freq + time) * ambient_strength;
    let d2 = cos(uv.y * ambient_freq * 0.7 + time) * ambient_strength;
  totalDisplacement += vec2<f32>(d1, d2);

  // B. Audio-driven displacement, MODULATED BY BRIGHTNESS
  // This is where the magic happens. These effects are strongest where brightness > 0.
  
  // Low-frequency, large-scale warp from the bass
  let bassWarpFreq = 4.0;
  let bassWarp = vec2<f32>(
    sin(uv.y * bassWarpFreq + currentTime * 2.0),
    cos(uv.x * bassWarpFreq + currentTime * 2.0)
  );
  totalDisplacement += bassWarp * bass * BASS_WARP_INTENSITY * brightness;

  // Mid-frequency, faster shimmer
  let midShimmerFreq = 20.0;
  let midShimmer = vec2<f32>(
      cos(uv.x * midShimmerFreq - currentTime * 5.0),
      sin(uv.y * midShimmerFreq - currentTime * 5.0)
  );
  totalDisplacement += midShimmer * mids * MIDS_SHIMMER_INTENSITY * brightness;
  
  // High-frequency, small-scale jitter from the treble (less dependent on brightness)
  let trebleJitterFreq = 50.0;
  let trebleJitter = vec2<f32>(
      sin(uv.y * trebleJitterFreq + currentTime * 10.0),
      cos(uv.x * trebleJitterFreq + currentTime * 10.0)
  );
  // We can make this one less dependent on brightness for a "sparkle" effect everywhere
  let trebleModulation = mix(0.1, 1.0, brightness); // Affects dark areas a little, bright areas a lot
  totalDisplacement += trebleJitter * treble * TREBLE_JITTER_INTENSITY * trebleModulation;

  // C. Click-based ripples (from original code)
  let rippleCount = u32(u.config.y);
  for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
    let rippleData = u.ripples[i];
    let timeSinceClick = currentTime - rippleData.z;
    if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
      let direction_vec = uv - rippleData.xy;
      let dist = length(direction_vec);
      if (dist > 0.0001) {
        let ripple_speed = 2.0;
        let ripple_frequency = 25.0;
        let ripple_amplitude = 0.015;
        let wave = sin(dist * ripple_frequency - timeSinceClick * ripple_speed);
        let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / 3.0);
        let falloff = 1.0 / (dist * 20.0 + 1.0);
        let displacement = wave * ripple_amplitude * attenuation * falloff;
        totalDisplacement += (direction_vec / dist) * displacement;
      }
    }
  }
  
  // --- Step 4: Apply Displacement and Store Result ---
  let displacedUV = uv + totalDisplacement;
  let finalColor = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
  textureStore(writeTexture, global_id.xy, finalColor);
}
