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
    
  // --- Parallax Logic ---
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
  let visual_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV, 0.0).r;
  var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
  // --- END: Parallax Logic ---

  // --- Atmospheric Effects ---
  let shadow_color = vec4<f32>(0.12, 0.12, 0.15, 1.0);  
  let shadow_intensity = smoothstep(0.4, 0.9, visual_depth) * 0.85;
  color = mix(color, shadow_color, shadow_intensity);
  let foreground_fog_color = vec3<f32>(0.6, 0.6, 0.7);
  let foreground_fog_intensity = smoothstep(0.2, 0.8, 1.0 - visual_depth) * 0.18;
  let new_rgb_with_fog = color.rgb + (foreground_fog_color * foreground_fog_intensity);
  color = vec4<f32>(new_rgb_with_fog, color.a);
    

  // --- MODIFICATION START: Add Foreground Shadow and Overhead Sunray ---

  // 1. Add a shadow to the foreground to make it feel unlit by default.
  let foreground_shadow_color = vec4<f32>(0.1, 0.1, 0.15, 1.0); // A cool, dark shadow
  // This smoothly applies shadow to anything with depth from 0.0 to 0.4.
  let foreground_shadow_intensity = smoothstep(0.4, 0.0, visual_depth) * 0.7;
  color = mix(color, foreground_shadow_color, foreground_shadow_intensity);
  
  // 2. Define the new overhead sunray that will "cut through" the shadow.
  let sunray_pos = vec2<f32>(0.5 + sin(u.time * 0.25) * 0.4, 1.3); // Positioned above the screen, swaying gently
  let sunray_color = vec3<f32>(1.0, 0.95, 0.85); // A strong, warm-white sunlight color
  let sunray_strength = 1.3;
  
  // To create a "beam" shape, we stretch the coordinate space vertically before calculating distance.
  let ray_stretch_factor = vec2<f32>(1.0, 0.15);
  let stretched_uv = uv * ray_stretch_factor;
  let stretched_pos = sunray_pos * ray_stretch_factor;
  let dist_to_sunray = distance(stretched_uv, stretched_pos);
  let sunray_radius = 0.18;
  
  // Calculate the base light shape and make it very strong on the foreground.
  let sunray_occlusion = pow(1.0 - visual_depth, 2.5); // pow() makes it stick to foreground more tightly
  let base_sunray = (1.0 - smoothstep(0.0, sunray_radius, dist_to_sunray)) * sunray_strength * sunray_occlusion;


  // --- Shared edge detection for specular highlights ---
  // (This is reused by all three lights)
  let texel_size = 1.0 / resolution;
  let depth_right = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(texel_size.x, 0.0), 0.0).r;
  let depth_up = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(0.0, texel_size.y), 0.0).r;
  let normal_factor = abs(visual_depth - depth_right) + abs(visual_depth - depth_up);
  let specular_sheen = smoothstep(0.01, 0.05, normal_factor) * 1.5;

  // 3. Calculate final sunray brightness including specular highlights.
  let sunray_brightness = base_sunray + (specular_sheen * base_sunray * 1.5); // Extra pop on the sunray highlights

  // --- Existing Spotlights (now with slight adjustments) ---
  let light_depth_occlusion_strength = 0.65;
  let depth_multiplier = mix(1.0, 1.0 - visual_depth, light_depth_occlusion_strength);
  
  // Spotlight 1 (Blue)
  let light1_pos = vec2<f32>(sin(u.time * 0.5) * 0.5 + 0.5, cos(u.time * 0.3) * 0.5 + 0.5);
  let light1_radius = 0.35;
  let dist_to_light1 = distance(uv, light1_pos);
  let base_spotlight1 = (1.0 - smoothstep(0.05, light1_radius, dist_to_light1)) * depth_multiplier;
  let spotlight1_brightness = base_spotlight1 + (specular_sheen * base_spotlight1);
  let light1_color = vec3<f32>(0.2, 0.5, 1.0);

  // Spotlight 2 (Warm)
  let light2_pos = vec2<f32>(cos(u.time * -0.4) * 0.5 + 0.5, sin(u.time * 0.6) * 0.5 + 0.5);
  let light2_radius = 0.3;
  let dist_to_light2 = distance(uv, light2_pos);
  let base_spotlight2 = (1.0 - smoothstep(0.05, light2_radius, dist_to_light2)) * depth_multiplier;
  let spotlight2_brightness = base_spotlight2 + (specular_sheen * base_spotlight2);
  let light2_color = vec3<f32>(1.0, 0.7, 0.2);

  // -- Combine ALL three lights ---
  // Additively blend all light contributions onto the shadowed base color.
  let final_rgb = color.rgb + 
                  (sunray_color * sunray_brightness) + 
                  (light1_color * spotlight1_brightness) + 
                  (light2_color * spotlight2_brightness);

  color = vec4<f32>(final_rgb, color.a);
  // --- MODIFICATION END ---

  textureStore(writeTexture, global_id.xy, color);
}
