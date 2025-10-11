@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,          // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,      // zoomTime, farthestX, farthestY, unused
  // --- IMPROVEMENT #1: Centralized control for zoom effects ---
  zoom_params: vec4<f32>,      // fg_speed, bg_speed, parallax_str, fg_depth_cutoff
  ripples: array<vec4<f32>, 50>, // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

// Helper function to sample a single, depth-aware zooming layer
fn sample_zooming_layer(
    uv: vec2<f32>,
    depth: f32,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let fg_speed = u.zoom_params.x;
    let parallax_strength = u.zoom_params.z;
    let zoom_progress = fract(zoom_time * fg_speed + cycle_offset);

    // --- IMPROVEMENT #2: Depth-based scaling ---
    // The core of the new effect. Closer pixels (lower depth) get a higher
    // scale multiplier, making them zoom past faster than farther pixels.
    // 'fg_max_scale' determines how large the closest objects get.
    let fg_max_scale = 3.0; 
    let depth_multiplier = mix(1.0, fg_max_scale, 1.0 - (depth / u.zoom_params.w));
    
    // Scale starts high and goes to 1.0 (no zoom) as progress -> 1.0
    let scale = 1.0 + (1.0 - zoom_progress) * depth_multiplier;

    let repeating_uv = (uv - zoom_center) * scale + zoom_center;

    // The parallax effect is now a subtle addition to the main depth scaling
    let parallax_offset = (repeating_uv - zoom_center) * depth * parallax_strength;
    let final_uv = repeating_uv + parallax_offset;

    let color = textureSampleLevel(readTexture, u_sampler, fract(final_uv), 0.0);

    // Fade in the layer at the beginning of its cycle
    let fade_in_duration = 0.2;
    let alpha = smoothstep(0.0, fade_in_duration, zoom_progress);

    return vec4(color.rgb, alpha);
}


@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let currentTime = u.config.x;
    let zoom_time = u.zoom_config.x;
    let zoom_center = u.zoom_config.yz;
    let bg_speed = u.zoom_params.y;
    let fg_depth_cutoff = u.zoom_params.w;

    // --- Liquid/ripple logic (calculates 'displaced_uv') ---
    // This part remains unchanged.
    var totalDisplacement = vec2<f32>(0.0);
    // ... (your existing ripple code) ...
    let displaced_uv = uv + totalDisplacement;

    // --- IMPROVEMENT #3: Revamped Zoom & Layering Logic ---

    // 1. Get the authoritative depth for the current pixel.
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displaced_uv, 0.0).r;

    // 2. Calculate the background layer.
    // 'bg_speed' can be positive (zoom in), zero (static), or negative (zoom out).
    let bg_scale = 1.0 + zoom_time * bg_speed;
    let bg_uv = (displaced_uv - zoom_center) * bg_scale + zoom_center;
    let background_color = textureSampleLevel(readTexture, u_sampler, fract(bg_uv), 0.0);

    // 3. Calculate two cross-fading foreground layers for a seamless tunnel.
    // Pass the pixel's specific 'depth' to each.
    let foreground1 = sample_zooming_layer(displaced_uv, depth, zoom_time, zoom_center, 0.0);
    let foreground2 = sample_zooming_layer(displaced_uv, depth, zoom_time, zoom_center, 0.5);

    // 4. Blend the two foreground layers together based on their alpha.
    let blended_foreground = mix(foreground1, foreground2, foreground2.a);

    // --- IMPROVEMENT #4: Depth-based final blend ---
    // Instead of a simple alpha mix, we use the depth map to decide if a pixel
    // belongs to the foreground or background. This creates a perfect composite.
    let blend_amount = smoothstep(fg_depth_cutoff + 0.1, fg_depth_cutoff, depth);
    let final_color_rgb = mix(background_color.rgb, blended_foreground.rgb, blend_amount);

    textureStore(writeTexture, global_id.xy, vec4(final_color_rgb, 1.0));

    // --- Depth texture update remains conceptually similar ---
    // It should reflect the primary transformed UV for the next frame's ripples.
    let main_zoom_progress = fract(zoom_time * u.zoom_params.x);
    let main_depth_multiplier = mix(1.0, 3.0, 1.0 - (depth / fg_depth_cutoff));
    let main_scale = 1.0 + (1.0 - main_zoom_progress) * main_depth_multiplier;
    let main_repeating_uv = (displaced_uv - zoom_center) * main_scale + zoom_center;
    let new_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, fract(main_repeating_uv), 0.0).r;
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(new_depth, 0.0, 0.0, 0.0));
}
