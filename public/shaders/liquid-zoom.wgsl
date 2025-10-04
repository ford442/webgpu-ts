@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,              // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,         // zoomTime, farthestX, farthestY, unused
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let currentTime = u.config.x;
    let zoom_time = u.zoom_config.x;
    let zoom_center = u.zoom_config.yz;

    // --- Start of liquid/ripple logic ---
    // 1. Ambient Fluid Motion
    let center_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    var ambientDisplacement = vec2<f32>(0.0, 0.0);

    if (center_depth >= 0.5) {
        let time = currentTime * 0.5;
        let base_ambient_strength = 0.02; 
        let ambient_freq = 15.0;
        let motion = vec2<f32>(sin(uv.y * ambient_freq + time * 1.2), cos(uv.x * ambient_freq + time));
        ambientDisplacement = motion * base_ambient_strength;
    }

    // 2. Mouse-driven Ripples
    var mouseDisplacement = vec2<f32>(0.0, 0.0);
    let rippleCount = u32(u.config.y);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let rippleData = u.ripples[i];
        let rippleCenter = rippleData.xy;
        let rippleStartTime = rippleData.z;
        let timeSinceClick = u.config.x - rippleStartTime;

        if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
            let direction_vec = uv - rippleCenter;
            let dist = length(direction_vec);
            if (dist > 0.0001) {
                let rippleOriginDepthFactor = 1.0 - textureSampleLevel(readDepthTexture, non_filtering_sampler, rippleCenter, 0.0).r;
                let ripple_speed = mix(1.0, 2.0, rippleOriginDepthFactor);
                let ripple_amplitude = mix(0.005, 0.015, rippleOriginDepthFactor);
                let ripple_frequency = 25.0;
                let wave = sin(dist * ripple_frequency - timeSinceClick * ripple_speed);
                let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / (3.0 * mix(0.5, 1.0, rippleOriginDepthFactor)));
                let falloff = 1.0 / (dist * 20.0 + 1.0);
                mouseDisplacement += (direction_vec / dist) * wave * ripple_amplitude * attenuation * falloff;
            }
        }
    }

    // 3. Combine displacements and apply to UV coordinates
    let totalDisplacement = mouseDisplacement + ambientDisplacement;
    let displaced_uv = uv + totalDisplacement;
    // --- End of new liquid/ripple logic ---

    // --- Infinite zoom logic ---
    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed);

    // --- MODIFIED: This line is corrected to produce a zoom-IN effect. ---
    // We now scale from 1.0 down to 0.5. A scale < 1 zooms in.
    let scale = 1.0 - (zoom_progress * 0.5);

    // Use the displaced UVs as the base for the zoom effect
    let repeating_uv = fract((displaced_uv - zoom_center) * scale + zoom_center);

    // Parallax and dissolve effects
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, repeating_uv, 0.0).r;
    let parallax_offset = (repeating_uv - 0.5) * depth * 0.4;
    let parallax_uv = repeating_uv + parallax_offset;

    let dissolve_threshold = 1.0 - zoom_progress;
    let alpha = smoothstep(dissolve_threshold - 0.15, dissolve_threshold, depth);

    let foreground_color = textureSampleLevel(readTexture, u_sampler, parallax_uv, 0.0);
    let background_color = textureSampleLevel(readTexture, u_sampler, repeating_uv, 0.0);

    let final_color = mix(background_color, foreground_color, alpha);

    textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));
    
    // Update the depth texture
    let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, repeating_uv, 0.0).r;
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
}
