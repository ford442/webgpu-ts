@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture1: texture_2d<f32>;
@group(0) @binding(2) var u_texture2: texture_2d<f32>;
@group(0) @binding(3) var u_depthTexture: texture_2d<f32>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    // Generates a full-screen triangle strip
    let x = f32(in_vertex_index / 2u) * 4.0 - 1.0;
    let y = f32(in_vertex_index % 2u) * 4.0 - 1.0;
    output.position = vec4<f32>(x, -y, 0.0, 1.0);
    // Invert Y for texture coordinates
    output.fragUV = vec2<f32>((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
    return output;
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
    let color1 = textureSample(u_texture1, u_sampler, fragUV);
    let color2 = textureSample(u_texture2, u_sampler, fragUV);
    let depthValue = textureSample(u_depthTexture, u_sampler, fragUV).r;

    // A simple threshold for merging.
    // If the depth value is high (object is far), show the second video.
    // Otherwise, show the first video.
    let threshold = 0.5;
    if (depthValue > threshold) {
        return color2;
    } else {
        return color1;
    }
}
