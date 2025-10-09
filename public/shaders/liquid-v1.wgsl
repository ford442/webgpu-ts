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
    
    // --- MODIFIED: Start of changes ---

    // 1. Define the base animation parameters.
    let rate = 0.5;
    let strength = 0.02;
    let frequency = 15.0;

    // 2. Create a "background factor". 
    // This will be 0.0 for the absolute foreground (depth < 0.1)
    // and smoothly increase to 1.0 for the background.
    let background_factor = smoothstep(0.1, 0.5, depth);
    
    // --- MODIFIED: End of changes ---

    let time = u.time * rate;

    // 3. Calculate the displacement.
    var d1 = sin(uv.x * frequency + time) * strength;
    var d2 = cos(uv.y * frequency * 0.7 + time) * strength;
    
    // 4. Apply the background_factor to the final displacement.
    // This means the foreground will have zero ambient motion,
    // and the background will have full motion.
    var displacedUV = uv + (vec2<f32>(d1, d2) * background_factor);
    
    var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
    textureStore(writeTexture, global_id.xy, color);
}
