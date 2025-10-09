@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;

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
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    let time = u.time;

    let bg_rate = 0.5;
    let bg_strength = 0.02;
    let bg_freq = 15.0;
    
    let fg_rate = 0.8;      // Faster time rate for foreground
    let fg_strength = 0.01; // More subtle movement
    let fg_freq = 25.0;     // Higher frequency for a different pattern

    let bg_time = time * bg_rate;
    let bg_d1 = sin(uv.y * bg_freq + bg_time) * bg_strength; // Swapped uv.x/y
    let bg_d2 = cos(uv.x * bg_freq * 0.7 + bg_time) * bg_strength;
    let bg_displacement = vec2<f32>(bg_d1, bg_d2);

    let fg_time = time * fg_rate;
    let fg_d1 = sin(uv.x * fg_freq + fg_time) * fg_strength;
    let fg_d2 = cos(uv.y * fg_freq * 1.3 + fg_time) * fg_strength; // Changed multiplier
    let fg_displacement = vec2<f32>(fg_d1, fg_d2);

    // 4. Create a "foreground factor" to blend the two motions.
    // This will be 1.0 for the absolute foreground (depth < 0.1)
    // and smoothly decrease to 0.0 for the background.
    let foreground_factor = smoothstep(0.1, 0.5, depth);
    let final_displacement = mix(bg_displacement, fg_displacement, foreground_factor);
    
    var displacedUV = uv + final_displacement;
    var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
    textureStore(writeTexture, global_id.xy, color);
}
