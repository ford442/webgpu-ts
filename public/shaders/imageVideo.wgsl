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
    // Create a full-screen quad and pass through UVs
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
        // Canvas is wider than texture (pillarbox)
        scale.x = textureAspect / canvasAspect;
        offset.x = (1.0 - scale.x) / 2.0;
    } else {
        // Canvas is taller than texture (letterbox)
        scale.y = canvasAspect / textureAspect;
        offset.y = (1.0 - scale.y) / 2.0;
    }

    // Apply scale and offset to UV coordinates
    let scaledUV = (fragUV - 0.5) / scale + 0.5;
    let finalUV = (scaledUV - offset) / scale;

    // If UV is outside the 0-1 range, discard the pixel (or color it black)
    if (finalUV.x < 0.0 || finalUV.x > 1.0 || finalUV.y < 0.0 || finalUV.y > 1.0) {
        return vec4(0.0, 0.0, 0.0, 1.0); // Black bars
    }

    return textureSample(u_texture, u_sampler, finalUV);
}
