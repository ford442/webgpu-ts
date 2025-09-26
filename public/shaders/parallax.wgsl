@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    rotation: vec2<f32>,
    zoom: f32,
    displacementScale: f32,
    ambientLight: f32,
    smoothness: f32,
    lightPos: vec2<f32>,
    pointSize: f32,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
    @location(1) worldNormal: vec3<f32>,
    @location(2) worldPos: vec3<f32>,
    @location(3) particleUV: vec2<f32>, // UV for the particle quad
};

const GRID_SIZE = 2048u;

fn sample_depth(uv: vec2<f32>) -> f32 {
    // ... (This helper function is unchanged)
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
    // Decode which point and which corner of the quad we're processing
    let point_index = in_vertex_index / 4u;
    let corner_index = in_vertex_index % 4u;

    let x = point_index % GRID_SIZE;
    let y = point_index / GRID_SIZE;
    let uv = vec2<f32>(f32(x) / f32(GRID_SIZE - 1u), f32(y) / f32(GRID_SIZE - 1u));
    
    // --- Calculate base position, normal, etc. just like before ---
    let texelSize = 1.0 / vec2<f32>(f32(GRID_SIZE - 1u));
    let hL = sample_depth(uv - vec2<f32>(texelSize.x, 0.0));
    let hR = sample_depth(uv + vec2<f32>(texelSize.x, 0.0));
    let hD = sample_depth(uv - vec2<f32>(0.0, texelSize.y));
    let hU = sample_depth(uv + vec2<f32>(0.0, texelSize.y));
    let normal = normalize(vec3<f32>((hL - hR) * u.displacementScale, (hD - hU) * u.displacementScale, texelSize.x * 2.0));
    let depthValue = sample_depth(uv);
    let zDisplacement = depthValue * u.displacementScale;
    let projectedX = (uv.x * 2.0 - 1.0);
    let projectedY = (uv.y * 2.0 - 1.0);
    var center_pos = vec3<f32>(projectedX, projectedY, zDisplacement - 0.5);

    // --- Rotate the center point and its normal ---
    let angleX = u.rotation.x;
    let angleY = u.rotation.y;
    let cosX = cos(angleX); let sinX = sin(angleX);
    let cosY = cos(angleY); let sinY = sin(angleY);
    center_pos = vec3<f32>(center_pos.x * cosY - center_pos.z * sinY, center_pos.y, center_pos.x * sinY + center_pos.z * cosY);
    center_pos = vec3<f32>(center_pos.x, center_pos.y * cosX - center_pos.z * sinX, center_pos.y * sinX + center_pos.z * cosX);
    var rotatedNormal = normal;
    rotatedNormal = vec3<f32>(rotatedNormal.x * cosY - rotatedNormal.z * sinY, rotatedNormal.y, rotatedNormal.x * sinY + rotatedNormal.z * cosY);
    rotatedNormal = vec3<f32>(rotatedNormal.x, rotatedNormal.y * cosX - rotatedNormal.z * sinX, rotatedNormal.y * sinX + rotatedNormal.z * cosX);

    // --- Billboard Calculation: Create a camera-facing quad ---
    let corner_offsets = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0)
    );
    let particle_uv = (corner_offsets[corner_index] + 1.0) * 0.5;

    // To make a camera-facing quad, we need camera's right and up vectors.
    // We can derive them by "un-rotating" the world axes.
    let cam_right = vec3<f32>(cosY, 0.0, -sinY);
    let cam_up_rotated = vec3<f32>(sinY * sinX, cosX, cosY * sinX);
    
    let size = u.pointSize * 0.005;
    var final_pos = center_pos 
        + (cam_right * corner_offsets[corner_index].x * size) 
        + (cam_up_rotated * corner_offsets[corner_index].y * size);

    var output: VertexOutput;
    output.worldPos = center_pos; // Use center for lighting
    output.worldNormal = normalize(rotatedNormal);
    output.fragUV = uv; // Original texture UV
    output.particleUV = particle_uv; // UV for the circle
    
    final_pos.z += 2.0;
    final_pos *= u.zoom;
    output.position = vec4<f32>(final_pos.x, -final_pos.y, final_pos.z, 2.0);
    return output;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // --- Make the quad a circle by discarding outer fragments ---
    let dist_from_center = distance(in.particleUV, vec2<f32>(0.5));
    if (dist_from_center > 0.5) {
        discard;
    }

    let textureColor = textureSample(sourceImage, u_sampler, in.fragUV).rgb;
    let light_pos_3d = vec3<f32>( (u.lightPos.x * 2.0 - 1.0), -(u.lightPos.y * 2.0 - 1.0), -0.5);
    let light_dir = normalize(light_pos_3d - in.worldPos);
    let normal = normalize(in.worldNormal);
    let diffuse = max(dot(normal, light_dir), 0.0) * 0.8;
    let lighting = u.ambientLight + diffuse;

    let finalColor = textureColor * lighting;
    return vec4<f32>(finalColor, 1.0);
}
