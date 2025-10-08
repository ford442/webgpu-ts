@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var non_filtering_sampler: sampler;
@group(0) @binding(5) var staticDepthTexture: texture_2d<f32>;

struct Uniforms {
  resolutions: vec4<f32>,
  time_zoom: vec4<f32>,
  config: vec4<f32>,
  depth_map_res: vec4<f32>,
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

// --- NEW: A more flexible layer creation function ---
fn create_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32,
    zoom_speed: f32,
    min_depth: f32, // The shallowest depth for this layer
    max_depth: f32  // The deepest depth for this layer
) -> vec4<f32> {
    let canvas_res = u.resolutions.xy;
    let depth_res = u.depth_map_res.xy;
    let depth_levels = u.config.z;
    let edge_softness = 0.02; // Use a small fixed softness for blending layers

    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
    let fg_scale = 1.5 - (zoom_progress * 1.49);
    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);

    let depth_uv = get_corrected_uvs(repeating_uv, canvas_res, depth_res);
    let parallax_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, depth_uv, 0.0).r;
    
    let parallax_offset = (repeating_uv - 0.5) * parallax_depth * 0.4;
    let final_uv = repeating_uv + parallax_offset;
    
    let foreground_color = textureSampleLevel(readTexture, u_sampler, fract(final_uv), 0.0);

    let fade_in_duration = 0.25;
    var final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);

    // This creates a "band pass" alpha mask, selecting only pixels within the min/max depth range
    let cutout_alpha = smoothstep(min_depth - edge_softness, min_depth + edge_softness, parallax_depth) *
                       (1.0 - smoothstep(max_depth - edge_softness, max_depth + edge_softness, parallax_depth));
    final_alpha = final_alpha * cutout_alpha;

    return vec4(foreground_color.rgb, final_alpha);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let canvas_res = u.resolutions.xy;
    let uv = vec2<f32>(global_id.xy) / canvas_res;
    let zoom_time = u.time_zoom.x;
    let zoom_center = u.time_zoom.yz;

    // --- NEW: Define our depth slices ---
    // These could become sliders in the UI later!
    let horizon_depth = 0.1; // Anything below this is static
    let midground_depth = 0.5; // Anything between horizon and this is mid-ground

    // 1. The Static Horizon
    // We sample the original image and check the depth at the current pixel (uv)
    let base_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, get_corrected_uvs(uv, canvas_res, u.depth_map_res.xy), 0.0).r;
    var final_color = textureSampleLevel(readTexture, u_sampler, uv, 0.0);
    // If the pixel is not part of the horizon, make it transparent for now
    if (base_depth > horizon_depth) {
        final_color.a = 0.0;
    }

    // 2. The Slow-Moving Mid-ground
    // Two layers, offset in time, moving slowly, for the mid-ground depth slice
    let slow_speed = 0.03;
    let mid1 = create_layer(uv, zoom_time, zoom_center, 0.0, slow_speed, horizon_depth, midground_depth);
    let mid2 = create_layer(uv, zoom_time, zoom_center, 0.5, slow_speed, horizon_depth, midground_depth);
    let blended_midground = mix(mid1, mid2, mid2.a);
    // Blend the mid-ground over the static horizon
    final_color = mix(final_color, blended_midground, blended_midground.a);

    // 3. The Fast-Moving Foreground
    // Two layers, offset in time, moving quickly, for the foreground depth slice
    let fast_speed = 0.15;
    let fg1 = create_layer(uv, zoom_time, zoom_center, 0.0, fast_speed, midground_depth, 1.0);
    let fg2 = create_layer(uv, zoom_time, zoom_center, 0.5, fast_speed, midground_depth, 1.0);
    let blended_foreground = mix(fg1, fg2, fg2.a);
    // Blend the foreground over the result of the previous blend
    final_color = mix(final_color, blended_foreground, blended_foreground.a);
    
    textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));
}
