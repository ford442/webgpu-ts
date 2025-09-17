@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    config: vec4<f32>,      // time, rippleCount, resolutionX, resolutionY
    ripples: array<vec4<f32>, 50>, // x, y, startTime, unused
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// Function to get the total displacement at a given UV coordinate
fn get_displacement(uv: vec2<f32>) -> vec2<f32> {
    var totalDisplacement = vec2<f32>(0.0, 0.0);
    let currentTime = u.config.x;

    // 1. Ambient wave
    let time = currentTime * 0.5;
    totalDisplacement += vec2<f32>(
        sin(uv.x * 15.0 + time) * 0.02,
        cos(uv.y * 15.0 * 0.7 + time) * 0.02
    );

    // 2. Ripple waves (now with a full loop)
    let rippleCount = u32(u.config.y);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let ripple = u.ripples[i];
        let timeSinceClick = currentTime - ripple.z;
        if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
            let direction_vec = uv - ripple.xy;
            let dist = length(direction_vec);
            if (dist > 0.0001) {
                let wave = sin(dist * 25.0 - timeSinceClick * 2.0);
                let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / 3.0);
                let falloff = 1.0 / (dist * 20.0 + 1.0);
                let displacement = wave * 0.015 * attenuation * falloff;
                totalDisplacement += (direction_vec / dist) * displacement;
            }
        }
    }
    return totalDisplacement;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let pixel = 1.0 / resolution;

    // 1. Calculate final UVs based on displacement
    let totalDisplacement = get_displacement(uv);
    let displacedUV = uv + totalDisplacement;

    // 2. Color Bleeding Effect
    // Sample the center and four surrounding pixels, then average them for a blur effect
    let c1 = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
    let c2 = textureSampleLevel(readTexture, u_sampler, displacedUV + vec2<f32>(pixel.x, 0.0), 0.0);
    let c3 = textureSampleLevel(readTexture, u_sampler, displacedUV - vec2<f32>(pixel.x, 0.0), 0.0);
    let c4 = textureSampleLevel(readTexture, u_sampler, displacedUV + vec2<f32>(0.0, pixel.y), 0.0);
    let c5 = textureSampleLevel(readTexture, u_sampler, displacedUV - vec2<f32>(0.0, pixel.y), 0.0);
    var finalColor = (c1 + c2 + c3 + c4 + c5) / 5.0;

    // 3. 3D Lighting Effect
    // Calculate surface normals by checking displacement of neighboring pixels
    let neighbor_x1 = get_displacement(uv - vec2<f32>(pixel.x, 0.0));
    let neighbor_x2 = get_displacement(uv + vec2<f32>(pixel.x, 0.0));
    let neighbor_y1 = get_displacement(uv - vec2<f32>(0.0, pixel.y));
    let neighbor_y2 = get_displacement(uv + vec2<f32>(0.0, pixel.y));
    
    let ddx = (neighbor_x2.y - neighbor_x1.y) * 10.0;
    let ddy = (neighbor_y2.x - neighbor_y1.x) * 10.0;
    let normal = normalize(vec3<f32>(ddx, ddy, 1.0));

    // Add a specular highlight
    let lightDir = normalize(vec3<f32>(0.5, 0.5, 1.0));
    let specular = pow(max(0.0, dot(normal, lightDir)), 32.0);
    finalColor += specular * 0.6;
    
    textureStore(writeTexture, global_id.xy, finalColor);
}
