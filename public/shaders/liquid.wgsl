@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

// Revert the Uniforms struct to its simpler form
struct Uniforms {
  config: vec4<f32>,              // time, rippleCount, resolutionX, resolutionY
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  let uv = vec2<f32>(global_id.xy) / resolution;
  let currentTime = u.config.x;
  let center_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

  // --- MODIFIED: Start of new Three-Zone Logic ---
  let time = currentTime * 0.5;
  let base_ambient_strength = 0.02; 
  let ambient_freq = 15.0;
  
  // Define the motion types as you requested
  let motion_background = vec2<f32>(0.0, cos(uv.x * ambient_freq + time)); // Up/Down
  let motion_foreground = vec2<f32>(sin(uv.y * ambient_freq * 1.2 + time * 1.2), 0.0); // Left/Right

  // --- Zone Definition ---
  // Zone 1 (Background): From depth 0.0 to 0.33
  // Zone 2 (Mid-ground):  From depth 0.33 to 0.66 (the quiet zone)
  // Zone 3 (Foreground): From depth 0.66 to 1.0
  
  // First, blend from pure background motion to pure foreground motion across the entire range
  let overall_mix_factor = smoothstep(0.0, 1.0, center_depth);
  var mixed_motion = mix(motion_background, motion_foreground, overall_mix_factor);

  // --- Quiet Zone Calculation ---
  // Next, calculate a strength multiplier that dips in the middle.
  let mid_zone_center = 0.5;
  let mid_zone_radius = 0.165; // (0.66 - 0.33) / 2
  
  // This calculates how close the pixel's depth is to the center of the quiet zone.
  // It will be 1.0 at the very center (0.5 depth) and 0.0 outside the zone.
  let mid_influence = 1.0 - smoothstep(0.0, mid_zone_radius, abs(center_depth - mid_zone_center));
  
  // The strength factor is 1.0 outside the quiet zone, and dips down to 0.25 inside it.
  let strength_factor = 1.0 - mid_influence * 0.75;

  var ambientDisplacement = mixed_motion * base_ambient_strength * strength_factor;
  // --- MODIFIED: End of new Three-Zone Logic ---


  // --- Occlusion and Ripple logic below remains unchanged ---
  let pixel_size = 1.0 / resolution;
  let depth_up = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv + vec2(0.0, pixel_size.y), 0.0).r;
  let depth_down = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv - vec2(0.0, pixel_size.y), 0.0).r;
  let depth_left = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv - vec2(pixel_size.x, 0.0), 0.0).r;
  let depth_right = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv + vec2(pixel_size.x, 0.0), 0.0).r;

  let foreground_influence = 
      max(0.0, depth_up - center_depth) +
      max(0.0, depth_down - center_depth) +
      max(0.0, depth_left - center_depth) +
      max(0.0, depth_right - center_depth);

  if (foreground_influence > 0.05) {
      let grad_x = (depth_right - depth_left);
      let grad_y = (depth_up - depth_down);
      let gradient_vec = vec2<f32>(grad_x, grad_y);
      let grad_len_sq = dot(gradient_vec, gradient_vec);

      if (grad_len_sq > 0.00001) {
        let gradient = normalize(gradient_vec);
        let projection = dot(ambientDisplacement, gradient);

        if (projection > 0.0) {
          ambientDisplacement = ambientDisplacement - projection * gradient;
        }
      }
  }
  
  var mouseDisplacement = vec2<f32>(0.0, 0.0);
  let rippleCount = u32(u.config.x); // NOTE: This was u.config.y, correcting to x as per struct
  for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
    let rippleData = u.ripples[i];
    let rippleCenter = rippleData.xy;
    let rippleStartTime = rippleData.z;
    let timeSinceClick = u.config.x - rippleStartTime; // Corrected to use time from uniform

    if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
      let direction_vec = uv - rippleCenter;
      let dist = length(direction_vec);

      if (dist > 0.0001) {
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
        mouseDisplacement += direction * displacement;
      }
    }
  }
  
  let totalDisplacement = mouseDisplacement + ambientDisplacement;
  let colorDisplacedUV = uv + totalDisplacement;
  let color = textureSampleLevel(readTexture, u_sampler, colorDisplacedUV, 0.0);
  textureStore(writeTexture, global_id.xy, color);

  let depthDisplacedUV = uv + mouseDisplacement;
  let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, depthDisplacedUV, 0.0).r;
  textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
}
