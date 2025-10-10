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
    let bg_rate = 0.55;
    let bg_strength = 0.007;
    let bg_freq = 15.0;
    let bg_time = u.time * bg_rate;
    let bg_d1 = sin(uv.y * bg_freq + bg_time) * bg_strength;
    let bg_d2 = cos(uv.x * bg_freq * 0.7 + bg_time) * bg_strength;
    let background_displacement = vec2<f32>(bg_d1, bg_d2);

    let fg_rate = 0.77;
    let fg_strength = 0.012;
    let fg_freq = 20.0;
    let fg_time = u.time * fg_rate;
    let fg_d1 = sin(uv.x * fg_freq + fg_time) * fg_strength;
    let fg_d2 = cos(uv.y * fg_freq * 1.3 + fg_time) * fg_strength;
    let foreground_displacement = vec2<f32>(fg_d1, fg_d2);

    // --- Depth Sampling and Displacement ---
    let original_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    let foreground_mix_factor = 1.0 - smoothstep(0.0, 0.25, original_depth);
    let final_displacement = background_displacement + (foreground_displacement * foreground_mix_factor);
    
    var displacedUV = uv + final_displacement;
    let dynamic_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV, 0.0).r;
    var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
    // --- START: New Foreground Fog Logic ---
    // --- START: Corrected Foreground Fog Logic ---
    // 2. Foreground Fog: A light, additive haze around closer objects.
    let foreground_fog_color = vec3<f32>(0.6, 0.6, 0.7);
    let foreground_fog_intensity = smoothstep(0.1, 0.6, 1.0 - dynamic_depth) * 0.2;
    // --- THIS IS THE CORRECTED LOGIC ---
    var new_rgb_with_fog = color.rgb + (foreground_fog_color * foreground_fog_intensity);
    color = vec4<f32>(new_rgb_with_fog, color.a);
    // --- END: Corrected Foreground Fog Logic ---

    // 3. Spotlight: The dynamic light that illuminates the foreground.
    let light_pos = vec2<f32>(sin(u.time * 0.5) * 0.5 + 0.5, cos(u.time * 0.3) * 0.5 + 0.5);
    let light_radius = 0.45;
    let dist_to_light = distance(uv, light_pos);
    
    // By starting the smoothstep at 0.05, we create a soft core instead of a hard point.
    let spotlight_brightness = (1.0 - smoothstep(0.05, light_radius, dist_to_light)) * (1.0 - dynamic_depth);
    
    let light_color = vec3<f32>(0.2, 0.5, 1.0);
    let new_rgb = color.rgb + (light_color * spotlight_brightness);
    color = vec4<f32>(new_rgb, color.a);

    textureStore(writeTexture, global_id.xy, color);
}
