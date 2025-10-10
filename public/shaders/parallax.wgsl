@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    rotation: vec2<f32>,
    lightPos: vec2<f32>, // Was mouse position, now used for light
    zoom: f32,
    displacementScale: f32,
    ambientLight: f32,
    smoothness: f32,
    pointSize: f32,
    backlightOn: f32,
    time: f32,
};

@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
    @location(1) worldNormal: vec3<f32>,
    @location(2) worldPos: vec3<f32>,
    @location(3) particleUV: vec2<f32>,
};

const GRID_SIZE = 1536u;

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
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    let point_index = in_vertex_index / 6u;
    let vertex_in_quad = in_vertex_index % 6u;

    let corner_offsets = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, 1.0), // 0: Top-left
        vec2<f32>(1.0, 1.0),  // 1: Top-right
        vec2<f32>(-1.0, -1.0), // 2: Bottom-left
        vec2<f32>(1.0, -1.0)  // 3: Bottom-right
    );

    let triangle_indices = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u);
    let corner_index = triangle_indices[vertex_in_quad];
    let chosen_offset = corner_offsets[corner_index];

    let x = point_index % GRID_SIZE;
    let y = point_index / GRID_SIZE;
    let uv = vec2<f32>(f32(x) / f32(GRID_SIZE - 1u), f32(y) / f32(GRID_SIZE - 1u));
    
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

    let angleX = u.rotation.x;
    let angleY = u.rotation.y;
    let cosX = cos(angleX); let sinX = sin(angleX);
    let cosY = cos(angleY); let sinY = sin(angleY);
    center_pos = vec3<f32>(center_pos.x * cosY - center_pos.z * sinY, center_pos.y, center_pos.x * sinY + center_pos.z * cosY);
    center_pos = vec3<f32>(center_pos.x, center_pos.y * cosX - center_pos.z * sinX, center_pos.y * sinX + center_pos.z * cosX);
    var rotatedNormal = normal;
    rotatedNormal = vec3<f32>(rotatedNormal.x * cosY - rotatedNormal.z * sinY, rotatedNormal.y, rotatedNormal.x * sinY + rotatedNormal.z * cosY);
    rotatedNormal = vec3<f32>(rotatedNormal.x, rotatedNormal.y * cosX - rotatedNormal.z * sinX, rotatedNormal.y * sinX + rotatedNormal.z * cosX);

    let particle_uv = (chosen_offset + 1.0) * 0.5;

    let cam_right = vec3<f32>(cosY, 0.0, -sinY);
    let cam_up_rotated = vec3<f32>(sinY * sinX, cosX, cosY * sinX);
    
    let size = u.pointSize * 0.005;
    var final_pos = center_pos 
        + (cam_right * chosen_offset.x * size) 
        + (cam_up_rotated * chosen_offset.y * size);

    let perspective_factor = 2.5;
    // Apply the perspective projection to X and Y, and then apply user zoom.
    let finalX = (final_pos.x / perspective_factor) * u.zoom;
    let finalY = (final_pos.y / perspective_factor) * u.zoom;

    var output: VertexOutput;
    output.worldPos = center_pos;
    output.worldNormal = normalize(rotatedNormal);
    output.fragUV = uv;
    output.particleUV = particle_uv;
    
    output.position = vec4<f32>(finalX, -finalY, zDisplacement, 1.0);
    return output;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let dist_from_center = distance(in.particleUV, vec2<f32>(0.5));
    if (dist_from_center > 0.5) {
        discard;
    }

    let textureColor = textureSample(sourceImage, u_sampler, in.fragUV).rgb;
    let normal = normalize(in.worldNormal);
    
    var finalColor = vec3<f32>(0.0);

    if (u.backlightOn > 0.5) {
        // --- MODIFICATION START ---
        // --- Backlight Logic with Mouse Direction and Glow ---
        let backlightColor = vec3<f32>(1.0, 0.9, 0.7);
        let backlightIntensity = 2.5;

        // Use mouse position to direct the light from behind
        let light_pos_3d = vec3<f32>((u.lightPos.x * 2.0 - 1.0), (u.lightPos.y * 2.0 - 1.0), 1.0);
        let light_dir = normalize(in.worldPos - light_pos_3d);

        let luminance = dot(textureColor, vec3<f32>(0.299, 0.587, 0.114));
        let diffuse = max(dot(normal, light_dir), 0.0);

        let through_light = backlightColor * pow(luminance, 4.0) * backlightIntensity * diffuse;
        
        // --- Simple Glow Effect ---
        var glow = vec3<f32>(0.0);
        let texelSize = 1.0 / vec2<f32>(textureDimensions(sourceImage));
        let glowRadius = 4.0;
        for (var i = -2; i <= 2; i = i + 1) {
            for (var j = -2; j <= 2; j = j + 1) {
                if (i == 0 && j == 0) { continue; }
                let offset = vec2<f32>(f32(i), f32(j)) * texelSize * glowRadius;
                let neighborColor = textureSample(sourceImage, u_sampler, in.fragUV + offset).rgb;
                let neighborLuminance = dot(neighborColor, vec3<f32>(0.299, 0.587, 0.114));
                if (neighborLuminance > 0.7) { // Only glow from very bright neighbors
                    glow += backlightColor * pow(neighborLuminance, 5.0) * 0.05;
                }
            }
        }
        
        finalColor = through_light + glow;
        // --- MODIFICATION END ---

    } else {
        // --- Original Front Light Logic ---
        let light_pos_3d = vec3<f32>( (u.lightPos.x * 2.0 - 1.0), (u.lightPos.y * 2.0 - 1.0), -0.5);
        let light_dir = normalize(light_pos_3d - in.worldPos);
        let diffuse = max(dot(normal, light_dir), 0.0) * 0.8;
        let lighting = u.ambientLight + diffuse;
        finalColor = textureColor * lighting;
    }
    
    return vec4<f32>(finalColor, 1.0);
}
