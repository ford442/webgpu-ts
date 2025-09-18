@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

// Uniforms are still passed in but are unused in this debug version.
struct Uniforms {
    config: vec4<f32>,
    ripples: array<vec4<f32>, 50>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(textureDimensions(readTexture));
    let uv = vec2<f32>(global_id.xy) / resolution;

    // --- DEBUG PLACEHOLDER ---
    // All complex logic has been removed.
    // We simply read the color from the source texture...
    let passthrough_color = textureSampleLevel(readTexture, u_sampler, uv, 0.0);

    // ...and write it directly to the output texture.
    textureStore(writeTexture, global_id.xy, passthrough_color);
}
