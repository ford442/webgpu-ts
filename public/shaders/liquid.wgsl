@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

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
  let pixel_size = 1.0 / resolution;
  
  var mouseDisplacement = vec2<f32>(0.0, 0.0);
  var ambientDisplacement = vec2<f32>(0.0, 0.0);

  // --- MODIFIED: Start of Occlusion Logic ---
  // Sample depth at the current pixel and its immediate neighbors
  let center_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
  let depth_up = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv + vec2(0.0, pixel_size.y), 0.0).r;
  let depth_down = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv - vec2(0.0, pixel_size.y), 0.0).r;
  let depth_left = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv - vec2(pixel_size.x, 0.0), 0.0).r;
  let depth_right = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv + vec2(pixel_size.x, 0.0), 0.0).r;

  // Check if any neighbors are significantly in front of the current pixel.
  // max(0.0, ...) ensures we only get positive values (foreground influence).
  let foreground_influence = 
      max(0.0, depth_up - center_depth) +
      max(0.0, depth_down - center_depth) +
      max(0.0, depth_left - center_depth) +
      max(0.0, depth_right - center_depth);
  
  // Create an occlusion factor. If foreground influence is high, this factor will be close to 0.
  // This will dampen the motion of pixels that are "behind" others.
  let occlusion_factor = 1.0 - smoothstep(0.05, 0.2, foreground_influence);
  // --- MODIFIED: End of Occlusion Logic ---


  let depthFactor = 1.0 - center_depth; 

  // --- MODIFIED: Start of Directional Breathing Logic ---
  let time = currentTime * 0.5;
  var ambient_strength = 0.02 * depthFactor;
  let ambient_freq = 15.0;

  // Define two different motion patterns.
  // Pattern 1: A slower, horizontal wave for the background.
  let motion_far = vec2<f32>(sin(uv.y * ambient_freq * 0.8 + time * 0.8), 0.0);
  // Pattern 2: A slightly faster, vertical wave for the foreground.
  let motion_close = vec2<f32>(0.0, cos(uv.x * ambient_freq * 1.2 + time * 1.2));

  // Blend between the two patterns based on the pixel's depth.
  // smoothstep creates a nice transition in the mid-ground.
  let mixed_motion = mix(motion_far, motion_close, smoothstep(0.25, 0.75, center_depth));
  
  // Apply the occlusion factor to the final strength.
  ambient_strength = ambient_strength * occlusion_factor;

  ambientDisplacement += mixed_motion * ambient_strength;
  // --- MODIFIED: End of Directional Breathing Logic ---
  
  // --- Click Ripples (This part remains unchanged) ---
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
  
  // --- Advection (This part remains unchanged) ---
  let totalDisplacement = mouseDisplacement + ambientDisplacement;
  let colorDisplacedUV = uv + totalDisplacement;
  let color = textureSampleLevel(readTexture, u_sampler, colorDisplacedUV, 0.0);
  textureStore(writeTexture, global_id.xy, color);

  let depthDisplacedUV = uv + mouseDisplacement;
  let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, depthDisplacedUV, 0.0).r;
  textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
}
