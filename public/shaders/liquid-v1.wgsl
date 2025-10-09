@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
    time: f32,
    resolutionX: f32,
    resolutionY: f32,
};

@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(u.resolutionX, u.resolutionY);
    let uv = vec2<f32>(global_id.xy) / resolution;
    let time = u.time;

    // --- MODIFIED: Start of Changes ---

    // 1. Create a very subtle and slow vertical motion for the depth map.
    let depth_rate = 0.1;
    let depth_strength = 0.002;
    let depth_time = time * depth_rate;
    let depth_displacement = vec2<f32>(0.0, sin(depth_time) * depth_strength);
    let displaced_depth_uv = uv + depth_displacement;
    let moving_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displaced_depth_uv, 0.0).r;

    // 2. Calculate a more subtle base motion for the color.
    let bg_rate = 0.2;
    let bg_strength = 0.013;
    let bg_freq = 10.0;
    let bg_time = time * bg_rate;
    let bg_d1 = sin(uv.y * bg_freq + bg_time) * bg_strength;
    let bg_d2 = cos(uv.x * bg_freq * 0.7 + bg_time) * bg_strength;
    let background_displacement = vec2<f32>(bg_d1, bg_d2);

    // 3. Define a toned-down foreground motion.
    let fg_rate = 0.5;
    let fg_strength = 0.008;
    let fg_freq = 18.0;
    let fg_time = time * fg_rate;
    let fg_d1 = sin(uv.x * fg_freq + fg_time) * fg_strength;
    let fg_d2 = cos(uv.y * fg_freq * 1.3 + fg_time) * fg_strength;
    let foreground_displacement = vec2<f32>(fg_d1, fg_d2);
    
    // 4. Use the moving depth to blend the foreground effect.
    let foreground_mix_factor = 1.0 - smoothstep(0.0, 0.25, moving_depth);

    // 5. Combine all displacements. We start with the depth's own movement,
    // ensuring the color sticks to the moving depth contours.
    let final_displacement = depth_displacement + background_displacement + (foreground_displacement * foreground_mix_factor);
    let displaced_color_uv = uv + final_displacement;
    let color = textureSampleLevel(readTexture, u_sampler, displaced_color_uv, 0.0);

    // 6. Store results for the next frame.
    textureStore(writeTexture, global_id.xy, color);
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(moving_depth, 0.0, 0.0, 0.0));
    
    // --- MODIFIED: End of Changes ---
}
