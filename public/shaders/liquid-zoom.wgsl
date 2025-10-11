// public/shaders/liquid-zoom.wgsl

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,          // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,      // zoomTime, farthestX, farthestY, unused
  zoom_params: vec4<f32>,      // fg_speed, bg_speed, parallax_str, fg_depth_cutoff
  ripples: array<vec4<f32>, 50>, // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

// Helper function is unchanged
fn sample_zooming_layer(
    uv: vec2<f32>,
    depth: f32,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let fg_speed = u.zoom_params.x;
    let zoom_progress = fract(zoom_time * fg_speed + cycle_offset);
    let zoom_intensity = 2.5;
    let scale = 1.0 + (1.0 - zoom_progress) * zoom_intensity;
    let repeating_uv = (uv - zoom_center) * scale + zoom_center;
    let color = textureSampleLevel(readTexture, u_sampler, fract(repeating_uv), 0.0);
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
    let fg_depth_cutoff = u.zoom_params.w;

    // --- Define Layers ---
    // 1. The background layer is the original, untouched image.
    let background_color = textureSampleLevel(readTexture, u_sampler, uv, 0.0);
    let static_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

    // (Ripples are disabled for a clean effect)
    var displaced_uv = uv;

    // 2. The foreground layer is the cross-fading zoom effect.
    // We sample depth here from the displaced UV to inform the zoom calculation.
    let transformed_depth_sample = textureSampleLevel(readDepthTexture, non_filtering_sampler, displaced_uv, 0.0).r;
    let foreground1 = sample_zooming_layer(displaced_uv, transformed_depth_sample, zoom_time, zoom_center, 0.0);
    let foreground2 = sample_zooming_layer(displaced_uv, transformed_depth_sample, zoom_time, zoom_center, 0.5);
    let blended_foreground = mix(foreground1, foreground2, foreground2.a);

    // --- MODIFICATION: Composite the Layers ---
    // Create a cutout mask based on the original depth map. This defines the shape of our foreground objects.
    let cutout_mask = pow(1.0 - smoothstep(0.0, fg_depth_cutoff, static_depth), 2.5);

    // The final alpha for the foreground is a combination of its own fade-in/out animation AND its shape.
    let final_foreground_alpha = blended_foreground.a * cutout_mask;

    // Blend the foreground layer over the background layer using standard alpha blending.
    let final_color_rgb = mix(
        background_color.rgb,
        blended_foreground.rgb,
        final_foreground_alpha
    );

    textureStore(writeTexture, global_id.xy, vec4(final_color_rgb, 1.0));

    // --- Depth texture update (logic is sound and remains the same) ---
    let main_zoom_progress = fract(zoom_time * u.zoom_params.x);
    let main_zoom_intensity = 2.5;
    let main_scale = 1.0 + (1.0 - main_zoom_progress) * main_zoom_intensity;
    let main_repeating_uv = (displaced_uv - zoom_center) * main_scale + zoom_center;
    let transformed_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, fract(main_repeating_uv), 0.0).r;
    let final_depth = mix(static_depth, transformed_depth, cutout_mask);
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(final_depth, 0.0, 0.0, 0.0));
}
