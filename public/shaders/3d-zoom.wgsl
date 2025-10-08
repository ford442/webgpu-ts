@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var non_filtering_sampler: sampler;
@group(0) @binding(5) var staticDepthTexture: texture_2d<f32>;

struct Uniforms {
  resolutions: vec4<f32>,     // .xy = canvas, .zw = image
  time_zoom: vec4<f32>,       // .x = time, .yz = zoom_center
  config: vec4<f32>,          // .x = depthThreshold, .y = edgeHardness, .z = depthLevels
  depth_map_res: vec4<f32>, // .xy = depth map dimensions
};
@group(0) @binding(3) var<uniform> u: Uniforms;

fn create_zooming_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let canvas_res = u.resolutions.xy;
    let depth_res = u.depth_map_res.xy;
    let depth_threshold = u.config.x;
    let edge_hardness = u.config.y;
    let depth_levels = u.config.z;
    let edge_softness = (1.0 - edge_hardness) * 0.1;

    // We first calculate a repeating UV with a baseline speed to find out what object is at this pixel
    let base_repeating_uv = fract((uv - zoom_center) * (1.5 - (fract(zoom_time * 0.15 + cycle_offset) * 1.49)) + zoom_center);
    let depth_uv = get_corrected_uvs(base_repeating_uv, canvas_res, depth_res);
    let parallax_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, depth_uv, 0.0).r;
    let posterized_depth = floor(parallax_depth * depth_levels) / depth_levels;

    // --- NEW: Calculate zoom_speed based on depth ---
    // Objects with depth 0 (far) will have a speed of 0.1.
    // Objects with depth 1.0 (near) will have a speed of 0.4.
    let zoom_speed = 0.1 + posterized_depth * 0.3;

    // --- CORRECTED LOGIC ---
    // Now, we recalculate the zoom progress and scale using this new depth-based speed
    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
    let fg_scale = 1.5 - (zoom_progress * 1.49);
    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);

    // All subsequent calculations proceed as before
    let final_depth_uv = get_corrected_uvs(repeating_uv, canvas_res, depth_res);
    let final_parallax_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, final_depth_uv, 0.0).r;
    let final_posterized_depth = floor(final_parallax_depth * depth_levels) / depth_levels;
    
    let parallax_offset = (repeating_uv - 0.5) * final_posterized_depth * 0.4;
    let final_uv = repeating_uv + parallax_offset;
    
    let foreground_color = textureSampleLevel(readTexture, u_sampler, fract(final_uv), 0.0);

    let fade_in_duration = 0.25;
    var final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);

    let cutout_alpha = smoothstep(depth_threshold - edge_softness, depth_threshold + edge_softness, final_posterized_depth);
    final_alpha = final_alpha * cutout_alpha;

    return vec4(foreground_color.rgb, final_alpha);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let canvas_res = u.resolutions.xy;
    let uv = vec2<f32>(global_id.xy) / canvas_res;
    let zoom_time = u.time_zoom.x;
    let zoom_center = u.time_zoom.yz;

    let background_color = textureSampleLevel(readTexture, u_sampler, uv, 0.0);
    
    let foreground1 = create_zooming_layer(uv, zoom_time, zoom_center, 0.0);
    let foreground2 = create_zooming_layer(uv, zoom_time, zoom_center, 0.5);
    
    let blended_foreground = mix(foreground1, foreground2, foreground2.a);
    let final_color = mix(background_color, blended_foreground, blended_foreground.a);
    
    textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));
}
