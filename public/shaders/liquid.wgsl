@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;

// --- MODIFIED: Start of changes ---

// @binding(4) now reads from the "current" depth map
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
// Add a new binding for the "next" depth map, which we will write to
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

// --- MODIFIED: End of changes ---

struct Uniforms {
  config: vec4<f32>,              // time, rippleCount, resolutionX, resolutionY
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  let uv = vec2<f32>(global_id.xy) / resolution;
  var totalDisplacement = vec2<f32>(0.0, 0.0);
  let currentTime = u.config.x;
  
  // --- Depth Integration ---
  // Sample from the READ depth texture
  let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
  let depthFactor = 1.0 - depth; 

  // --- Ambient Wobble (modified by depth) ---
  let time = currentTime * 0.5;
  let ambient_strength = 0.02 * depthFactor;
  let ambient_freq = 15.0;
  let d1 = sin(uv.x * ambient_freq + time) * ambient_strength;
  let d2 = cos(uv.y * ambient_freq * 0.7 + time) * ambient_strength;
  totalDisplacement += vec2<f32>(d1, d2);

  // --- Click Ripples (modified by depth) ---
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
        // Sample the ripple origin depth from the READ texture
        let rippleOriginDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, rippleCenter, 0.0).r;
        let rippleOriginDepthFactor = 1.0 - rippleOriginDepth;

        let ripple_speed = mix(1.0, 2.0, rippleOriginDepthFactor);
        let ripple_amplitude = mix(0.005, 0.015, rippleOriginDepthFactor);
        let ripple_frequency = 25.0;

        let wave = sin(dist * ripple_frequency - timeSinceClick * ripple_speed);
        
        let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / (3.0 * mix(0.5, 1.0, rippleOriginDepthFactor)));
        let falloff = 1.0 / (dist * 20.0 + 1.0);
        
        let displacement = wave * ripple_amplitude * attenuation * falloff;
        let direction = direction_vec / dist;
        totalDisplacement += direction * displacement;
      }
    }
  }

  let displacedUV = uv + totalDisplacement;

  // 1. Advect the COLOR (same as before)
  let color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
  textureStore(writeTexture, global_id.xy, color);

  // --- MODIFIED: Start of changes ---
  // 2. Advect the DEPTH
  // Sample the depth from the upstream position and write it to the new depth texture
  let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV, 0.0).r;
  textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
  // --- MODIFIED: End of changes ---
}
