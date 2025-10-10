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

fn antialias_depth_sample(tex: texture_2d<f32>, samp: sampler, uv: vec2<f32>, texel_size: vec2<f32>) -> f32 {
    let offset = texel_size * 0.5;
    let s0 = textureSampleLevel(tex, samp, uv - offset, 0.0).r;
    let s1 = textureSampleLevel(tex, samp, uv + offset, 0.0).r;
    let s2 = textureSampleLevel(tex, samp, uv + vec2<f32>(offset.x, -offset.y), 0.0).r;
    let s3 = textureSampleLevel(tex, samp, uv + vec2<f32>(-offset.x, offset.y), 0.0).r;
    return (s0 + s1 + s2 + s3) * 0.25;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = vec2<f32>(u.resolutionX, u.resolutionY);
  let uv = vec2<f32>(global_id.xy) / resolution;
    
  // --- Parallax Logic (Unchanged) ---
  let static_depth_for_motion = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
  let time = u.time * 0.5;
  let base_ambient_strength = 0.004;
  let ambient_freq = 15.0;
  let motion = vec2<f32>(sin(uv.y * ambient_freq + time * 1.2), cos(uv.x * ambient_freq + time));
  let background_displacement = motion * base_ambient_strength;
  let fg_rate = 0.79;
  let base_fg_strength = 0.007;
  let fg_freq = 25.0;
  let fg_time = u.time * fg_rate;
  let fg_d1 = sin(uv.x * fg_freq + fg_time);
  let fg_d2 = cos(uv.y * fg_freq * 1.3 + fg_time);
  let base_foreground_motion = vec2<f32>(fg_d1, fg_d2);
  let motion_gradient = pow(1.0 - smoothstep(0.0, 0.42, static_depth_for_motion), 2.5);
  var final_displacement = background_displacement + (base_foreground_motion * base_fg_strength * motion_gradient);
  let border_thickness = 0.1;
  let fade_start = 0.5 - border_thickness;
  let fade_end = 0.5;
  let centered_uv = uv - 0.5;
  let edge_factor_x = 1.0 - smoothstep(fade_start, fade_end, abs(centered_uv.x));
  let edge_factor_y = 1.0 - smoothstep(fade_start, fade_end, abs(centered_uv.y));
  let edge_fade = min(edge_factor_x, edge_factor_y);
  final_displacement *= edge_fade;
  var displacedUV = uv + final_displacement;

  let sharp_visual_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV, 0.0).r;

  let aa_visual_depth = antialias_depth_sample(readDepthTexture, non_filtering_sampler, displacedUV, pixelSize);
  var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);

  // --- Atmospheric Effects (Now using aa_visual_depth) ---
  let shadow_color = vec4<f32>(0.12, 0.12, 0.15, 1.0);  
  let shadow_intensity = smoothstep(0.4, 0.9, aa_visual_depth) * 0.85; // USE AA
  color = mix(color, shadow_color, shadow_intensity);
  let foreground_fog_color = vec3<f32>(0.6, 0.6, 0.7);
  let foreground_fog_intensity = smoothstep(0.2, 0.8, 1.0 - aa_visual_depth) * 0.18; // USE AA
  let new_rgb_with_fog = color.rgb + (foreground_fog_color * foreground_fog_intensity);
  color = vec4<f32>(new_rgb_with_fog, color.a);
  let foreground_shadow_color = vec4<f32>(0.1, 0.1, 0.15, 1.0);
  let foreground_shadow_intensity = smoothstep(0.4, 0.0, aa_visual_depth) * 0.7; // USE AA
  color = mix(color, foreground_shadow_color, foreground_shadow_intensity);

  // --- Sunray Logic (Unchanged) ---
  let sunray_pos = vec2<f32>(0.5 + sin(u.time * 0.25) * 0.4, 1.3);
  let sunray_color = vec3<f32>(1.0, 0.95, 0.85);
  let sunray_strength = 1.3;
  let ray_stretch_factor = vec2<f32>(1.0, 0.15);
  let stretched_uv = uv * ray_stretch_factor;
  let stretched_pos = sunray_pos * ray_stretch_factor;
  let dist_to_sunray = distance(stretched_uv, stretched_pos);
  let sunray_radius = 0.18;
  let sunray_occlusion = pow(1.0 - aa_visual_depth, 2.5); // USE AA
  let base_sunray = (1.0 - smoothstep(0.0, 0.18, dist_to_sunray)) * 1.3 * sunray_occlusion;
  
  // --- Shared edge detection (Unchanged) ---
  let texel_size = 1.0 / resolution;
  let depth_right = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(pixelSize.x, 0.0), 0.0).r;
  let depth_up = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(0.0, pixelSize.y), 0.0).r;
  let normal_factor = abs(sharp_visual_depth - depth_right) + abs(sharp_visual_depth - depth_up); // USE SHARP
  let specular_sheen = smoothstep(0.01, 0.05, normal_factor) * 1.5;

  let sunray_brightness = base_sunray + (specular_sheen * base_sunray * 1.5);
  
  
  // --- MODIFICATION START: Give Spotlights Their Own Depth ---

  // Define a small margin for a soft fade instead of a hard cut-off.
  let depth_fade_margin = 0.05;

  // --- Spotlight 1 (Blue) ---
  let light1_pos = vec2<f32>(sin(u.time * 0.5) * 0.5 + 0.5, cos(u.time * 0.3) * 0.5 + 0.5);
  let light1_radius = 0.35;
  // NEW: Give this light its own animated depth value from 0.0 to 1.0
  let light1_depth = (cos(u.time * 0.45) * 0.5 + 0.5); // Using a different time multiplier for unique motion
  
  // NEW: Calculate occlusion based on comparing the light's depth to the scene's depth.
  // This smoothly fades the light to 0 if it's behind a pixel.
  let light1_depth_occlusion = smoothstep(aa_visual_depth + depth_fade_margin, aa_visual_depth - depth_fade_margin, light1_depth); // USE AA

  let dist_to_light1 = distance(uv, light1_pos);
  // MODIFIED: Use the new depth occlusion logic.
  let base_spotlight1 = (1.0 - smoothstep(0.05, light1_radius, dist_to_light1)) * light1_depth_occlusion;
  let spotlight1_brightness = base_spotlight1 + (specular_sheen * base_spotlight1);
  let light1_color = vec3<f32>(0.2, 0.5, 1.0);

  // --- Spotlight 2 (Warm) ---
  let light2_pos = vec2<f32>(cos(u.time * -0.4) * 0.5 + 0.5, sin(u.time * 0.6) * 0.5 + 0.5);
  let light2_radius = 0.3;
  // NEW: Give this light its own, different animated depth.
  let light2_depth = (sin(u.time * -0.38) * 0.5 + 0.5);
  
  // NEW: Calculate its occlusion the same way.
  let light2_depth_occlusion = smoothstep(aa_visual_depth + depth_fade_margin, aa_visual_depth - depth_fade_margin, light2_depth); // USE AA
  
  let dist_to_light2 = distance(uv, light2_pos);
  // MODIFIED: Use the new depth occlusion logic.
  let base_spotlight2 = (1.0 - smoothstep(0.05, light2_radius, dist_to_light2)) * light2_depth_occlusion;
  let spotlight2_brightness = base_spotlight2 + (specular_sheen * base_spotlight2);
  let light2_color = vec3<f32>(1.0, 0.7, 0.2);

  // -- Combine ALL three lights (Logic Unchanged) ---
  let final_rgb = color.rgb + 
                  (sunray_color * sunray_brightness) + 
                  (light1_color * spotlight1_brightness) + 
                  (light2_color * spotlight2_brightness);
  color = vec4<f32>(final_rgb, color.a);
  // --- MODIFICATION END ---

  textureStore(writeTexture, global_id.xy, color);
}
