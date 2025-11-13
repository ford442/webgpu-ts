@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,      // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,  // zoomTime, farthestX, farthestY, unused
  zoom_params: vec4<f32>,  // fg_speed, bg_speed, parallax_str, fog_density
  ripples: array<vec4<f32>, 50>, // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;


// <<< CHANGE #1: New helper function for seamless mirrored texture wrapping.
// This avoids the hard edges created by fract().
fn ping_pong(a: f32) -> f32 {
  return 1.0 - abs(fract(a * 0.5) * 2.0 - 1.0);
}

fn ping_pong_v2(v: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(ping_pong(v.x), ping_pong(v.y));
}


fn sample_zooming_layer(
  uv: vec2<f32>,
  depth: f32,
  zoom_time: f32,
  zoom_center: vec2<f32>,
  cycle_offset: f32
) -> vec4<f32> {
  // Extract speed parameters and preset
  let fg_speed = u.zoom_params.x;
  let bg_speed = u.zoom_params.y;
  let parallax_strength = u.zoom_params.z;

  let presetF = u.zoom_config.w;
  let preset = i32(floor(presetF + 0.5)); // 0=subtle, 1=dreamy, 2=aggressive

  // Depth-based parallax: closer objects move faster (foreground), distant objects slower (background)
  // depth is 0 (closest) to 1 (farthest), so (1.0 - depth) inverts it for parallax effect
  let parallax_factor = pow(1.0 - depth, parallax_strength);
  let per_pixel_speed = mix(bg_speed, fg_speed, parallax_factor);

  // Continuous scroll effect (no breathing/pulsing) — time flows linearly
  // The layer repeats as it scrolls, creating infinite motion through the scene
  let scroll_offset = zoom_time * per_pixel_speed + cycle_offset;

  // Radial outward scroll from center: each pixel moves away from zoom_center
  // This creates a "flying forward" illusion where depth-ordered objects stream past
  let direction_from_center = uv - zoom_center;
  let distance_from_center = length(direction_from_center);

  // Scale UV radially outward continuously (no sine/cosine, pure linear motion)
  let radial_scale = 1.0 + scroll_offset * 0.5; // Adjust multiplier for speed perception
  let scrolled_uv = zoom_center + direction_from_center * radial_scale;

  // Seamless wrapping using ping-pong (mirrors at edges for continuous tiling)
  let wrapped_uv = ping_pong_v2(scrolled_uv);

  // Very subtle chromatic aberration for visual interest
  let chroma_strength = 0.001 * (1.0 + parallax_factor * 0.3);
  let r_uv = clamp(wrapped_uv + vec2<f32>(chroma_strength, 0.0), vec2<f32>(0.0), vec2<f32>(1.0));
  let g_uv = wrapped_uv;
  let b_uv = clamp(wrapped_uv - vec2<f32>(chroma_strength * 0.7, 0.0), vec2<f32>(0.0), vec2<f32>(1.0));

  let rcol = textureSampleLevel(readTexture, non_filtering_sampler, r_uv, 0.0).rgb;
  let gcol = textureSampleLevel(readTexture, non_filtering_sampler, g_uv, 0.0).rgb;
  let bcol = textureSampleLevel(readTexture, non_filtering_sampler, b_uv, 0.0).rgb;
  let color_rgb = vec3<f32>(rcol.r, gcol.g, bcol.b);

  // Fade based on how far we've scrolled: new objects fade in, old objects fade out
  let fade_in_dist = 0.1;
  let fade_out_dist = 0.9;
  let normalized_scroll = fract(scroll_offset);
  let fade_in = smoothstep(0.0, fade_in_dist, normalized_scroll);
  let fade_out = 1.0 - smoothstep(fade_out_dist, 1.0, normalized_scroll);
  let alpha = fade_in * fade_out;

  // Optional depth-based brightness for added 3D perception
  // Foreground (close) objects slightly brighter, background (far) objects slightly dimmer
  let depth_brightness = mix(1.1, 0.85, parallax_factor);
  let final_color = color_rgb * depth_brightness;

  return vec4<f32>(final_color, alpha);
}


@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  let uv = vec2<f32>(global_id.xy) / resolution;
  let zoom_time = u.zoom_config.x;
  let zoom_center = u.zoom_config.yz;

  var displaced_uv = uv; // Ripples are disabled

  let static_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

  // --- Compositing ---
  let layer1 = sample_zooming_layer(displaced_uv, static_depth, zoom_time, zoom_center, 0.0);
  let layer2 = sample_zooming_layer(displaced_uv, static_depth, zoom_time, zoom_center, 0.5);
  var final_color = mix(layer1, layer2, layer2.a);

  // <<< CHANGE #4: Add atmospheric fog to blend distant elements together.
  let fog_density = u.zoom_params.w;
  // A murky green-black is a good starting point for your image.
  let fog_color = vec3<f32>(0.05, 0.1, 0.08); 
  // The fog amount increases with distance (higher depth value).
  let fog_amount = pow(static_depth, 2.0) * fog_density; 
  
  final_color = vec4<f32>(mix(final_color.rgb, fog_color, fog_amount), final_color.a);

  textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));


  // --- Depth Texture Update ---
  // Mirror the radial scroll logic for depth to stay in sync with color motion
  let fg_speed = u.zoom_params.x;
  let bg_speed = u.zoom_params.y;
  let parallax_strength = u.zoom_params.z;
  
  let parallax_factor = pow(1.0 - static_depth, parallax_strength);
  let per_pixel_speed = mix(bg_speed, fg_speed, parallax_factor);

  // Use same scroll offset as color layer
  let scroll_offset = zoom_time * per_pixel_speed;
  let direction_from_center = displaced_uv - zoom_center;
  let radial_scale = 1.0 + scroll_offset * 0.5;
  let scrolled_uv = zoom_center + direction_from_center * radial_scale;

  // Seamless wrap for depth
  let wrapped_uv = ping_pong_v2(scrolled_uv);
  let transformed_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, wrapped_uv, 0.0).r;

  textureStore(writeDepthTexture, global_id.xy, vec4<f32>(transformed_depth, 0.0, 0.0, 0.0));
}
