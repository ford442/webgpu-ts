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
  let color_res = u.color_map_res.xy; // NEW: Get color texture resolution
  let parallax_strength = u.effect_params.x;
  let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
  let fg_scale = 1.5 - (zoom_progress * 1.49);
  let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);
  // Correctly sample depth using aspect-corrected UVs
  let depth_uv = get_corrected_uvs(repeating_uv, canvas_res, depth_res);
  let parallax_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, depth_uv, 0.0).r;
    // Calculate view-corrected parallax offset
  let view_dir = normalize(uv - zoom_center);
  let parallax_offset = view_dir * (parallax_depth * parallax_strength) / fg_scale;
  let final_uv = repeating_uv - parallax_offset;
    // Before sampling the color texture, convert final_uv to the color texture's coordinate space.
  let color_uv = get_corrected_uvs(final_uv, canvas_res, color_res);
  // Use the corrected color_uv for the texture sample
  let foreground_color = textureSampleLevel(readTexture, u_sampler, fract(color_uv), 0.0);
  let fade_in_duration = 0.25;
  var final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);
  let texel_size = 1.0 / depth_res;
  let depth_x = textureSampleLevel(staticDepthTexture, non_filtering_sampler, depth_uv + vec2(texel_size.x, 0.0), 0.0).r;
  let depth_y = textureSampleLevel(staticDepthTexture, non_filtering_sampler, depth_uv + vec2(0.0, texel_size.y), 0.0).r;
  let gradient_x = abs(depth_x - parallax_depth);
  let gradient_y = abs(depth_y - parallax_depth);
  let edge_gradient = (gradient_x + gradient_y) * 1.5;
  let cutout_alpha = smoothstep(min_depth - edge_gradient, min_depth + edge_gradient, parallax_depth) * (1.0 - smoothstep(max_depth - edge_gradient, max_depth + edge_gradient, parallax_depth));
  final_alpha = final_alpha * cutout_alpha;
  return vec4(foreground_color.rgb, final_alpha);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let canvas_res = u.resolutions.xy;
  let uv = vec2<f32>(global_id.xy) / canvas_res;
  let zoom_time = u.time_zoom.x;
  let zoom_center = u.time_zoom.yz;

  let horizon_depth = 0.25;
  let midground_depth = 0.8;

  // --- STEP 1: Calculate all layers as usual ---

  // 1. Horizon Layer
  let slowest_speed = 0.00;
  let horizon1 = create_layer(uv, zoom_time, zoom_center, 0.0, slowest_speed, 0.0, horizon_depth);
  let horizon2 = create_layer(uv, zoom_time, zoom_center, 0.5, slowest_speed, 0.0, horizon_depth);
  let blended_horizon = mix(horizon1, horizon2, horizon2.a);

  // 2. Mid-ground Layer
  let slow_speed = 0.08;
  let mid1 = create_layer(uv, zoom_time, zoom_center, 0.0, slow_speed, horizon_depth, midground_depth);
  let mid2 = create_layer(uv, zoom_time, zoom_center, 0.5, slow_speed, horizon_depth, midground_depth);
  let blended_midground = mix(mid1, mid2, mid2.a);

  // 3. Foreground Layer
  let fast_speed = 0.16;
  let fg1 = create_layer(uv, zoom_time, zoom_center, 0.0, fast_speed, midground_depth, 1.0);
  let fg2 = create_layer(uv, zoom_time, zoom_center, 0.5, fast_speed, midground_depth, 1.0);
  let blended_foreground = mix(fg1, fg2, fg2.a);


  // --- STEP 2: Compose the final image with a hard cutout ---
  
  // First, create the background by blending the horizon and midground together.
  var background_color = mix(vec4(0.0), blended_horizon, blended_horizon.a);
  background_color = mix(background_color, blended_midground, blended_midground.a);

  // Next, create a binary (0.0 or 1.0) mask from the foreground's alpha.
  // step(0.01, x) returns 0.0 if x < 0.01, and 1.0 otherwise.
  let foreground_mask = step(0.01, blended_foreground.a);

  // Finally, use the mask to choose between the background and the opaque foreground.
  // This avoids blending and creates a sharp, solid cutout.
  var final_color = mix(background_color, vec4(blended_foreground.rgb, 1.0), foreground_mask);

  // --- Apply Fog ---
  // Note: Fog is applied to the final composed image.
  let fog_depth_uv = get_corrected_uvs(uv, canvas_res, u.depth_map_res.xy);
  let base_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, fog_depth_uv, 0.0).r;
  let fog_color = u.config.xyz;
  let fog_density = u.config.w;
  let distance = 1.0 - base_depth;
  let fog_amount = 1.0 - exp(-distance * distance * fog_density);
  let mixed_rgb = mix(final_color.rgb, fog_color, fog_amount);

  textureStore(writeTexture, global_id.xy, vec4<f32>(mixed_rgb, 1.0));
}
