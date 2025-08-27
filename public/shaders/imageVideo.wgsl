@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u_resolutions: vec4<f32>; // canvas.xy, source.xy

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
    let canvasRes = u_resolutions.xy;
    let textureRes = u_resolutions.zw;
    let canvasAspect = canvasRes.x / canvasRes.y;
    let textureAspect = textureRes.x / textureRes.y;
    var scale = vec2(1.0, 1.0);
    var offset = vec2(0.0, 0.0);

    if (canvasAspect > textureAspect) {
        scale.x = textureAspect / canvasAspect;
        offset.x = (1.0 - scale.x) / 2.0;
    } else {
        scale.y = canvasAspect / textureAspect;
        offset.y = (1.0 - scale.y) / 2.0;
    }

    let scaledUV = (fragUV - 0.5) / scale + 0.5;
    let finalUV = (scaledUV - offset) / scale;

    // --- FIX IS HERE ---

    // 1. Sample the texture UNCONDITIONALLY
    let textureColor = textureSample(u_texture, u_sampler, finalUV);

    // 2. Determine if the pixel is out of bounds
    // The f32() conversion turns `true` into 1.0 and `false` into 0.0
    let outOfBounds = f32(finalUV.x < 0.0 || finalUV.x > 1.0 || finalUV.y < 0.0 || finalUV.y > 1.0);

    // 3. Conditionally select the color using mix()
    // mix(colorA, colorB, weight)
    // If outOfBounds is 1.0 (true), the weight is 0.0, so we get the black color.
    // If outOfBounds is 0.0 (false), the weight is 1.0, so we get the textureColor.
    let finalColor = mix(vec4(0.0, 0.0, 0.0, 1.0), textureColor, 1.0 - outOfBounds);

    return finalColor;
}
