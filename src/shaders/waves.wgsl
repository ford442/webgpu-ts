// Waves Shader

struct Uniforms {
    time: f32,
    zoom: f32,
    panX: f32,
    panY: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var videoTexture: texture_2d<f32>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Full-screen triangle
    let x = f32((vertexIndex & 1u) << 2u) - 1.0;
    let y = f32((vertexIndex & 2u) << 1u) - 1.0;
    
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>(x * 0.5 + 0.5, 1.0 - (y * 0.5 + 0.5));
    
    return output;
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // Adjust UV for zoom and pan
    var adjusted_uv = (uv - vec2<f32>(uniforms.panX, uniforms.panY)) / uniforms.zoom + vec2<f32>(0.5, 0.5);
    
    // Create wave patterns
    let wave1 = sin(adjusted_uv.x * 10.0 + uniforms.time) * 0.5 + 0.5;
    let wave2 = sin(adjusted_uv.y * 10.0 + uniforms.time * 0.7) * 0.5 + 0.5;
    let wave3 = sin((adjusted_uv.x + adjusted_uv.y) * 8.0 - uniforms.time * 1.5) * 0.5 + 0.5;
    
    // Combine waves
    let combined = (wave1 + wave2 + wave3) / 3.0;
    
    // Create color gradient based on waves
    let color1 = vec3<f32>(0.0, 0.5, 1.0); // Cyan
    let color2 = vec3<f32>(0.0, 1.0, 0.5); // Green-cyan
    let color3 = vec3<f32>(0.5, 0.0, 1.0); // Purple
    
    var finalColor: vec3<f32>;
    if (combined < 0.5) {
        finalColor = mix(color1, color2, combined * 2.0);
    } else {
        finalColor = mix(color2, color3, (combined - 0.5) * 2.0);
    }
    
    // Add ripple effect
    let center = vec2<f32>(0.5, 0.5);
    let dist = length(adjusted_uv - center);
    let ripple = sin(dist * 20.0 - uniforms.time * 3.0) * 0.5 + 0.5;
    finalColor = finalColor * (0.5 + ripple * 0.5);
    
    // Sample video texture and blend
    let videoColor = textureSample(videoTexture, mySampler, uv);
    finalColor = mix(finalColor, videoColor.rgb, 0.15);
    
    return vec4<f32>(finalColor, 1.0);
}
