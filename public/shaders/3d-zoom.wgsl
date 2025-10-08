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

// --- REMOVED: The old get_corrected_uvs function is no longer needed. ---

fn create_zooming_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let depth_threshold = u.config.x;
    let edge_hardness = u.config.y;
    let depth_levels = u.config.z;
    let edge_softness = (1.0 - edge_hardness) * 0.1;

    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
    
    // --- Depth-based Scaling from our previous step ---
    let initial_depth_uv = fract((uv - zoom_center) * (1.5 - (zoom_progress*1.49)) + zoom_center);
    var initial_parallax_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, initial_depth_uv, 0.0).r;
    let depth_based_scale_factor = 1.0 + initial_parallax_depth;
    let fg_scale = (1.5 * depth_based_scale_factor) - (zoom_progress * (1.49 * depth_based_scale_factor));
    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);
    // --- End scaling logic ---

    // --- INTEGRATED: Jules's Aspect Ratio Correction for Depth Map ---
    let image_res = u.resolutions.zw;
    let depth_res = u.depth_map_res.xy;
    let image_aspect = image_res.x / image_res.y;
    let depth_aspect = depth_res.x / depth_res.y;

    var depth_uv = repeating_uv;
    if (image_aspect > depth_aspect) {
        // Image aspect is wider than depth map's aspect
        let scale = depth_aspect / image_aspect;
        let offset = (1.0 - scale) / 2.0;
        depth_uv.y = depth_uv.y * scale + offset;
    } else {
        // Image aspect is taller than depth map's aspect
        let scale = image_aspect / depth_aspect;
        let offset = (1.0 - scale) / 2.0;
        depth_uv.x = depth_uv.x * scale + offset;
    }
    // --- End Correction ---

    var parallax_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, depth_uv, 0.0).r;
    let posterized_depth = floor(parallax_depth * depth_levels) / depth_levels;
    
    let parallax_offset = (repeating_uv - 0.5) * posterized_depth * 0.4;
    let final_uv = repeating_uv + parallax_offset;
    
    // The color texture doesn't need correction because we forced the canvas to match its aspect ratio
    let foreground_color = textureSampleLevel(readTexture, u_sampler, fract(final_uv), 0.0);

    let fade_in_duration = 0.25;
    var final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);

    let cutout_alpha = smoothstep(depth_threshold - edge_softness, depth_threshold + edge_softness, posterized_depth);
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
