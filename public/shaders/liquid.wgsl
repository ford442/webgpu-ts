@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

// Revert the Uniforms struct to its original simple form
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
  
  // Define the three distinct motion types
  let motion_background = vec2<f32>(0.0, cos(uv.x * ambient_freq + time)); // Up/Down
  let motion_foreground = vec2<f32>(sin(uv.y * ambient_freq * 1.2 + time * 1.2), 0.0); // Left/Right
  let motion_mid = vec2<f32>(cos(time * 0.4), sin(time * 0.4)); // Slow, circular motion

  // Define the zone boundaries with a small overlap for smooth blending
  let background_end = 0.33;
  let foreground_start = 0.66;
  let blend_width = 0.1;

  // Calculate the influence (from 0.0 to 1.0) for each zone
  let background_influence = 1.0 - smoothstep(background_end - blend_width, background_end + blend_width, center_depth);
  let foreground_influence = smoothstep(foreground_start - blend_width, foreground_start + blend_width, center_depth);
  // The mid-ground is active only when the other two are not
  let mid_influence = (1.0 - background_influence) * (1.0 - foreground_influence);

  // Combine the motions based on their influence factors
  var mixed_motion = (motion_background * background_influence) + 
                     (motion_foreground * foreground_influence) +
                     (motion_mid * mid_influence * 0.4); // Mid-ground motion is at 40% strength

  var ambientDisplacement = mixed_motion * base_ambient_strength;
  // --- MODIFIED: End of new Three-Zone Logic ---


  // --- Occlusion and Ripple logic below remains unchanged ---
  let pixel_size = 1.0 / resolution;
  let depth_up = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv + vec2(0.0, pixel_size.y), 0.0).r;
  let depth_down = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv - vec2(0.0, pixel_size.y), 0.0).r;
  let depth_left = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv - vec2(pixel_size.x, 0.0), 0.0).r;
  let depth_right = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv + vec2(pixel_size.x, 0.0), 0.0).r;

  let fg_influence_occlusion = 
      max(0.0, depth_up - center_depth) +
      max(0.0, depth_down - center_depth) +
      max(0.0, depth_left - center_depth) +
      max(0.0, depth_right - center_depth);

  if (fg_influence_occlusion > 0.05) {
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
  let rippleCount = u32(u.config.y);
  for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
    let rippleData = u.ripples[i];
    let rippleCenter = rippleData.xy;
    let rippleStartTime = rippleData.z;
    let timeSinceClick = u.config.x - rippleStartTime;

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
