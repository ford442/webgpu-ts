@group(0) @binding(0) var u_sampler: sampler;

struct Uniforms {
    params: array<vec4<f32>, 16>,
};

@group(0) @binding(1) var<uniform> u: Uniforms;
@group(0) @binding(2) var primaryTexture: texture_2d<f32>;
@group(0) @binding(3) var utilityTexture1: texture_2d<f32>; // Depth map
@group(0) @binding(5) var outputTexture: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    // --- Read parameters from the uniform buffer ---
    let time = u.params[0].x;
    let resolution = u.params[1].xy; // Assuming resolution is at params[1]
    let rippleCount = u32(u.params[2].z); // Assuming ripple count is at params[2].z
    let uv = vec2<f32>(global_id.xy) / resolution;
    // Use the single sampler for all texture reads
    let center_depth = textureSampleLevel(utilityTexture1, u_sampler, uv, 0.0).r;
    // --- Ambient Displacement (Background Only) ---
    var ambientDisplacement = vec2<f32>(0.0, 0.0);
    let background_factor = 1.0 - smoothstep(0.0, 0.1, center_depth);
    if (background_factor > 0.0) {
        let ambient_time = time * 0.5;
        let base_ambient_strength = 0.004;
        let ambient_freq = 15.0;
        let motion = vec2<f32>(sin(uv.y * ambient_freq + ambient_time * 1.2), cos(uv.x * ambient_freq + ambient_time));
        ambientDisplacement = motion * base_ambient_strength * background_factor;
    }
    // --- Mouse-driven Ripples ---
    var mouseDisplacement = vec2<f32>(0.0, 0.0);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        // Ripple data starts at params[3] in the uniform buffer
        let rippleData = u.params[3u + i]; 
        let rippleCenter = rippleData.xy;
        let rippleStartTime = rippleData.z;
        let timeSinceClick = time - rippleStartTime;
        if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
            let direction_vec = uv - rippleCenter;
            let dist = length(direction_vec);
            if (dist > 0.0001) {
                let rippleOriginDepthFactor = 1.0 - textureSampleLevel(utilityTexture1, u_sampler, rippleCenter, 0.0).r;
                let ripple_speed = mix(1.0, 2.0, rippleOriginDepthFactor);
                let ripple_amplitude = mix(0.005, 0.015, rippleOriginDepthFactor);
                let wave = sin(dist * 25.0 - timeSinceClick * ripple_speed);
                let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / (3.0 * mix(0.5, 1.0, rippleOriginDepthFactor)));
                let falloff = 1.0 / (dist * 20.0 + 1.0);
                mouseDisplacement += (direction_vec / dist) * wave * ripple_amplitude * falloff;
            }
        }
    }
    let totalDisplacement = mouseDisplacement + ambientDisplacement;
    let finalUV = uv + totalDisplacement;
    let finalColor = textureSampleLevel(primaryTexture, u_sampler, finalUV, 0.0);
    textureStore(outputTexture, global_id.xy, finalColor);
}
