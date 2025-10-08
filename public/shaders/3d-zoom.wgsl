@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,        // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,   // zoomTime, farthestX, farthestY, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

// --- Helper function to calculate a zooming foreground layer ---
fn create_zooming_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);

    // The scale now goes from 1.5 down to almost 0, creating a much larger zoom.
    let fg_scale = 1.5 - (zoom_progress * 1.49);
    
    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, repeating_uv, 0.0).r;
    let parallax_offset = (repeating_uv - 0.5) * depth * 0.4;
    let parallax_uv = repeating_uv + parallax_offset;

    // By wrapping the final UV coordinate with fract(), we ensure it never goes
    // out of bounds, which prevents the "missing texture" issue at the edges.
    let foreground_color = textureSampleLevel(readTexture, u_sampler, fract(parallax_uv), 0.0);

    // This makes the layer fade in smoothly at the start and then stay fully
    // visible as it zooms past the camera, instead of dissolving away.
    let fade_in_duration = 0.25;
    let final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);

    return vec4(foreground_color.rgb, final_alpha);
}


@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let zoom_time = u.zoom_config.x;
    let zoom_center = u.zoom_config.yz;

    // --- Liquid/ripple logic is removed ---
    let displaced_uv = uv;

    // --- Continuous Zoom Logic ---

    // 1. Calculate the slow, continuous zoom for the absolute background.
    let bg_scale = pow(0.95, zoom_time);
    let bg_uv = (displaced_uv - zoom_center) * bg_scale + zoom_center;
    let background_color = textureSampleLevel(readTexture, u_sampler, fract(bg_uv), 0.0);

    // 2. Calculate two foreground layers, offset by half a cycle.
    let foreground1 = create_zooming_layer(displaced_uv, zoom_time, zoom_center, 0.0);
    let foreground2 = create_zooming_layer(displaced_uv, zoom_time, zoom_center, 0.5); // Offset by 0.5

    // 3. Blend the layers. Mix the second layer on top of the first, then mix the result on top of the background.
    let blended_foreground = mix(foreground1, foreground2, foreground2.a);
    let final_color = mix(background_color, blended_foreground, blended_foreground.a);

    textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));

    // Update the depth texture for the next frame (using the primary foreground UVs)
    let main_zoom_progress = fract(zoom_time * 0.15);
    let main_fg_scale = 1.0 - (main_zoom_progress * 0.5);
    let main_repeating_uv = fract((displaced_uv - zoom_center) * main_fg_scale + zoom_center);
    let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, main_repeating_uv, 0.0).r;
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
}
