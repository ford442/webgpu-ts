// --- BINDINGS (Unchanged) ---
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var non_filtering_sampler: sampler;
@group(0) @binding(5) var staticDepthTexture: texture_2d<f32>;

struct Uniforms {
  resolutions: vec4<f32>,
  time_zoom: vec4<f32>,
  config: vec4<f32>,
  depth_map_res: vec4<f32>,
  color_map_res: vec4<f32>, 
  effect_params: vec4<f32>,
};

@group(0) @binding(3) var<uniform> u: Uniforms;

// --- UTILITY FUNCTIONS (Unchanged) ---
fn get_corrected_uvs(uv: vec2<f32>, canvas_res: vec2<f32>, texture_res: vec2<f32>) -> vec2<f32> {
  let canvas_aspect = canvas_res.x / canvas_res.y;
  let texture_aspect = texture_res.x / texture_res.y;
  var scale = vec2(1.0, 1.0);
  if (canvas_aspect > texture_aspect) {
    scale.x = texture_aspect / canvas_aspect;
  } else {
    scale.y = canvas_aspect / texture_aspect;
  }
  return (uv - 0.5) * scale + 0.5;
}

fn ease_out_quad(x: f32) -> f32 {
  return 1.0 - (1.0 - x) * (1.0 - x);
}

// --- CORE LOGIC: create_layer (Improved with single-pass Chromatic Aberration) ---
fn create_layer(
  uv: vec2<f32>,
  zoom_time: f32,
  zoom_center: vec2<f32>,
  cycle_offset: f32,
  zoom_speed: f32,
  min_depth: f32,
  max_depth: f32
) -> vec4<f32> {
  let canvas_res = u.resolutions.xy;
  let depth_res = u.depth_map_res.xy;
  let color_res = u.color_map_res.xy;
  let parallax_strength = u.effect_params.x;
  let ca_strength = u.effect_params.z; // Chromatic Aberration strength

  let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
  let eased_progress = ease_out_quad(zoom_progress);
  let layer_scale = eased_progress; // mix(u.zoom_range.x, u.zoom_range.y, eased_progress);

  let repeating_uv = fract((uv - zoom_center) * layer_scale + zoom_center);
  
  // Depth sampling remains the same
  let depth_uv = get_corrected_uvs(repeating_uv, canvas_res, depth_res);
  let parallax_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, depth_uv, 0.0).r;

  let view_dir = normalize(uv - zoom_center);
  let parallax_offset = view_dir * (parallax_depth * parallax_strength) / layer_scale;
  let final_uv = repeating_uv - parallax_offset;
  
  // *** CHANGE: SINGLE-PASS CHROMATIC ABERRATION IMPLEMENTATION ***
  // We apply the aberration by shifting the UVs for the R and B channels
  // when sampling the SOURCE texture (`readTexture`).
  let ca_dir = normalize(final_uv - 0.5); // Aberration spreads from center of the texture
  let ca_offset = ca_dir * ca_strength * 0.05; // Use a small multiplier

  let color_uv_g = get_corrected_uvs(final_uv, canvas_res, color_res); // Green channel is central
  let color_uv_r = get_corrected_uvs(final_uv - ca_offset, canvas_res, color_res);
  let color_uv_b = get_corrected_uvs(final_uv + ca_offset, canvas_res, color_res);

  let r_channel = textureSampleLevel(readTexture, u_sampler, fract(color_uv_r), 0.0).r;
  let g_channel = textureSampleLevel(readTexture, u_sampler, fract(color_uv_g), 0.0).g;
  let b_channel = textureSampleLevel(readTexture, u_sampler, fract(color_uv_b), 0.0).b;
  let layer_color = vec4(r_channel, g_channel, b_channel, 1.0);
  // *** END CHANGE ***

  // Fade-in for seamless loop
  let fade_in_duration = 0.25;
  var final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);

  // Edge-aware depth cutout (Unchanged)
  let texel_size = 1.0 / depth_res;
  let depth_x = textureSampleLevel(staticDepthTexture, non_filtering_sampler, depth_uv + vec2(texel_size.x, 0.0), 0.0).r;
  let depth_y = textureSampleLevel(staticDepthTexture, non_filtering_sampler, depth_uv + vec2(0.0, texel_size.y), 0.0).r;
  let edge_gradient = (abs(depth_x - parallax_depth) + abs(depth_y - parallax_depth)) * 1.5;

  let cutout_alpha = smoothstep(min_depth - edge_gradient, min_depth + edge_gradient, parallax_depth) *
                     (1.0 - smoothstep(max_depth - edge_gradient, max_depth + edge_gradient, parallax_depth));
  
  final_alpha = final_alpha * cutout_alpha;
  
  // We get the alpha from the green channel's sample, as it's the 'true' center.
  let center_alpha = textureSampleLevel(readTexture, u_sampler, fract(color_uv_g), 0.0).a;
  
  return vec4(layer_color.rgb, final_alpha * center_alpha);
}

// --- MAIN COMPUTE SHADER (Cleaned up, post-fx removed) ---
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let canvas_res = u.resolutions.xy;
  let uv = vec2<f32>(global_id.xy) / canvas_res;
  let zoom_time = u.time_zoom.x;
  let zoom_center = u.time_zoom.yz;

  // --- 1. Define Layer Properties ---
  let horizon_depth = .4; // u.layer_depths.x;
  let midground_depth = .8; // u.layer_depths.y;
  
  let slowest_speed = 0.005; // u.layer_speeds.x;
  let slow_speed = 0.015; //  u.layer_speeds.y;
  let fast_speed = 0.075; //  u.layer_speeds.z;

  // --- 2. Create and Blend Layers Sequentially ---
  let horizon1 = create_layer(uv, zoom_time, zoom_center, 0.0, slowest_speed, 0.0, horizon_depth);
  let horizon2 = create_layer(uv, zoom_time, zoom_center, 0.5, slowest_speed, 0.0, horizon_depth);
  let horizon_layer = mix(horizon1, horizon2, horizon2.a);

  let mid1 = create_layer(uv, zoom_time, zoom_center, 0.0, slow_speed, horizon_depth, midground_depth);
  let mid2 = create_layer(uv, zoom_time, zoom_center, 0.5, slow_speed, horizon_depth, midground_depth);
  let midground_layer = mix(mid1, mid2, mid2.a);

  let fg1 = create_layer(uv, zoom_time, zoom_center, 0.0, fast_speed, midground_depth, 1.0);
  let fg2 = create_layer(uv, zoom_time, zoom_center, 0.5, fast_speed, midground_depth, 1.0);
  let foreground_layer = mix(fg1, fg2, fg2.a);

  // --- 3. Composite Layers with Atmospheric Haze ---
  let fog_color = u.config.xyz;
  let fog_density = u.config.w;

  var final_color = vec4(0.0);
  final_color = mix(final_color, horizon_layer, horizon_layer.a);

  let haze_amount_mid = smoothstep(horizon_depth, midground_depth, 0.4) * 0.2;
  let hazed_midground = mix(midground_layer, vec4(fog_color, midground_layer.a), haze_amount_mid);
  final_color = mix(final_color, hazed_midground, hazed_midground.a);
  
  let haze_amount_fg = smoothstep(midground_depth, 1.0, 0.8) * 0.1;
  let hazed_foreground = mix(foreground_layer, vec4(fog_color, foreground_layer.a), haze_amount_fg);
  final_color = mix(final_color, hazed_foreground, hazed_foreground.a);

  // --- 4. Final Fog Pass ---
  let fog_depth_uv = get_corrected_uvs(uv, canvas_res, u.depth_map_res.xy);
  let base_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, fog_depth_uv, 0.0).r;
  let distance = 1.0 - base_depth;
  let fog_amount = 1.0 - exp(-distance * distance * fog_density);
  final_color.r = mix(final_color.r, fog_color.r, fog_amount);
  final_color.g = mix(final_color.g, fog_color.g, fog_amount);
  final_color.b = mix(final_color.b, fog_color.b, fog_amount);

  // Removed the invalid post-processing block.
  // Radial blur and true post-process CA must be done in a second pass.
  
  textureStore(writeTexture, global_id.xy, final_color);
}
