@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    config: vec4<f32>,      // time, rippleCount, resolutionX, resolutionY
    ripples: array<vec4<f32>, 50>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// A struct to hold the results of our displacement calculation
struct DisplacementResult {
    offset: vec2<f32>,
    ripple_strength: f32,
};

// Calculates displacement and the strength of mouse-driven ripples
fn get_displacement(uv: vec2<f32>) -> DisplacementResult {
    var total_offset = vec2<f32>(0.0, 0.0);
    var total_ripple_strength = 0.0;
    let currentTime = u.config.x;

    // 1. Ambient wave for a constant, gentle liquid motion
    total_offset += vec2<f32>(
        sin(uv.x * 15.0 + currentTime * 0.5) * 0.02,
        cos(uv.y * 15.0 * 0.7 + currentTime * 0.5) * 0.02
    );

    // 2. Mouse-driven ripples (full loop for multiple ripples)
    let rippleCount = u32(u.config.y);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let ripple = u.ripples[i];
        let timeSinceClick = currentTime - ripple.z;
        if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
            let direction_vec = uv - ripple.xy;
            let dist = length(direction_vec);
            if (dist > 0.0001) { // Safety check to prevent division by zero
                let wave = sin(dist * 25.0 - timeSinceClick * 2.0);
                let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / 3.0);
                let falloff = 1.0 / (dist * 20.0 + 1.0);
                let displacement = wave * 0.015 * attenuation * falloff;
                
                total_offset += (direction_vec / dist) * displacement;
                
                // Keep track of the disturbance strength for the ink bleed effect
                total_ripple_strength += clamp(attenuation * falloff * 0.5, 0.0, 1.0);
            }
        }
    }
    return DisplacementResult(total_offset, clamp(total_ripple_strength, 0.0, 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let pixel = 1.0 / resolution;

    // Get the final displacement and strength of the ripples at this pixel
    let displacement = get_displacement(uv);
    let displacedUV = uv + displacement.offset;

    // --- Localized Color Bleeding ---
    // The base color is the sharp, correctly sampled pixel
    let sharp_color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
    
    // The amount of blur depends on how strong the ripple is at this exact spot
    let blur_radius = displacement.ripple_strength * pixel * 2.0; 
    
    // Sample surrounding pixels to create the blur
    let c2 = textureSampleLevel(readTexture, u_sampler, displacedUV + vec2<f32>(blur_radius.x, 0.0), 0.0);
    let c3 = textureSampleLevel(readTexture, u_sampler, displacedUV - vec2<f32>(blur_radius.x, 0.0), 0.0);
    let c4 = textureSampleLevel(readTexture, u_sampler, displacedUV + vec2<f32>(0.0, blur_radius.y), 0.0);
    let c5 = textureSampleLevel(readTexture, u_sampler, displacedUV - vec2<f32>(0.0, blur_radius.y), 0.0);
    let blurred_color = (sharp_color + c2 + c3 + c4 + c5) / 5.0;
    
    // Mix between the sharp and blurred colors based on the ripple strength.
    // No ripple = 100% sharp. Max ripple = 100% blurred.
    var finalColor = mix(sharp_color, blurred_color, displacement.ripple_strength);

    // --- 3D Lighting Effect ---
    // Calculate the surface normal by checking the displacement of neighboring pixels
    let neighbor_x1 = get_displacement(uv - vec2<f32>(pixel.x, 0.0)).offset;
    let neighbor_x2 = get_displacement(uv + vec2<f32>(pixel.x, 0.0)).offset;
    let neighbor_y1 = get_displacement(uv - vec2<f32>(0.0, pixel.y)).offset;
    let neighbor_y2 = get_displacement(uv + vec2<f32>(0.0, pixel.y)).offset;
    
    let ddx = (neighbor_x2.y - neighbor_x1.y) * 10.0;
    let ddy = (neighbor_y2.x - neighbor_y1.x) * 10.0;
    let normal = normalize(vec3<f32>(ddx, ddy, 1.0));
    
    // Add a specular highlight to simulate light reflecting off the surface
    let lightDir = normalize(vec3<f32>(0.5, 0.5, 1.0));
    let specular = pow(max(0.0, dot(normal, lightDir)), 32.0);
    finalColor += specular * 0.6;
    
    textureStore(writeTexture, global_id.xy, finalColor);
}
