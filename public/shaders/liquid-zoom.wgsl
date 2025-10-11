@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,      // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,  // zoomTime, farthestX, farthestY, unused
  zoom_params: vec4<f32>,  // fg_speed, bg_speed, parallax_str, fg_depth_cutoff
  ripples: array<vec4<f32>, 50>, // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

// Helper function is MODIFIED to be depth-aware
fn sample_zooming_layer(
  uv: vec2<f32>,
  depth: f32, // This depth value is now crucial!
  zoom_time: f32,
  zoom_center: vec2<f32>,
  cycle_offset: f32
) -> vec4<f32> {
  let fg_speed = u.zoom_params.x;
  let bg_speed = u.zoom_params.y;
  let parallax_strength = u.zoom_params.z;

  // <-- NEW: Calculate a unique speed for this pixel based on its depth.
  // '1.0 - depth' maps depth (0.0=near, 1.0=far) to a parallax factor (1.0=fast, 0.0=slow).
  // 'pow' gives non-linear control over the parallax effect.
  let parallax_factor = pow(1.0 - depth, parallax_strength);
  let per_pixel_speed = mix(bg_speed, fg_speed, parallax_factor);

  // <-- MODIFIED: Use the new per_pixel_speed instead of the uniform fg_speed.
  let zoom_progress = fract(zoom_time * per_pixel_speed + cycle_offset);
  let zoom_intensity = 2.5;
  let scale = 1.0 + (1.0 - zoom_progress) * zoom_intensity;

  let repeating_uv = (uv - zoom_center) * scale + zoom_center;
  let color = textureSampleLevel(readTexture, u_sampler, fract(repeating_uv), 0.0);

  // Fade logic remains the same for cross-fading between two layers
  let fade_duration = 0.4;
  let fade_in = smoothstep(0.0, fade_duration, zoom_progress);
  let fade_out = 1.0 - smoothstep(1.0 - fade_duration, 1.0, zoom_progress);
  let alpha = fade_in * fade_out;

  return vec4(color.rgb, alpha);
}


@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  let uv = vec2<f32>(global_id.xy) / resolution;
  let zoom_time = u.zoom_config.x;
  let zoom_center = u.zoom_config.yz;

  // Ripples are disabled for a clean effect
  var displaced_uv = uv;

  // Sample the original depth at this pixel's location. This will drive the parallax.
  let static_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

  // --- MODIFIED COMPOSITING LOGIC ---
  // Since our zoom function is now depth-aware, we don't need a hard cutout.
  // Every pixel will zoom at a rate appropriate for its depth.
  // We still use two layers to create a seamless, cross-fading loop.

  let layer1 = sample_zooming_layer(displaced_uv, static_depth, zoom_time, zoom_center, 0.0);
  let layer2 = sample_zooming_layer(displaced_uv, static_depth, zoom_time, zoom_center, 0.5);

  // Standard cross-fade blending
  let final_color = mix(layer1, layer2, layer2.a);

  textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));


  // --- MODIFIED DEPTH TEXTURE UPDATE ---
  // The depth texture must also be updated with the same parallax logic
  // to prevent color and depth from desynchronizing over time.

  let fg_speed = u.zoom_params.x;
  let bg_speed = u.zoom_params.y;
  let parallax_strength = u.zoom_params.z;
  
  // <-- NEW: Recalculate per-pixel speed and scale for the depth transformation.
  let parallax_factor = pow(1.0 - static_depth, parallax_strength);
  let per_pixel_speed = mix(bg_speed, fg_speed, parallax_factor);

  let main_zoom_progress = fract(zoom_time * per_pixel_speed);
  let main_zoom_intensity = 2.5;
  let main_scale = 1.0 + (1.0 - main_zoom_progress) * main_zoom_intensity;

  // <-- MODIFIED: The UV for sampling previous depth is now also parallax-aware.
  let transformed_uv = (displaced_uv - zoom_center) * main_scale + zoom_center;
  let transformed_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, fract(transformed_uv), 0.0).r;

  // <-- SIMPLIFIED: We always write the transformed depth. No mix/cutout needed.
  // The transformation itself is already depth-aware.
  textureStore(writeDepthTexture, global_id.xy, vec4<f32>(transformed_depth, 0.0, 0.0, 0.0));
}
