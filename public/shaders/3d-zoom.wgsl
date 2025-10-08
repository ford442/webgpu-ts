@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,        // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,   // zoomTime, farthestX, farthestY, depthThreshold
};

@group(0) @binding(3) var<uniform> u: Uniforms;

// --- Helper function to calculate a zooming foreground COLOR layer ---
fn create_zooming_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let background_depth_threshold = u.zoom_config.w;
    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
    let fg_scale = 1.5 - (zoom_progress * 1.49);
    
    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);
    
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, repeating_uv, 0.0).r;
    let parallax_offset = (repeating_uv - 0.5) * depth * 0.4;
    let parallax_uv = repeating_uv + parallax_offset;
    let foreground_color = textureSampleLevel(readTexture, u_sampler, fract(parallax_uv), 0.0);

    let fade_in_duration = 0.25;
    var final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);

    // --- FIXED: Inverted logic is now corrected ---
    // This now correctly returns 1.0 for foreground and 0.0 for background.
    let cutout_alpha = smoothstep(background_depth_threshold - 0.01, background_depth_threshold, depth);
    
    final_alpha = final_alpha * cutout_alpha;

    return vec4(foreground_color.rgb, final_alpha);
}

// --- Helper function to create a scrolling foreground DEPTH layer ---
fn create_zooming_depth_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let background_depth_threshold = u.zoom_config.w;
    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
    let fg_scale = 1.5 - (zoom_progress * 1.49);
    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, repeating_uv, 0.0).r;
    
    // --- FIXED: Inverted logic is now corrected ---
    var alpha = smoothstep(background_depth_threshold - 0.01, background_depth_threshold, depth);

    let fade_in_duration = 0.25;
    alpha = alpha * smoothstep(0.0, fade_in_duration, zoom_progress);
    return vec4(depth, 0.0, 0.0, alpha);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let zoom_time = u.zoom_config.x;
    let zoom_center = u.zoom_config.yz;
    let displaced_uv = uv;

    // --- Continuous Zoom Logic for COLOR ---
    let background_color = textureSampleLevel(readTexture, u_sampler, uv, 0.0);
    let foreground1 = create_zooming_layer(displaced_uv, zoom_time, zoom_center, 0.0);
    let foreground2 = create_zooming_layer(displaced_uv, zoom_time, zoom_center, 0.5);
    let blended_foreground = mix(foreground1, foreground2, foreground2.a);
    let final_color = mix(background_color, blended_foreground, blended_foreground.a);
    textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));

    // --- Continuous Zoom Logic for DEPTH ---
    let background_depth_threshold = u.zoom_config.w;
    let bg_scale = pow(0.95, zoom_time);
    let bg_uv = (displaced_uv - zoom_center) * bg_scale + zoom_center;

    let base_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, fract(bg_uv), 0.0).r;
    var background_depth = 1.0;
    if (base_depth < background_depth_threshold) {
        background_depth = base_depth;
    }

    let foreground_depth1 = create_zooming_depth_layer(displaced_uv, zoom_time, zoom_center, 0.0);
    let foreground_depth2 = create_zooming_depth_layer(displaced_uv, zoom_time, zoom_center, 0.5);

    let blended_foreground_depth = mix(foreground_depth1, foreground_depth2, foreground_depth2.a);
    let final_depth = mix(vec4(background_depth,0,0,1), blended_foreground_depth, blended_foreground_depth.a).r;
    
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(final_depth, 0.0, 0.0, 0.0));
}
