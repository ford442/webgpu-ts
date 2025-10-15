// public/shaders/galaxy.wgsl

@group(0) @binding(0) var u_sampler: sampler;

struct Uniforms {
    params: array<vec4<f32>, 16>,
};

@group(0) @binding(1) var<uniform> u: Uniforms;
@group(0) @binding(2) var primaryTexture: texture_2d<f32>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32(in_vertex_index / 2u) * 4.0 - 1.0;
    let y = f32(in_vertex_index % 2u) * 4.0 - 1.0;
    output.position = vec4<f32>(x, -y, 0.0, 1.0);
    output.fragUV = vec2<f32>((x + 1.0) * 0.5, (y + 1.0) * 0.5);
    return output;
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
    let time = u.params[0].x;
    let color1 = vec3<f32>(sin(fragUV.x * 20.0 + time), cos(fragUV.y * 20.0 + time), 0.5);
    let color2 = vec3<f32>(0.1, 0.2, 0.4);
    let pattern = mix(color1, color2, smoothstep(0.4, 0.6, sin(length(fragUV - 0.5) * 15.0 + time)));
    let textureColor = textureSample(primaryTexture, u_sampler, fragUV);
    let finalColor = mix(pattern, textureColor.rgb, 0.6);
    return vec4<f32>(finalColor, 1.0);
}
