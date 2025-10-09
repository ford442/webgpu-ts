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

    // --- MODIFIED: Start of Changes ---

    // 1. Define the base animation parameters.
    let rate = 0.8;
    let strength = 0.015;
    let frequency = 25.0;

    // 2. Calculate the foreground strength factor.
    // It returns 1.0 at depth 0.0 (closest) and smoothly ramps down to 0.0 at depth 0.15.
    // Any pixel with depth > 0.15 will have a strength of 0.
    let foreground_strength = 1.0 - smoothstep(0.0, 0.15, depth);

    // 3. Calculate the displacement vector.
    let anim_time = time * rate;
    let d1 = sin(uv.x * frequency + anim_time) * strength;
    let d2 = cos(uv.y * frequency * 1.3 + anim_time) * strength;
    let displacement = vec2<f32>(d1, d2);

    // 4. Apply the strength factor to the final displacement.
    // If foreground_strength is 0, the displacement will be zero.
    let final_displacement = displacement * foreground_strength;
    
    // --- MODIFIED: End of Changes ---

    var displacedUV = uv + final_displacement;

    var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
    textureStore(writeTexture, global_id.xy, color);
}
