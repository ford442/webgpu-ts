@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    rotation: vec2<f32>,    // x: rotationX, y: rotationY
    zoom: f32,
    displacementScale: f32,
    ambientLight: f32,
    smoothness: f32,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
    @location(1) depth: f32,
};

const GRID_SIZE = 256u;

@vertex
fn vs_main(@builtin(vertex_index) u32) -> VertexOutput {
    let x = in_vertex_index % GRID_SIZE;
    let y = in_vertex_index / GRID_SIZE;

    let uv = vec2<f32>(f32(x) / f32(GRID_SIZE - 1u), f32(y) / f32(GRID_SIZE - 1u));

    var smoothedDepth = 0.0;
    let texelSize = 1.0 / vec2<f32>(textureDimensions(depthMap));
    let sampleRadius = texelSize * u.smoothness;

    for (var i = -1; i <= 1; i = i + 1) {
        for (var j = -1; j <= 1; j = j + 1) {
            let offset = vec2<f32>(f32(i), f32(j)) * sampleRadius;
            smoothedDepth += textureSampleLevel(depthMap, u_sampler, uv + offset, 0.0).r;
        }
    }
    let depthValue = smoothedDepth / 9.0;

    let zDisplacement = depthValue * u.displacementScale;
    
    let projectedX = (uv.x * 2.0 - 1.0);
    let projectedY = (uv.y * 2.0 - 1.0);

    // Use rotation angles from uniforms
    let angleX = u.rotation.x;
    let angleY = u.rotation.y;
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

    // Apply zoom
    pos.z += 2.0; // Push camera back a bit
    pos *= u.zoom;

    var output: VertexOutput;
    output.position = vec4<f32>(pos.x, -pos.y, pos.z, 2.0); // Simple perspective
    output.fragUV = uv;
    output.depth = depthValue; 
    return output;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let textureColor = textureSample(sourceImage, u_sampler, in.fragUV).rgb;
    let lighting = in.depth * (1.0 - u.ambientLight) + u.ambientLight;
    let finalColor = textureColor * lighting;
    return vec4<f32>(finalColor, 1.0);
}
