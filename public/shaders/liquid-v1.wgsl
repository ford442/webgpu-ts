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
    
  // --- START: Parallax Logic ---
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

  // --- Edge Fade Logic ---
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

  // Atmospheric effects
  let shadow_color = vec4<f32>(0.12, 0.12, 0.15, 1.0);  
  let shadow_intensity = smoothstep(0.4, 0.9, visual_depth) * 0.85;
  color = mix(color, shadow_color, shadow_intensity);

  let foreground_fog_color = vec3<f32>(0.6, 0.6, 0.7);
  let foreground_fog_intensity = smoothstep(0.2, 0.8, 1.0 - visual_depth) * 0.18;
  let new_rgb_with_fog = color.rgb + (foreground_fog_color * foreground_fog_intensity);
  color = vec4<f32>(new_rgb_with_fog, color.a);
    
  // --- MODIFICATION START: Smaller lights that fade into the background ---

  // This value controls how much the light is blocked by the foreground.
  // 1.0 = fully blocked (original behavior).
  // 0.0 = not blocked at all (flat 2D light).
  // 0.65 = mostly blocked, but still visible in the background fog/shadows.
  let light_depth_occlusion_strength = 0.65;
  
  // Calculate the depth multiplier ONCE and reuse for both lights.
  // We mix between 1.0 (full brightness) and (1.0 - visual_depth) (depth-based brightness).
  let depth_multiplier = mix(1.0, 1.0 - visual_depth, light_depth_occlusion_strength);


  // --- Spotlight 1 (Original blue light) ---
  let light1_pos = vec2<f32>(sin(u.time * 0.5) * 0.5 + 0.5, cos(u.time * 0.3) * 0.5 + 0.5);
  let light1_radius = 0.35; // MODIFIED: Made smaller (was 0.45)
  let dist_to_light1 = distance(uv, light1_pos);
  // MODIFIED: We now multiply by our new depth_multiplier instead of the harsh (1.0 - visual_depth)
  let base_spotlight1 = (1.0 - smoothstep(0.05, light1_radius, dist_to_light1)) * depth_multiplier;
    
  // --- Shared edge detection for specular highlights ---
  let texel_size = 1.0 / resolution;
  let depth_right = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(texel_size.x, 0.0), 0.0).r;
  let depth_up = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(0.0, texel_size.y), 0.0).r;
  let normal_factor = abs(visual_depth - depth_right) + abs(visual_depth - depth_up);
  let specular_sheen = smoothstep(0.01, 0.05, normal_factor) * 1.5;

  let spotlight1_brightness = base_spotlight1 + (specular_sheen * base_spotlight1);
  let light1_color = vec3<f32>(0.2, 0.5, 1.0); // Blueish color

  // -- Spotlight 2 (New warm light) ---
  let light2_pos = vec2<f32>(cos(u.time * -0.4) * 0.5 + 0.5, sin(u.time * 0.6) * 0.5 + 0.5);
  let light2_radius = 0.3; // MODIFIED: Made smaller (was 0.4)
  let dist_to_light2 = distance(uv, light2_pos);
  // MODIFIED: Reuse the same depth_multiplier for consistent behavior
  let base_spotlight2 = (1.0 - smoothstep(0.05, light2_radius, dist_to_light2)) * depth_multiplier;
    
  let spotlight2_brightness = base_spotlight2 + (specular_sheen * base_spotlight2);
  let light2_color = vec3<f32>(1.0, 0.7, 0.2); // Golden/warm color

  // -- Combine the lights ---
  let final_rgb = color.rgb + (light1_color * spotlight1_brightness) + (light2_color * spotlight2_brightness);
  color = vec4<f32>(final_rgb, color.a);

  // --- MODIFICATION END ---

  textureStore(writeTexture, global_id.xy, color);
}
