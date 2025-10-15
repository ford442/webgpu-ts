// A stateful liquid shader designed for a ping-pong buffer system.
// It reads the previous frame's state and writes the new state.

// --- New Universal Binding Declarations ---
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(6) var u_nearest_sampler: sampler; // For depth map

struct Uniforms {
    params: array<vec4<f32>, 64>, // Expanded for ripple data
};
@group(0) @binding(1) var<uniform> u: Uniforms;

// The original, undisturbed image
@group(0) @binding(2) var u_primary_texture: texture_2d<f32>;

// The state from the PREVIOUS frame (READ-ONLY)
@group(0) @binding(3) var u_read_texture: texture_2d<f32>;

// The depth map (READ-ONLY)
@group(0) @binding(4) var u_depth_texture: texture_2d<f32>;

// The state for the CURRENT frame (WRITE-ONLY)
@group(0) @binding(5) var u_write_texture: texture_storage_2d<rgba8unorm, write>;


@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    // --- Read parameters from the uniform buffer ---
    let time = u.params[0].x;
    let resolution = u.params[1].xy;
    let rippleCount = u32(u.params[2].z);
    
    let uv = vec2<f32>(global_id.xy) / resolution;
    let center_depth = textureSampleLevel(u_depth_texture, u_nearest_sampler, uv, 0.0).r;

    // --- Ambient Displacement (Background Only) ---
    var ambientDisplacement = vec2<f32>(0.0, 0.0);
    let background_factor = 1.0 - smoothstep(0.0, 0.1, center_depth);
    if (background_factor > 0.0) {
        let ambient_time = time * 0.5;
        let base_ambient_strength = 0.002; // Reduced for stateful effect
        let ambient_freq = 15.0;
        let motion = vec2<f32>(sin(uv.y * ambient_freq + ambient_time * 1.2), cos(uv.x * ambient_freq + ambient_time));
        ambientDisplacement = motion * base_ambient_strength * background_factor;
    }

    // --- Mouse-driven Ripples ---
    var mouseDisplacement = vec2<f32>(0.0, 0.0);
    // Ripple data starts at params[3] (index 12 in the Float32Array)
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let rippleData = u.params[3u + i]; 
        let rippleCenter = rippleData.xy;
        let rippleStartTime = rippleData.z;
        let timeSinceClick = time - rippleStartTime;

        if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
            let direction_vec = uv - rippleCenter;
            let dist = length(direction_vec);
            if (dist > 0.0001) {
                let rippleOriginDepthFactor = 1.0 - textureSampleLevel(u_depth_texture, u_nearest_sampler, rippleCenter, 0.0).r;
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
    let finalUV = uv - totalDisplacement; // Invert displacement for advection

    // --- Advection Step ---
    // Sample from the PREVIOUS frame's state (u_read_texture) at the displaced coordinate.
    let advectedColor = textureSampleLevel(u_read_texture, u_sampler, finalUV, 0.0);

    // --- Restoring Force ---
    // Gently pull the distorted image back towards the original to prevent it from getting stuck.
    let originalColor = textureSampleLevel(u_primary_texture, u_sampler, uv, 0.0);
    let finalColor = mix(advectedColor, originalColor, 0.008); // Small mix factor

    // Write the new state to the output texture for the NEXT frame to use.
    textureStore(u_write_texture, global_id.xy, finalColor);
}
