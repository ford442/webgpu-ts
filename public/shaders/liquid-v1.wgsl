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
    
    // --- Motion Calculation ---
    let bg_rate = 0.75;
    let bg_strength = 0.013;
    let bg_freq = 13.0;
    // --- THIS IS THE CORRECTED LINE ---
    let bg_time = u.time * bg_rate; // Use u.time instead of time
    let bg_d1 = sin(uv.y * bg_freq + bg_time) * bg_strength;
    let bg_d2 = cos(uv.x * bg_freq * 0.7 + bg_time) * bg_strength;
    let background_displacement = vec2<f32>(bg_d1, bg_d2);

    let fg_rate = 0.9;
    let fg_strength = 0.017;
    let fg_freq = 25.0;
    // --- THIS IS THE CORRECTED LINE ---
    let fg_time = u.time * fg_rate; // Use u.time instead of time
    let fg_d1 = sin(uv.x * fg_freq + fg_time) * fg_strength;
    let fg_d2 = cos(uv.y * fg_freq * 1.3 + fg_time) * fg_strength;
    let foreground_displacement = vec2<f32>(fg_d1, fg_d2);

    // --- Depth Sampling and Displacement ---
    let original_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    let foreground_mix_factor = 1.0 - smoothstep(0.0, 0.2, original_depth);
    let final_displacement = background_displacement + (foreground_displacement * foreground_mix_factor);
    
    var displacedUV = uv + final_displacement;
    let dynamic_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV, 0.0).r;
    var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);

    // --- Fog and Spotlight Logic ---
    let fog_color = vec4<f32>(0.1, 0.1, 0.1, 1.0);
    let fog_intensity = smoothstep(0.7, 0.95, dynamic_depth) * 0.5;
    color = mix(color, fog_color, fog_intensity);

    // --- THIS IS THE CORRECTED LINE ---
    let light_pos = vec2<f32>(sin(u.time * 0.5) * 0.5 + 0.5, cos(u.time * 0.3) * 0.5 + 0.5); // Use u.time
    let light_radius = 0.3;
    let dist_to_light = distance(uv, light_pos);
    
    let spotlight_brightness = (1.0 - smoothstep(0.0, light_radius, dist_to_light)) * (1.0 - dynamic_depth);
    
    let light_color = vec3<f32>(0.2, 0.5, 1.0);
    let new_rgb = color.rgb + (light_color * spotlight_brightness);
    color = vec4<f32>(new_rgb, color.a);

    textureStore(writeTexture, global_id.xy, color);
}
