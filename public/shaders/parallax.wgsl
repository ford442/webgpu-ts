@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    mouse: vec2<f32>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32(in_vertex_index / 2u) * 2.0 - 1.0;
    let y = f32(in_vertex_index % 2u) * -2.0 + 1.0;
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.fragUV = vec2<f32>(output.position.x * 0.5 + 0.5, output.position.y * -0.5 + 0.5);
    return output;
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
    // Get the depth value (0.0 = far, 1.0 = near) for this pixel
    let depth = textureSample(depthMap, u_sampler, fragUV).r;

    // Calculate how far the mouse is from the center of the screen
    let mouse_offset = u.mouse - 0.5;

    // The strength of the 3D effect
    let parallax_strength = 0.05;

    // Shift the texture coordinates based on the mouse position and the depth
    let parallax_uv = fragUV - (mouse_offset * depth * parallax_strength);

    // Sample the final color from the original image at the shifted coordinate
    return textureSample(sourceImage, u_sampler, parallax_uv);
}
