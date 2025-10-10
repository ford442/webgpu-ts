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
    
    // Sample original depth first, as it will drive the motion gradient.
    let original_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

    // --- START: New Gradient-Based Motion Logic ---

    // 1. Background Motion (slower, constant).
    let bg_rate = 0.5;
    let bg_strength = 0.01;
    let bg_time = u.time * bg_rate;
    let bg_d1 = sin(uv.y * 10.0 + bg_time) * bg_strength;
    let bg_d2 = cos(uv.x * 10.0 * 0.7 + bg_time) * bg_strength;
    let background_displacement = vec2<f32>(bg_d1, bg_d2);

    // 2. Foreground Motion (faster, more complex).
    let fg_rate = 0.9;
    let base_fg_strength = 0.02; // The maximum possible strength.
    let fg_freq = 25.0;
    let fg_time = u.time * fg_rate;
    let fg_d1 = sin(uv.x * fg_freq + fg_time);
    let fg_d2 = cos(uv.y * fg_freq * 1.3 + fg_time);
    let base_foreground_motion = vec2<f32>(fg_d1, fg_d2);

    // 3. Create the Motion Gradient.
    // This creates a smooth falloff from foreground (1.0) to background (0.0).
    // The pow(..., 2.5) makes the effect strongest on the absolute closest points (depth=0)
    // and fade out quickly, helping to "pin" the edges.
    let motion_gradient = pow(1.0 - smoothstep(0.0, 0.7, original_depth), 2.5);
    
    // 4. Combine Motions.
    // The final displacement is the background motion plus the foreground motion,
    // which has been scaled by our gradient and its max strength.
    let final_displacement = background_displacement + (base_foreground_motion * base_fg_strength * motion_gradient);

    // --- END: New Gradient-Based Motion Logic ---

    var displacedUV = uv + final_displacement;
    let dynamic_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV, 0.0).r;
    var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);

    // --- Atmospheric Effects (Unchanged) ---
    let shadow_color = vec4<f32>(0.12, 0.12, 0.15, 1.0); 
    let shadow_intensity = smoothstep(0.7, 0.95, dynamic_depth) * 0.85;
    color = mix(color, shadow_color, shadow_intensity);

    let foreground_fog_color = vec3<f32>(0.6, 0.6, 0.7);
    let foreground_fog_intensity = smoothstep(0.4, 0.8, 1.0 - dynamic_depth) * 0.15;
    let new_rgb_with_fog = color.rgb + (foreground_fog_color * foreground_fog_intensity);
    color = vec4<f32>(new_rgb_with_fog, color.a);
    
    let light_pos = vec2<f32>(sin(u.time * 0.5) * 0.5 + 0.5, cos(u.time * 0.3) * 0.5 + 0.5);
    let light_radius = 0.45;
    let dist_to_light = distance(uv, light_pos);
    
    let spotlight_brightness = (1.0 - smoothstep(0.05, light_radius, dist_to_light)) * (1.0 - dynamic_depth);
    
    let light_color = vec3<f32>(0.2, 0.5, 1.0);
    let final_rgb = color.rgb + (light_color * spotlight_brightness);
    color = vec4<f32>(final_rgb, color.a);

    textureStore(writeTexture, global_id.xy, color);
}
