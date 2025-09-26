@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,              // time, rippleCount, resolutionX, resolutionY
  depth_stats: vec4<f32>,          // average_depth, min_depth, max_depth, unused
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  let uv = vec2<f32>(global_id.xy) / resolution;
  let currentTime = u.config.x;
  let pixel_size = 1.0 / resolution;
  
  var mouseDisplacement = vec2<f32>(0.0, 0.0);
  var ambientDisplacement = vec2<f32>(0.0, 0.0);

  let center_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
  let depth_up = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv + vec2(0.0, pixel_size.y), 0.0).r;
  let depth_down = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv - vec2(0.0, pixel_size.y), 0.0).r;
  let depth_left = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv - vec2(pixel_size.x, 0.0), 0.0).r;
  let depth_right = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv + vec2(pixel_size.x, 0.0), 0.0).r;
  
  let base_ambient_strength = 0.015; 
  let ambient_freq = 15.0;
// --- MODIFIED: Start of new logic ---
  // Motion directions are the same as you requested
  let motion_background = vec2<f32>(0.0, cos(uv.x * ambient_freq + currentTime));
  let motion_foreground = vec2<f32>(sin(uv.y * ambient_freq * 1.2 + currentTime * 1.2), 0.0);

  // Get the real depth range from the uniforms
  let min_depth = u.depth_stats.y;
  let max_depth = u.depth_stats.z;
  let depth_range = max_depth - min_depth;

  // Define the boundaries for the three zones
  let background_end = min_depth + depth_range * 0.33;
  let foreground_start = max_depth - depth_range * 0.33;

  // Calculate the influence of each motion type based on the current pixel's depth
  // `1.0 - smoothstep(...)` creates a fade-out effect.
  let background_influence = 1.0 - smoothstep(min_depth, background_end, center_depth);
  // `smoothstep(...)` creates a fade-in effect.
  let foreground_influence = smoothstep(foreground_start, max_depth, center_depth);
  
  // Combine the motions. In the middle zone, both influences will be low.
  let mixed_motion = (motion_background * background_influence) + (motion_foreground * foreground_influence);
  
  // Calculate a "quiet zone" factor for the middle
  // This will be 1.0 at the edges and dip down to 0.5 in the very center of the mid-ground.
  let mid_quiet_factor = 1.0 - (1.0 - smoothstep(background_end, (background_end + foreground_start) / 2.0, center_depth)) * (smoothstep(foreground_start, (background_end + foreground_start) / 2.0, center_depth));

  // Apply the base strength and the quiet factor
  ambientDisplacement = mixed_motion * base_ambient_strength * (mid_quiet_factor * 0.5 + 0.5);
  // --- MODIFIED: End of new logic ---

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
