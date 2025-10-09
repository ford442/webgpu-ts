@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;

struct Uniforms {
    resolution: vec2<f32>,
    mouse: vec2<f32>,
    mouseDown: f32, // 1.0 if down, 0.0 if up
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let uv = vec2<f32>(global_id.xy) / u.resolution;
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    var final_color = textureSampleLevel(readTexture, u_sampler, uv, 0.0);

    if (u.mouseDown > 0.5) {
        let mouse_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, u.mouse.xy, 0.0).r;
        let dist_to_mouse = distance(uv, u.mouse.xy);
        let is_source_object = abs(depth - mouse_depth) < 0.05;
        let source_radius = 0.1;

        if (dist_to_mouse < source_radius && is_source_object) {
            let glow_factor = 1.0 - smoothstep(0.0, source_radius, dist_to_mouse);
            let mixed_rgb = mix(final_color.rgb, vec3(1.0, 0.9, 0.8), glow_factor * 0.7);
            final_color = vec4(mixed_rgb, final_color.a);
        }

        if (depth >= mouse_depth - 0.02) {
            let light_radius = 0.35;
            let falloff = smoothstep(light_radius, 0.0, dist_to_mouse);
            let light_occlusion = 1.0 - smoothstep(source_radius - 0.01, source_radius, dist_to_mouse);
            let final_falloff = falloff * light_occlusion;
            final_color = vec4(final_color.rgb + vec3(1.0, 0.85, 0.7) * final_falloff * 0.8, final_color.a);
        }
    } else {
        let top_light_factor = 1.0 - smoothstep(0.0, 0.25, depth);
        final_color = vec4(final_color.rgb + vec3<f32>(0.2 * top_light_factor), final_color.a);

        let shadow_factor = smoothstep(0.5, 0.8, depth);
        final_color = vec4(final_color.rgb - vec3<f32>(0.35 * shadow_factor), final_color.a);

        if (u.mouse.x > 0.0) {
            let mouse_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, u.mouse.xy, 0.0).r;
            if (depth >= mouse_depth - 0.05) {
                let dist_to_mouse = distance(uv, u.mouse.xy);
                let falloff = smoothstep(0.2, 0.0, dist_to_mouse);
                final_color = vec4(final_color.rgb + vec3<f32>(falloff * 0.6), final_color.a);
            }
        }
    }
    
    // --- THIS IS THE CORRECTED LINE ---
    let clamped_rgb = clamp(final_color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    final_color = vec4(clamped_rgb, final_color.a);
    
    textureStore(writeTexture, global_id.xy, final_color);
}
