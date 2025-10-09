@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;

struct Uniforms {
    resolution: vec2<f32>,
    mouse: vec2<f32>, // Added mouse coordinates
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let uv = vec2<f32>(global_id.xy) / u.resolution;
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    var final_color = textureSampleLevel(readTexture, u_sampler, uv);

    // 1. Top-down light on the closest 25% of the depth map
    let top_light_factor = 1.0 - smoothstep(0.0, 0.25, depth);
    let top_light_intensity = 0.2 * top_light_factor;
    final_color.rgb += vec3<f32>(top_light_intensity);

    // 2. Shadow on the farthest 50% of the depth map
    let shadow_factor = smoothstep(0.5, 0.8, depth);
    let shadow_intensity = 0.35 * shadow_factor;
    final_color.rgb -= vec3<f32>(shadow_intensity);

    // 3. Spotlight that follows the mouse
    if (u.mouse.x > 0.0) {
        let mouse_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, u.mouse.xy, 0.0).r;
        if (depth >= mouse_depth - 0.05) {
            let dist_to_mouse = distance(uv, u.mouse.xy);
            let light_radius = 0.2;
            let falloff = smoothstep(light_radius, 0.0, dist_to_mouse);
            let light_intensity = falloff * 0.6;
            final_color.rgb += vec3<f32>(light_intensity);
        }
    }
    
    final_color.rgb = clamp(final_color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    textureStore(writeTexture, global_id.xy, final_color);
}
