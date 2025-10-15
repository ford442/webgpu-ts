// Corrected: public/shaders/vortex.wgsl

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(6) var nearest_sampler: sampler;

struct Uniforms {
    params: array<vec4<f32>, 16>,
};
@group(0) @binding(1) var<uniform> u: Uniforms;
@group(0) @binding(2) var primaryTexture: texture_2d<f32>;
@group(0) @binding(3) var utilityTexture1: texture_2d<f32>;

// BINDING FIX: The writable output texture is now at its correct slot.
@group(0) @binding(5) var outputTexture: texture_storage_2d<rgba8unorm, write>;

fn create_zooming_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
    let fg_scale = 1.5 - (zoom_progress * 1.49);
    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);
    let depth = textureSampleLevel(utilityTexture1, nearest_sampler, repeating_uv, 0.0).r;
    let parallax_offset = (repeating_uv - 0.5) * depth * 0.4;
    let parallax_uv = repeating_uv + parallax_offset;
    let foreground_color = textureSampleLevel(primaryTexture, u_sampler, fract(parallax_uv), 0.0);
    let fade_in_duration = 0.25;
    let final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);
    return vec4(foreground_color.rgb, final_alpha);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let time = u.params[0].x;
    let resolution = u.params[1].xy;
    let zoom_center = u.params[1].zw; // Assuming zoom center is passed here.
    let uv = vec2<f32>(global_id.xy) / resolution;
    // --- Continuous Zoom Logic ---
    let bg_scale = pow(0.95, time);
    let bg_uv = (uv - zoom_center) * bg_scale + zoom_center;
    let background_color = textureSampleLevel(primaryTexture, u_sampler, fract(bg_uv), 0.0);
    let foreground1 = create_zooming_layer(uv, time, zoom_center, 0.0);
    let foreground2 = create_zooming_layer(uv, time, zoom_center, 0.5);
    let blended_foreground = mix(foreground1, foreground2, foreground2.a);
    let final_color = mix(background_color, blended_foreground, blended_foreground.a);
    textureStore(outputTexture, global_id.xy, vec4(final_color.rgb, 1.0));
}
