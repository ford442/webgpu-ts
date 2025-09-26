@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    mouse: vec2<f32>,
    displacementScale: f32,
    ambientLight: f32,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
    @location(1) depth: f32,
};

// We create a grid of vertices instead of a simple quad
const GRID_SIZE = 128u;

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    let x = in_vertex_index % GRID_SIZE;
    let y = in_vertex_index / GRID_SIZE;

    let uv = vec2<f32>(f32(x) / f32(GRID_SIZE - 1u), f32(y) / f32(GRID_SIZE - 1u));

    let depthValue = textureSampleLevel(depthMap, u_sampler, uv, 0.0).r;

    // Displace vertex along Z axis
    let zDisplacement = depthValue * u.displacementScale;

    // Create a basic 3D perspective
    let aspect = 1.0; // Assuming square canvas for simplicity, can be passed as uniform
    let fov = 1.5; // Field of view
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
    output.depth = depthValue; // Pass depth to fragment shader for lighting
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
