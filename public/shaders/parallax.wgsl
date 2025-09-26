@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    rotation: vec2<f32>,
    zoom: f32,
    displacementScale: f32,
    ambientLight: f32,
    smoothness: f32,
    lightPos: vec2<f32>, // Mouse position for light
};
@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
    @location(1) worldNormal: vec3<f32>, // Pass normal to fragment shader
    @location(2) worldPos: vec3<f32>,   // Pass world position
};

const GRID_SIZE = 256u;

// Helper function for depth sampling
fn sample_depth(uv: vec2<f32>) -> f32 {
    var smoothedDepth = 0.0;
    let texelSize = 1.0 / vec2<f32>(textureDimensions(depthMap));
    let sampleRadius = texelSize * u.smoothness;
    for (var i = -1; i <= 1; i = i + 1) {
        for (var j = -1; j <= 1; j = j + 1) {
            let offset = vec2<f32>(f32(i), f32(j)) * sampleRadius;
            smoothedDepth += textureSampleLevel(depthMap, u_sampler, uv + offset, 0.0).r;
        }
    }
    return smoothedDepth / 9.0;
}

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    let x = in_vertex_index % GRID_SIZE;
    let y = in_vertex_index / GRID_SIZE;
    let uv = vec2<f32>(f32(x) / f32(GRID_SIZE - 1u), f32(y) / f32(GRID_SIZE - 1u));
    let texelSize = 1.0 / vec2<f32>(GRID_SIZE - 1u);

    // === Normal Calculation ===
    let hL = sample_depth(uv - vec2<f32>(texelSize.x, 0.0));
    let hR = sample_depth(uv + vec2<f32>(texelSize.x, 0.0));
    let hD = sample_depth(uv - vec2<f32>(0.0, texelSize.y));
    let hU = sample_depth(uv + vec2<f32>(0.0, texelSize.y));
    
    let normal = normalize(vec3<f32>(
        (hL - hR) * u.displacementScale,
        (hD - hU) * u.displacementScale,
        texelSize.x * 2.0 
    ));
    // =========================

    let depthValue = sample_depth(uv);
    let zDisplacement = depthValue * u.displacementScale;
    let projectedX = (uv.x * 2.0 - 1.0);
    let projectedY = (uv.y * 2.0 - 1.0);

    let angleX = u.rotation.x;
    let angleY = u.rotation.y;
    let cosX = cos(angleX);
    let sinX = sin(angleX);
    let cosY = cos(angleY);
    let sinY = sin(angleY);

    var pos = vec3<f32>(projectedX, projectedY, zDisplacement - 0.5);

    // Rotate Y then X
    pos = vec3<f32>(pos.x * cosY - pos.z * sinY, pos.y, pos.x * sinY + pos.z * cosY);
    pos = vec3<f32>(pos.x, pos.y * cosX - pos.z * sinX, pos.y * sinX + pos.z * cosX);
    
    // Rotate normal as well
    var rotatedNormal = normal;
    rotatedNormal = vec3<f32>(rotatedNormal.x * cosY - rotatedNormal.z * sinY, rotatedNormal.y, rotatedNormal.x * sinY + rotatedNormal.z * cosY);
    rotatedNormal = vec3<f32>(rotatedNormal.x, rotatedNormal.y * cosX - rotatedNormal.z * sinX, rotatedNormal.y * sinX + rotatedNormal.z * cosX);

    var output: VertexOutput;
    output.worldPos = pos;
    output.worldNormal = normalize(rotatedNormal);

    // Apply zoom and perspective
    pos.z += 2.0;
    pos *= u.zoom;
    output.position = vec4<f32>(pos.x, -pos.y, pos.z, 2.0);
    output.fragUV = uv;
    return output;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let textureColor = textureSample(sourceImage, u_sampler, in.fragUV).rgb;
    
    // === Lighting Calculation ===
    let light_pos_3d = vec3<f32>( (u.lightPos.x * 2.0 - 1.0), -(u.lightPos.y * 2.0 - 1.0), -0.5);
    let light_dir = normalize(light_pos_3d - in.worldPos);
    let normal = normalize(in.worldNormal);

    // Diffuse light
    let diffuse_strength = 0.8;
    let diffuse = max(dot(normal, light_dir), 0.0) * diffuse_strength;

    let lighting = u.ambientLight + diffuse;
    // ===========================

    let finalColor = textureColor * lighting;
    return vec4<f32>(finalColor, 1.0);
}
