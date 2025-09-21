@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var fillStateTexture: texture_2d<f32>; 

struct Uniforms {
    resolutions: vec4<f32>, // canvas.xy, source.xy
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// --- HELPER FUNCTIONS ---

// RGB to HSV (Hue, Saturation, Value)
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
    let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
    let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// HSV to RGB
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
    let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// --- NEW: A simple noise function to create a spray paint texture ---
// Takes a coordinate and returns a pseudo-random value between 0.0 and 1.0
fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
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
        // --- THIS IS THE NEW "SPRAY PAINT" EFFECT ---
        
        // 1. Calculate the vibrant, complementary color like before.
        var hsv = rgb2hsv(outputColor.rgb);
        hsv.x = fract(hsv.x + 0.5); // Shift hue by 180 degrees
        hsv.y = min(hsv.y * 1.2, 1.0); // Boost saturation
        let vibrantColor = hsv2rgb(hsv);
        
        // 2. Generate a noise value based on the screen coordinates.
        // Multiplying by a large number makes the noise finer, like paint speckles.
        let noise = hash(fragUV * 800.0);
        
        // 3. Mix the original color with our new vibrant color based on the noise.
        // This creates the textured, speckled look.
        outputColor.rgb = mix(outputColor.rgb, vibrantColor, noise * 0.85); // noise * 0.85 keeps some original texture
    }

    return outputColor;
}
