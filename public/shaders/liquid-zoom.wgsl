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

// --- Helper function to calculate a zooming foreground layer ---
fn create_zooming_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);

    // 1. Calculate the fast, cyclical, zooming UVs for the foreground.
let fg_scale = 1.5 - zoom_progress;
    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);

    // 2. Sample the foreground color with parallax.
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, repeating_uv, 0.0).r;
    let parallax_offset = (repeating_uv - 0.5) * depth * 0.4;
    let parallax_uv = repeating_uv + parallax_offset;
    let foreground_color = textureSampleLevel(readTexture, u_sampler, parallax_uv, 0.0);

    // 3. Calculate depth-based alpha mask to make it "dissolve" in.
    let dissolve_threshold = 1.0 - zoom_progress;
    let alpha = smoothstep(dissolve_threshold - 0.15, dissolve_threshold, depth);

    // 4. Apply a fade-in/fade-out for the start/end of the cycle.
    let fade_duration = 0.2;
    var cycle_fade = 1.0;
    if (zoom_progress < fade_duration) {
      cycle_fade = zoom_progress / fade_duration;
    } else if (zoom_progress > (1.0 - fade_duration)) {
      cycle_fade = (1.0 - zoom_progress) / fade_duration;
    }
    let final_alpha = alpha * smoothstep(0.0, 1.0, cycle_fade);

    return vec4(foreground_color.rgb, final_alpha);
}


@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let currentTime = u.config.x;
    let zoom_time = u.zoom_config.x;
    let zoom_center = u.zoom_config.yz;

    // --- Liquid/ripple logic (calculates 'displaced_uv') ---
    // This part remains unchanged.
    let center_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    var ambientDisplacement = vec2<f32>(0.0, 0.0);
    if (center_depth >= 0.5) {
        let time = currentTime * 0.5;
        let base_ambient_strength = 0.02;
        let ambient_freq = 15.0;
        let motion = vec2<f32>(sin(uv.y * ambient_freq + time * 1.2), cos(uv.x * ambient_freq + time));
        ambientDisplacement = motion * base_ambient_strength;
    }
    var mouseDisplacement = vec2<f32>(0.0, 0.0);
    let rippleCount = u32(u.config.y);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let rippleData = u.ripples[i];
        let timeSinceClick = u.config.x - rippleData.z;
        if (timeSinceClick > 0.0 && timeSinceClick < 3.0) {
            let direction_vec = uv - rippleData.xy;
            let dist = length(direction_vec);
            if (dist > 0.0001) {
                let rippleOriginDepthFactor = 1.0 - textureSampleLevel(readDepthTexture, non_filtering_sampler, rippleData.xy, 0.0).r;
                let ripple_speed = mix(1.0, 2.0, rippleOriginDepthFactor);
                let ripple_amplitude = mix(0.005, 0.015, rippleOriginDepthFactor);
                let wave = sin(dist * 25.0 - timeSinceClick * ripple_speed);
                let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / (3.0 * mix(0.5, 1.0, rippleOriginDepthFactor)));
                let falloff = 1.0 / (dist * 20.0 + 1.0);
                mouseDisplacement += (direction_vec / dist) * wave * ripple_amplitude * attenuation * falloff;
            }
        }
    }
    let totalDisplacement = mouseDisplacement + ambientDisplacement;
    let displaced_uv = uv + totalDisplacement;

    // --- MODIFIED: Continuous Zoom Logic ---

    // 1. Calculate the slow, continuous zoom for the absolute background.
    let bg_scale = pow(0.95, zoom_time);
    let bg_uv = (displaced_uv - zoom_center) * bg_scale + zoom_center;
    let background_color = textureSampleLevel(readTexture, u_sampler, fract(bg_uv), 0.0);

    // 2. Calculate two foreground layers, offset by half a cycle.
    let foreground1 = create_zooming_layer(displaced_uv, zoom_time, zoom_center, 0.0);
    let foreground2 = create_zooming_layer(displaced_uv, zoom_time, zoom_center, 0.5); // Offset by 0.5

    // 3. Blend the layers. Mix the second layer on top of the first, then mix the result on top of the background.
    let blended_foreground = mix(foreground1, foreground2, foreground2.a);
    let final_color = mix(background_color, blended_foreground, blended_foreground.a);

    textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));

    // Update the depth texture for the next frame (using the primary foreground UVs)
    let main_zoom_progress = fract(zoom_time * 0.15);
    let main_fg_scale = 1.0 - (main_zoom_progress * 0.5);
    let main_repeating_uv = fract((displaced_uv - zoom_center) * main_fg_scale + zoom_center);
    let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, main_repeating_uv, 0.0).r;
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
}
