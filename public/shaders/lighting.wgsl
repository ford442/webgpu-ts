@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;

struct Uniforms {
  mouse: vec2<f32>, // Normalized 0-1 coordinates
  resolution: vec2<f32>,
  time: f32,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let uv = vec2<f32>(global_id.xy) / u.resolution;
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    var final_color = textureSampleLevel(readTexture, u_sampler, uv, 0.0).r;

    // 1. Top-down light on the closest 25% of the depth map
    // The light is strongest at depth 0.0 and fades out by 0.25.
    let top_light_factor = 1.0 - smoothstep(0.0, 0.25, depth);
    let top_light_intensity = 0.2 * top_light_factor;
    final_color.rgb += vec3<f32>(top_light_intensity);

    // 2. Shadow on the farthest 50% of the depth map
    // The shadow starts at depth 0.5 and is darkest by 0.8.
    let shadow_factor = smoothstep(0.5, 0.8, depth);
    let shadow_intensity = 0.35 * shadow_factor;
    final_color.rgb -= vec3<f32>(shadow_intensity);

    // 3. Spotlight that follows the mouse
    // We check if mouse.x is positive to see if it's on the canvas.
    if (u.mouse.x > 0.0) {
        let mouse_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, u.mouse.xy, 0.0).r;
        
        // Occlusion Check: The light won't shine "through" closer objects.
        // The current pixel must be at or behind the depth of the mouse cursor.
        if (depth >= mouse_depth - 0.05) { // -0.05 gives a little softness to the edge
            let dist_to_mouse = distance(uv, u.mouse.xy);
            let light_radius = 0.2;
            let falloff = smoothstep(light_radius, 0.0, dist_to_mouse);
            let light_intensity = falloff * 0.6; // Spotlight brightness
            final_color.rgb += vec3<f32>(light_intensity);
        }
    }
    
    // Clamp the final color to ensure it's a valid value between 0.0 and 1.0
    final_color.rgb = clamp(final_color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    textureStore(writeTexture, global_id.xy, final_color);
}
