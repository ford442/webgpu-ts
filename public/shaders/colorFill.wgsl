@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
// The final state of the flood fill
@group(0) @binding(2) var fillStateTexture: texture_2d<f32>; 

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
    var outputColor = textureSample(u_texture, u_sampler, fragUV);
    
    // Sample the fill state texture (don't use a sampler for this)
    let dims = textureDimensions(fillStateTexture);
    let coords = vec2<i32>(fragUV * vec2<f32>(dims));
    let fillState = textureLoad(fillStateTexture, coords, 0);

    // If the red channel is > 0.5, it means this pixel is filled.
    if (fillState.r > 0.5) {
        outputColor = vec4<f32>(1.0 - outputColor.rgb, outputColor.a);
    }

    return outputColor;
}
