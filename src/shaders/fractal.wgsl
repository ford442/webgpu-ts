// Fractal Shader

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

fn mandelbrot(c: vec2<f32>) -> f32 {
    var z = vec2<f32>(0.0, 0.0);
    var n = 0.0;
    
    for (var i = 0; i < 50; i = i + 1) {
        if (length(z) > 2.0) {
            break;
        }
        // z = z^2 + c
        let temp = z.x * z.x - z.y * z.y + c.x;
        z.y = 2.0 * z.x * z.y + c.y;
        z.x = temp;
        n = n + 1.0;
    }
    
    return n / 50.0;
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // Adjust UV for zoom and pan
    var adjusted_uv = (uv - vec2<f32>(uniforms.panX, uniforms.panY)) / uniforms.zoom;
    
    // Map to complex plane
    let c = vec2<f32>(
        (adjusted_uv.x - 0.5) * 3.5 - 0.5,
        (adjusted_uv.y - 0.5) * 2.0
    );
    
    // Animate the fractal
    let animatedC = c + vec2<f32>(sin(uniforms.time * 0.2) * 0.3, cos(uniforms.time * 0.15) * 0.3);
    
    // Calculate Mandelbrot value
    let m = mandelbrot(animatedC);
    
    // Create colorful gradient based on iteration count
    let hue = m * 6.28318 + uniforms.time * 0.5;
    let saturation = 0.8;
    let value = m;
    
    // HSV to RGB conversion
    let k = vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0);
    let p = abs(fract(vec3<f32>(hue / 6.28318) + k) * 6.0 - vec3<f32>(3.0));
    let rgb = value * mix(vec3<f32>(1.0), clamp(p - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), saturation);
    
    var finalColor = rgb;
    
    // Add glow effect
    if (m < 0.98) {
        finalColor = finalColor * (1.0 + (1.0 - m) * 0.5);
    }
    
    // Sample video texture and blend
    let videoColor = textureSample(videoTexture, mySampler, uv);
    finalColor = mix(finalColor, videoColor.rgb, 0.1);
    
    return vec4<f32>(finalColor, 1.0);
}
