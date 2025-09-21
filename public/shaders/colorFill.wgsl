@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var fillStateTexture: texture_2d<f32>; 

struct Uniforms {
    resolutions: vec4<f32>, // canvas.xy, source.xy
};
@group(0) @binding(3) var<uniform> u: Uniforms;


// --- NEW HELPER FUNCTIONS for vibrant colors ---

// Converts a color from RGB to HSV (Hue, Saturation, Value)
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
    let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
    let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Converts a color from HSV to RGB
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
    let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}


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

    let textureColor = textureSample(u_texture, u_sampler, scaledUV);
    let outOfBounds = scaledUV.x < 0.0 || scaledUV.x > 1.0 || scaledUV.y < 0.0 || scaledUV.y > 1.0;
    var outputColor = select(textureColor, vec4(0.0, 0.0, 0.0, 1.0), outOfBounds);
    
    let fillState = textureSampleLevel(fillStateTexture, u_sampler, fragUV, 0.0);

    if (fillState.r > 0.5) {
        // --- THIS IS THE NEW LOGIC ---
        // Convert the original color to HSV
        var hsv = rgb2hsv(outputColor.rgb);
        // Shift the Hue by 180 degrees (0.5 on a scale of 0-1)
        hsv.x = fract(hsv.x + 0.5);
        // Boost the saturation for more vibrancy
        hsv.y = min(hsv.y * 1.2, 1.0);
        // Convert the new vibrant, complementary color back to RGB
        outputColor.rgb = hsv2rgb(hsv);
    }

    return outputColor;
}
