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
  vortex_params: vec4<f32>,      // strength, speed, unused, unused
  ripples: array<vec4<f32>, 50>, // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

// Helper function to sample a single, depth-aware zooming layer (unchanged)
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
    let fg_max_scale = 3.0; 
    let depth_multiplier = mix(1.0, fg_max_scale, 1.0 - (depth / u.zoom_params.w));
    let scale = 1.0 + (1.0 - zoom_progress) * depth_multiplier;
    let repeating_uv = (uv - zoom_center) * scale + zoom_center;
    let parallax_offset = (repeating_uv - zoom_center) * depth * parallax_strength;
    let final_uv = repeating_uv + parallax_offset;
    let color = textureSampleLevel(readTexture, u_sampler, fract(final_uv), 0.0);
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

    // --- NEW: Sample static color and depth at the start ---
    // We'll use these at the end to ensure the background remains still.
    let static_color = textureSampleLevel(readTexture, u_sampler, uv, 0.0);
    let static_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

    // --- Liquid/ripple logic (unchanged) ---
    var totalDisplacement = vec2<f32>(0.0);
    let rippleCount = u32(u.config.y);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let rippleData = u.ripples[i];
        let timeSinceClick = u.config.x - rippleData.z;
        if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
            let direction_vec = uv - rippleData.xy;
            let dist = length(direction_vec);
            if (dist > 0.0001) {
                let rippleOriginDepthFactor = 1.0 - textureSampleLevel(readDepthTexture, non_filtering_sampler, rippleData.xy, 0.0).r;
                let ripple_speed = mix(1.0, 2.0, rippleOriginDepthFactor);
                let ripple_amplitude = mix(0.005, 0.015, rippleOriginDepthFactor);
                let wave = sin(dist * 25.0 - timeSinceClick * ripple_speed);
                let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / (3.0 * mix(0.5, 1.0, rippleOriginDepthFactor)));
                let falloff = 1.0 / (dist * 20.0 + 1.0);
                totalDisplacement += (direction_vec / dist) * wave * ripple_amplitude * falloff;
            }
        }
    }
    var displaced_uv = uv + totalDisplacement;

    // --- Vortex Logic (unchanged) ---
    let vortex_strength = u.vortex_params.x;
    let vortex_speed = u.vortex_params.y;
    let centered_uv = displaced_uv - zoom_center;
    let dist_from_center = length(centered_uv);
    let angle = u.zoom_config.x * vortex_speed + dist_from_center * vortex_strength;
    let s = sin(angle);
    let c = cos(angle);
    let rotated_centered_uv = vec2<f32>(centered_uv.x * c - centered_uv.y * s, centered_uv.x * s + centered_uv.y * c);
    displaced_uv = rotated_centered_uv + zoom_center;

    // --- Calculate the FULLY TRANSFORMED color ---
    let transformed_depth_sample = textureSampleLevel(readDepthTexture, non_filtering_sampler, displaced_uv, 0.0).r;
    let bg_scale = 1.0 + zoom_time * bg_speed;
    let bg_uv = (displaced_uv - zoom_center) * bg_scale + zoom_center;
    let background_color = textureSampleLevel(readTexture, u_sampler, fract(bg_uv), 0.0);
    let foreground1 = sample_zooming_layer(displaced_uv, transformed_depth_sample, zoom_time, zoom_center, 0.0);
    let foreground2 = sample_zooming_layer(displaced_uv, transformed_depth_sample, zoom_time, zoom_center, 0.5);
    let blended_foreground = mix(foreground1, foreground2, foreground2.a);
    let blend_amount = smoothstep(fg_depth_cutoff + 0.1, fg_depth_cutoff, transformed_depth_sample);
    let transformed_color_rgb = mix(background_color.rgb, blended_foreground.rgb, blend_amount);

    // --- NEW: Final Depth-Based Separation ---
    // Create the mask using the static, original depth.
    let effect_mask = pow(1.0 - smoothstep(0.0, fg_depth_cutoff, static_depth), 2.5);

    // Blend between the static color and the transformed color using the mask.
    let final_color_rgb = mix(static_color.rgb, transformed_color_rgb, effect_mask);
    textureStore(writeTexture, global_id.xy, vec4(final_color_rgb, 1.0));

    // --- Depth texture update with masking ---
    let main_zoom_progress = fract(zoom_time * u.zoom_params.x);
    let main_depth_multiplier = mix(1.0, 3.0, 1.0 - (transformed_depth_sample / fg_depth_cutoff));
    let main_scale = 1.0 + (1.0 - main_zoom_progress) * main_depth_multiplier;
    let main_repeating_uv = (displaced_uv - zoom_center) * main_scale + zoom_center;
    let transformed_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, fract(main_repeating_uv), 0.0).r;
    
    // Apply the same mask to the depth update to prevent artifacts.
    let final_depth = mix(static_depth, transformed_depth, effect_mask);
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(final_depth, 0.0, 0.0, 0.0));
}
