// Used to generate mipmaps by copying from one mip level to the next
@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
    let x = f32((in_vertex_index & 1u) << 2u) - 1.0;
    let y = f32((in_vertex_index & 2u) << 1u) - 1.0;
    return vec4<f32>(x, y, 0.0, 1.0);
}

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    // We need to adjust the UV coordinates to sample from the correct area of the source texture.
    // The position.xy is in clip space (-1 to 1), so we convert it to UV space (0 to 1).
    return textureSample(u_texture, u_sampler, position.xy * 0.5 + 0.5);
}