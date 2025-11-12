// Galaxy Spiral Shader

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
    
    // Convert to polar coordinates
    let center = vec2<f32>(0.5, 0.5);
    let delta = adjusted_uv - center;
    let r = length(delta);
    let angle = atan2(delta.y, delta.x);
    
    // Create spiral effect
    let spiral = angle + r * 10.0 - uniforms.time;
    let arms = 5.0;
    let pattern = sin(spiral * arms) * 0.5 + 0.5;
    
    // Galaxy colors with radial gradient
    let intensity = pattern * (1.0 - r * 1.5);
    let color1 = vec3<f32>(0.1, 0.2, 0.8); // Blue core
    let color2 = vec3<f32>(0.8, 0.3, 0.9); // Purple arms
    let color3 = vec3<f32>(0.0, 0.0, 0.0); // Black space
    
    var finalColor: vec3<f32>;
    if (r < 0.3) {
        finalColor = mix(color1, color2, r / 0.3);
    } else {
        finalColor = mix(color2, color3, (r - 0.3) / 0.4);
    }
    
    finalColor = finalColor * intensity;
    
    // Add stars
    let starPattern = fract(sin(dot(adjusted_uv * 100.0, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    if (starPattern > 0.998) {
        finalColor = finalColor + vec3<f32>(1.0, 1.0, 1.0) * 0.8;
    }
    
    // Sample video texture and blend
    let videoColor = textureSample(videoTexture, mySampler, uv);
    finalColor = mix(finalColor, videoColor.rgb, 0.1);
    
    return vec4<f32>(finalColor, 1.0);
}
