// public/shaders/liquid-v1.wgsl

@group(0) @binding(0) var u_sampler: sampler;

struct Uniforms {
    params: array<vec4<f32>, 16>,
};

@group(0) @binding(1) var<uniform> u: Uniforms;
@group(0) @binding(2) var primaryTexture: texture_2d<f32>;
@group(0) @binding(3) var utilityTexture1: texture_2d<f32>; // Depth map
@group(0) @binding(5) var outputTexture: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let time = u.params[0].x;
    let resolution = u.params[2].xy; // Assuming resolution is stored here
    let uv = vec2<f32>(global_id.xy) / resolution;
    // Simple liquid effect
    let strength = 0.02;
    let frequency = 15.0;
    let d1 = sin(uv.x * frequency + time) * strength;
    let d2 = cos(uv.y * frequency * 0.7 + time) * strength;
    let displacedUV = uv + vec2<f32>(d1, d2);
    let color = textureSampleLevel(primaryTexture, u_sampler, displacedUV, 0.0);
    textureStore(outputTexture, global_id.xy, color);
}
