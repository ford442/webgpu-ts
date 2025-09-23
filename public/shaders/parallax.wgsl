@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    mouse_lightPos: vec4<f32>, // xy = mouse, zw = lightPos
    params: vec4<f32>, // x: parallax, y: steps, z: occlusion, w: ambientLight
};
@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    // Create a full-screen quad using a triangle strip.
    let x = f32(in_vertex_index % 2u) * 2.0 - 1.0;
    let y = f32(in_vertex_index / 2u) * -2.0 + 1.0;
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    // Correctly map from clip space [-1, 1] to UV space [0, 1] with Y-axis flip.
    output.fragUV = vec2<f32>((x + 1.0) * 0.5, (y - 1.0) * -0.5);
    return output;
}

fn textureSampleClamp(tex: texture_2d<f32>, smp: sampler, uv: vec2<f32>) -> vec4<f32> {
    return textureSample(tex, smp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
    let parallaxStrength = u.params.x;
    let numSteps = u.params.y;
    let occlusionStrength = u.params.z;
    let ambientLight = u.params.w;
    
    // === 1. Parallax Occlusion Mapping (Find Surface Point) ===
    let parallaxDirection = (vec2<f32>(0.5) - u.mouse_lightPos.xy) * parallaxStrength;
    
    let maxSteps = i32(numSteps);
    let stepSize = 1.0 / f32(maxSteps);
    var currentRayDepth = 0.0;
    var currentUV = fragUV;
    var currentDepthMapValue = textureSample(depthMap, u_sampler, currentUV).r * occlusionStrength;

    for (var i: i32 = 0; i < maxSteps; i = i + 1) {
        if (currentRayDepth >= currentDepthMapValue) { break; }
        currentRayDepth += stepSize;
        currentUV -= parallaxDirection * stepSize;
        currentDepthMapValue = textureSample(depthMap, u_sampler, currentUV).r * occlusionStrength;
    }

    let prevUV = currentUV + parallaxDirection * stepSize;
    let prevRayDepth = currentRayDepth - stepSize;
    let prevDepthMapValue = textureSample(depthMap, u_sampler, prevUV).r * occlusionStrength;
    
    let weight = (currentDepthMapValue - currentRayDepth) / ((currentDepthMapValue - currentRayDepth) - (prevDepthMapValue - prevRayDepth) + 0.0001);
    let finalUV = mix(currentUV, prevUV, saturate(weight));
    let surfaceDepth = mix(currentRayDepth, prevRayDepth, saturate(weight));

    // === 2. Self-Shadowing Calculation ===
    let lightPos = u.mouse_lightPos.zw;
    let surfaceToLight = lightPos - finalUV;
    let lightDist = length(surfaceToLight);
    let lightDir = normalize(surfaceToLight);
    
    let shadowStepSize = lightDist / f32(maxSteps / 2);
    var shadowRayDepth = surfaceDepth + 0.01; 
    var shadowUV = finalUV + lightDir * shadowStepSize;
    var shadow = 1.0;

    for (var j: i32 = 0; j < maxSteps / 2; j = j + 1) {
        let shadowDepthMapValue = textureSample(depthMap, u_sampler, shadowUV).r * occlusionStrength;
        if (shadowRayDepth > shadowDepthMapValue) {
            shadow = 0.0;
            break;
        }
        shadowUV += lightDir * shadowStepSize;
        shadowRayDepth += shadowStepSize;
    }
    
    // === 3. Combine Lighting and Final Color ===
    let litColor = textureSampleClamp(sourceImage, u_sampler, finalUV).rgb;
    let lighting = ambientLight + (1.0 - ambientLight) * shadow;
    let finalColor = litColor * lighting;

    return vec4<f32>(finalColor, 1.0);
}
