@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var fillStateTexture: texture_2d<f32>; 

struct Uniforms {
    resolutions: vec4<f32>, // canvas.xy, source.xy
};
@group(0) @binding(3) var<uniform> u: Uniforms;


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
    let canvasRes = u.resolutions.xy;
    let textureRes = u.resolutions.zw;
    let canvasAspect = canvasRes.x / canvasRes.y;
    let textureAspect = textureRes.x / textureRes.y;
    var scale = vec2(1.0, 1.0);
    
    if (canvasAspect > textureAspect) {
        scale.x = textureAspect / canvasAspect;
    } else {
        scale.y = canvasAspect / textureAspect;
    }

    let scaledUV = (fragUV - 0.5) * scale + 0.5;

    // --- FIX IS HERE ---
    // 1. Sample the texture for ALL pixels first (uniform control flow).
    let textureColor = textureSample(u_texture, u_sampler, scaledUV);

    // 2. Determine if the pixel is out of the image's aspect-ratio-corrected bounds.
    let outOfBounds = scaledUV.x < 0.0 || scaledUV.x > 1.0 || scaledUV.y < 0.0 || scaledUV.y > 1.0;

    // 3. Select the color. If out of bounds, use black; otherwise, use the sampled texture color.
    var outputColor = select(textureColor, vec4(0.0, 0.0, 0.0, 1.0), outOfBounds);
    
    let fillState = textureSampleLevel(fillStateTexture, u_sampler, fragUV, 0.0);

    if (fillState.r > 0.5) {
        outputColor = vec4<f32>(1.0 - outputColor.rgb, outputColor.a);
    }

    return outputColor;
}
