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
    
    let original_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

    // --- Motion Logic ---
    let time = u.time * 0.5;
    let base_ambient_strength = 0.004;
    let ambient_freq = 15.0;
    let motion = vec2<f32>(sin(uv.y * ambient_freq + time * 1.2), cos(uv.x * ambient_freq + time));
    let background_displacement = motion * base_ambient_strength;

    let fg_rate = 0.69;
    let base_fg_strength = 0.008;
    let fg_freq = 20.0;
    let fg_time = u.time * fg_rate;
    let fg_d1 = sin(uv.x * fg_freq + fg_time);
    let fg_d2 = cos(uv.y * fg_freq * 1.3 + fg_time);
    let base_foreground_motion = vec2<f32>(fg_d1, fg_d2);

    let motion_gradient = pow(1.0 - smoothstep(0.0, 0.5, original_depth), 2.5);

    let final_displacement = background_displacement + (base_foreground_motion * base_fg_strength * motion_gradient);

    var displacedUV = uv + final_displacement;
    let dynamic_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV, 0.0).r;
    var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);

    // --- Atmospheric Effects ---
    let shadow_color = vec4<f32>(0.12, 0.12, 0.15, 1.0); 
    // --- CHANGE #1: Shadow now starts much closer to the foreground ---
    let shadow_intensity = smoothstep(0.4, 0.9, dynamic_depth) * 0.85; // Starts at depth 0.4 instead of 0.7
    color = mix(color, shadow_color, shadow_intensity);

    let foreground_fog_color = vec3<f32>(0.6, 0.6, 0.7);
    // --- CHANGE #2: Foreground fog is now a bit stronger and covers more area ---
    let foreground_fog_intensity = smoothstep(0.2, 0.8, 1.0 - dynamic_depth) * 0.18; // Wider range and slightly more intense
    let new_rgb_with_fog = color.rgb + (foreground_fog_color * foreground_fog_intensity);
    color = vec4<f32>(new_rgb_with_fog, color.a);
    
    // --- Spotlight Logic ---
    let light_pos = vec2<f32>(sin(u.time * 0.5) * 0.5 + 0.5, cos(u.time * 0.3) * 0.5 + 0.5);
    let light_radius = 0.45;
    let dist_to_light = distance(uv, light_pos);
    
    let base_spotlight = (1.0 - smoothstep(0.05, light_radius, dist_to_light)) * (1.0 - dynamic_depth);
    
    let texel_size = 1.0 / resolution;
    let depth_right = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(texel_size.x, 0.0), 0.0).r;
    let depth_up = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(0.0, texel_size.y), 0.0).r;
    
    let normal_factor = abs(dynamic_depth - depth_right) + abs(dynamic_depth - depth_up);
    let specular_sheen = smoothstep(0.01, 0.05, normal_factor) * 1.5;

    let spotlight_brightness = base_spotlight + (specular_sheen * base_spotlight);
    
    let light_color = vec3<f32>(0.2, 0.5, 1.0);
    let final_rgb = color.rgb + (light_color * spotlight_brightness);
    color = vec4<f32>(final_rgb, color.a);

    textureStore(writeTexture, global_id.xy, color);
}
