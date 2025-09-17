@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    config: vec4<f32>,      // time, rippleCount, resolutionX, resolutionY
    ripples: array<vec4<f32>, 50>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// This function is now streamlined to only calculate the final offset.
fn get_displacement(uv: vec2<f32>) -> vec2<f32> {
    var total_offset = vec2<f32>(0.0, 0.0);
    let currentTime = u.config.x;

    // 1. Ambient wave for a constant, gentle liquid motion.
    total_offset += vec2<f32>(
        sin(uv.x * 15.0 + currentTime * 0.5) * 0.01,
        cos(uv.y * 15.0 * 0.7 + currentTime * 0.5) * 0.01
    );

    // 2. Mouse-driven ripples. This logic remains the same.
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
                
                total_offset += (direction_vec / dist) * displacement;
            }
        }
    }
    return total_offset;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;

    // --- PERFORMANCE OPTIMIZATION ---
    // We now only do ONE displacement calculation and ONE texture read per pixel.
    
    // 1. Calculate the final offset for the current pixel.
    let displacement_offset = get_displacement(uv);
    let displacedUV = uv + displacement_offset;

    // 2. Read the color from the displaced position.
    let finalColor = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
    
    // 3. Write the final color.
    textureStore(writeTexture, global_id.xy, finalColor);
}
