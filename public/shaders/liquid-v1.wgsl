@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;

struct Uniforms {
    time: f32,
    resolutionX: f32,
    resolutionY: f32,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(u.resolutionX, u.resolutionY);
    let uv = vec2<f32>(global_id.xy) / resolution;
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    let time = u.time;

    // 1. Define a slower, more subtle background motion.
    let bg_rate = 0.75;
    let bg_strength = 0.013;
    let bg_freq = 13.0;
    let bg_time = time * bg_rate;
    let bg_d1 = sin(uv.y * bg_freq + bg_time) * bg_strength;
    let bg_d2 = cos(uv.x * bg_freq * 0.7 + bg_time) * bg_strength;
    let background_displacement = vec2<f32>(bg_d1, bg_d2);

    // 2. Define the additional "foreground" motion.
    let fg_rate = 0.9;
    let fg_strength = 0.017;
    let fg_freq = 25.0;
    let fg_time = time * fg_rate;
    let fg_d1 = sin(uv.x * fg_freq + fg_time) * fg_strength;
    let fg_d2 = cos(uv.y * fg_freq * 1.3 + fg_time) * fg_strength;
    let foreground_displacement = vec2<f32>(fg_d1, fg_d2);

    // 3. Widen the blend range to have a "looser" selection.
    let foreground_mix_factor = 1.0 - smoothstep(0.0, 0.2, depth);

    // 4. Combine the displacements.
    let final_displacement = background_displacement + (foreground_displacement * foreground_mix_factor);
    
    var displacedUV = uv + final_displacement;
    var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);

    // --- START: New Fog and Spotlight Logic ---

    // 5. Add fog to the background.
    let fog_color = vec4<f32>(0.1, 0.1, 0.1, 1.0); // Dark grey fog
    let fog_intensity = smoothstep(0.1, 0.8, 1.0 - depth); // Apply fog to the background (higher depth values)
    color = mix(color, fog_color, fog_intensity);

    // 6. Add a moving spotlight to the foreground.
    let light_pos = vec2<f32>(sin(time * 0.5) * 0.5 + 0.5, cos(time * 0.3) * 0.5 + 0.5);
    let light_radius = 0.3;
    let dist_to_light = distance(uv, light_pos);
    
    // Calculate spotlight brightness, apply only to foreground.
    let spotlight_brightness = (1.0 - smoothstep(0.0, light_radius, dist_to_light)) * (1.0 - depth);
    
    // Apply the spotlight as an additive effect.
    color.rgb += vec3<f32>(spotlight_brightness * 0.4);

    // --- END: New Fog and Spotlight Logic ---

    textureStore(writeTexture, global_id.xy, color);
}
