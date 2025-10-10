// --- START: Procedural Noise Library (from previous shader) ---
// A set of pseudo-random and noise functions for generating organic patterns.
fn random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453123);
}

fn noise(st: vec2<f32>) -> f32 {
  let i = floor(st);
  let f = fract(st);
  let a = random(i);
  let b = random(i + vec2<f32>(1.0, 0.0));
  let c = random(i + vec2<f32>(0.0, 1.0));
  let d = random(i + vec2<f32>(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
}

fn fbm(st: vec2<f32>) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  // Note: st is modified in the loop, so we pass a copy 'stt'
  var stt = st;
  for (var i = 0; i < 4; i = i + 1) {
    value += amplitude * noise(stt);
    stt *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}
// --- END: Procedural Noise Library ---


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
  let time = u.time;
  let pixelSize = 1.0 / resolution;
    
  // --- Tunable Parameters for New Effects ---
  let background_fbm_motion_strength = 0.008;
  let background_distortion_strength = 0.005;
  let light_caustic_strength = 1.5;

  // --- 1. Parallax Motion (Now enhanced with FBM) ---
  let static_depth_for_motion = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
  
  // NEW: Use two scrolling FBM fields for complex, fluid background motion.
  let fbm_motion_uv1 = uv * 3.0 + vec2<f32>(time * 0.1, 0.0);
  let fbm_motion_uv2 = uv * 4.0 - vec2<f32>(0.0, time * 0.07);
  let background_fbm_motion = vec2<f32>(fbm(fbm_motion_uv1), fbm(fbm_motion_uv2)) - 0.5; // Center the motion
  let background_displacement = background_fbm_motion * background_fbm_motion_strength;

  // Foreground motion remains simple for a different feel.
  let fg_rate = 0.79;
  let base_fg_strength = 0.007;
  let fg_freq = 25.0;
  let fg_time = time * fg_rate;
  let fg_d1 = sin(uv.x * fg_freq + fg_time);
  let fg_d2 = cos(uv.y * fg_freq * 1.3 + fg_time);
  let base_foreground_motion = vec2<f32>(fg_d1, fg_d2);

  let motion_gradient = pow(1.0 - smoothstep(0.0, 0.42, static_depth_for_motion), 2.5);
  var final_displacement = background_displacement + (base_foreground_motion * base_fg_strength * motion_gradient);

  // Edge Fade Logic (Unchanged)
  let border_thickness = 0.1;
  let fade_start = 0.5 - border_thickness;
  let fade_end = 0.5;
  let centered_uv = uv - 0.5;
  let edge_factor_x = 1.0 - smoothstep(fade_start, fade_end, abs(centered_uv.x));
  let edge_factor_y = 1.0 - smoothstep(fade_start, fade_end, abs(centered_uv.y));
  let edge_fade = min(edge_factor_x, edge_factor_y);
  final_displacement *= edge_fade;

  var displacedUV = uv + final_displacement;

  // --- 2. NEW: Background Distortion (from "refraction" concept) ---
  let h_center = fbm(uv * 5.0 + time * 0.2);
  let h_right = fbm((uv + vec2(pixelSize.x, 0.0)) * 5.0 + time * 0.2);
  let h_up = fbm((uv + vec2(0.0, pixelSize.y)) * 5.0 + time * 0.2);
  // We only need a one-sided gradient for this effect
  let distortion_gradient = vec2<f32>(h_right - h_center, h_up - h_center);
  
  // Get the depth at the already-displaced UV to mask this new effect
  let temp_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV, 0.0).r;
  // Apply distortion only to the background, making space "warp".
  let distortion_mask = pow(temp_depth, 2.0); 
  displacedUV += distortion_gradient * background_distortion_strength * distortion_mask;

  // --- Final Sampling ---
  let visual_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV, 0.0).r;
  var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);

  // --- Atmospheric Effects (Unchanged) ---
  let shadow_color = vec4<f32>(0.12, 0.12, 0.15, 1.0);  
  let shadow_intensity = smoothstep(0.4, 0.9, visual_depth) * 0.85;
  color = mix(color, shadow_color, shadow_intensity);
  let foreground_fog_color = vec3<f32>(0.6, 0.6, 0.7);
  let foreground_fog_intensity = smoothstep(0.2, 0.8, 1.0 - visual_depth) * 0.18;
  let new_rgb_with_fog = color.rgb + (foreground_fog_color * foreground_fog_intensity);
  color = vec4<f32>(new_rgb_with_fog, color.a);
  let foreground_shadow_color = vec4<f32>(0.1, 0.1, 0.15, 1.0);
  let foreground_shadow_intensity = smoothstep(0.4, 0.0, visual_depth) * 0.7;
  color = mix(color, foreground_shadow_color, foreground_shadow_intensity);
  
  // --- 3. Shared Calculations for All Lights ---
  // Specular sheen (Unchanged)
  let depth_right = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(pixelSize.x, 0.0), 0.0).r;
  let depth_up = textureSampleLevel(readDepthTexture, non_filtering_sampler, displacedUV + vec2<f32>(0.0, pixelSize.y), 0.0).r;
  let normal_factor = abs(visual_depth - depth_right) + abs(visual_depth - depth_up);
  let specular_sheen = smoothstep(0.01, 0.05, normal_factor) * 1.5;

  // NEW: Shimmering caustic noise field for all lights
  let c_uv = uv * 15.0 + time * 1.5;
  let ch_c = fbm(c_uv);
  let ch_r = fbm(c_uv + vec2(0.1, 0.0));
  let ch_l = fbm(c_uv - vec2(0.1, 0.0));
  let ch_u = fbm(c_uv + vec2(0.0, 0.1));
  let ch_d = fbm(c_uv - vec2(0.0, 0.1));
  let laplacian = (ch_r + ch_l + ch_u + ch_d) - 4.0 * ch_c;
  let caustic_boost = clamp(-laplacian * 15.0, 0.0, 1.0);

  // --- Sunray ---
  let sunray_pos = vec2<f32>(0.5 + sin(time * 0.25) * 0.4, 1.3);
  let sunray_color = vec3<f32>(1.0, 0.95, 0.85);
  let ray_stretch_factor = vec2<f32>(1.0, 0.15);
  let dist_to_sunray = distance(uv * ray_stretch_factor, sunray_pos * ray_stretch_factor);
  let base_sunray = (1.0 - smoothstep(0.0, 0.18, dist_to_sunray)) * 1.3 * pow(1.0 - visual_depth, 2.5);
  var sunray_brightness = base_sunray + (specular_sheen * base_sunray * 1.5);
  sunray_brightness *= (1.0 + caustic_boost * light_caustic_strength); // Apply caustics

  // --- Spotlights with dynamic depth ---
  let depth_fade_margin = 0.05;
  // Light 1
  let light1_pos = vec2<f32>(sin(time * 0.5) * 0.5 + 0.5, cos(time * 0.3) * 0.5 + 0.5);
  let light1_depth = (cos(time * 0.45) * 0.5 + 0.5);
  let light1_depth_occlusion = smoothstep(visual_depth + depth_fade_margin, visual_depth - depth_fade_margin, light1_depth);
  let base_spotlight1 = (1.0 - smoothstep(0.05, 0.35, distance(uv, light1_pos))) * light1_depth_occlusion;
  var spotlight1_brightness = base_spotlight1 + (specular_sheen * base_spotlight1);
  spotlight1_brightness *= (1.0 + caustic_boost * light_caustic_strength * 0.5); // Apply caustics
  let light1_color = vec3<f32>(0.2, 0.5, 1.0);
  // Light 2
  let light2_pos = vec2<f32>(cos(time * -0.4) * 0.5 + 0.5, sin(time * 0.6) * 0.5 + 0.5);
  let light2_depth = (sin(time * -0.38) * 0.5 + 0.5);
  let light2_depth_occlusion = smoothstep(visual_depth + depth_fade_margin, visual_depth - depth_fade_margin, light2_depth);
  let base_spotlight2 = (1.0 - smoothstep(0.05, 0.3, distance(uv, light2_pos))) * light2_depth_occlusion;
  var spotlight2_brightness = base_spotlight2 + (specular_sheen * base_spotlight2);
  spotlight2_brightness *= (1.0 + caustic_boost * light_caustic_strength * 0.5); // Apply caustics
  let light2_color = vec3<f32>(1.0, 0.7, 0.2);

  // --- 4. Final Combination ---
  let final_rgb = color.rgb + 
                  (sunray_color * sunray_brightness) + 
                  (light1_color * spotlight1_brightness) + 
                  (light2_color * spotlight2_brightness);
  color = vec4<f32>(final_rgb, color.a);

  textureStore(writeTexture, global_id.xy, color);
}
