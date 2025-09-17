@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    config: vec4<f32>,      // time, rippleCount, resolutionX, resolutionY
    ripples: array<vec4<f32>, 50>, // x, y, startTime, unused
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    
    var totalDisplacement = vec2<f32>(0.0, 0.0);
    let currentTime = u.config.x;
    
    // 1. Ambient "liquid" effect
    let time = currentTime * 0.5;
    let ambient_strength = 0.02;
    let ambient_freq = 15.0;
    let d1 = sin(uv.x * ambient_freq + time) * ambient_strength;
    let d2 = cos(uv.y * ambient_freq * 0.7 + time) * ambient_strength;
    totalDisplacement += vec2<f32>(d1, d2);

    // 2. Mouse-driven ripple logic (simplified to ONE ripple)
    let rippleCount = u32(u.config.y);
    if (rippleCount > 0u) {
        let rippleData = u.ripples[0]; // Only process the first ripple
        let rippleCenter = rippleData.xy;
        let rippleStartTime = rippleData.z;
        let timeSinceClick = currentTime - rippleStartTime;
        
        if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
            let direction_vec = uv - rippleCenter;
            let dist = length(direction_vec);

            if (dist > 0.0001) {
                let ripple_speed = 2.0;
                let ripple_frequency = 25.0;
                let ripple_amplitude = 0.015;

                let wave = sin(dist * ripple_frequency - timeSinceClick * ripple_speed);
                let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / 3.0);
                let falloff = 1.0 / (dist * 20.0 + 1.0);
                let displacement = wave * ripple_amplitude * attenuation * falloff;
                
                let direction = direction_vec / dist;
                totalDisplacement += direction * displacement;
            }
        }
    }

    let displacedUV = uv + totalDisplacement;
    let color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
    
    textureStore(writeTexture, global_id.xy, color);
}
