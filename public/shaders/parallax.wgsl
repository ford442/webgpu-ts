@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    mouse: vec2<f32>,
    displacementScale: f32,
    ambientLight: f32,
    smoothness: f32, // New uniform
};
@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
    @location(1) depth: f32,
};

// Increased grid size for more detail
const GRID_SIZE = 256u;

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    let x = in_vertex_index % GRID_SIZE;
    let y = in_vertex_index / GRID_SIZE;

    let uv = vec2<f32>(f32(x) / f32(GRID_SIZE - 1u), f32(y) / f32(GRID_SIZE - 1u));

    // === Depth Smoothing Logic ===
    var smoothedDepth = 0.0;
    let texelSize = 1.0 / vec2<f32>(textureDimensions(depthMap));
    let sampleRadius = texelSize * u.smoothness;

    // Sample a 3x3 grid and average the results
    for (var i = -1; i <= 1; i = i + 1) {
        for (var j = -1; j <= 1; j = j + 1) {
            let offset = vec2<f32>(f32(i), f32(j)) * sampleRadius;
            smoothedDepth += textureSampleLevel(depthMap, u_sampler, uv + offset, 0.0).r;
        }
    }
    let depthValue = smoothedDepth / 9.0;
    // =============================

    // Displace vertex along Z axis
    let zDisplacement = depthValue * u.displacementScale;

    // Create a basic 3D perspective
    let aspect = 1.0; 
    let fov = 1.5; 
    let near = 0.1;
    let far = 10.0;

    let projectedX = (uv.x * 2.0 - 1.0) * aspect;
    let projectedY = (uv.y * 2.0 - 1.0);

    // Simple rotation based on mouse position
    let angleX = (u.mouse.y - 0.5) * 2.0;
    let angleY = (u.mouse.x - 0.5) * 2.0;
    let cosX = cos(angleX);
    let sinX = sin(angleX);
    let cosY = cos(angleY);
    let sinY = sin(angleY);

    var pos = vec3<f32>(projectedX, projectedY, zDisplacement - 0.5);

    // Rotate Y
    pos = vec3<f32>(
        pos.x * cosY - pos.z * sinY,
        pos.y,
        pos.x * sinY + pos.z * cosY
    );
    // Rotate X
    pos = vec3<f32>(
        pos.x,
        pos.y * cosX - pos.z * sinX,
        pos.y * sinX + pos.z * cosX
    );

    var output: VertexOutput;
    output.position = vec4<f32>(pos.x, pos.y, pos.z, 1.0);
    output.fragUV = uv;
    output.depth = depthValue; 
    return output;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let textureColor = textureSample(sourceImage, u_sampler, in.fragUV).rgb;
    
    // Basic lighting based on depth
    let lighting = in.depth * (1.0 - u.ambientLight) + u.ambientLight;
    
    let finalColor = textureColor * lighting;
    
    return vec4<f32>(finalColor, 1.0);
}
