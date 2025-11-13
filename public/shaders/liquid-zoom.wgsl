@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,      // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,  // zoomTime, farthestX, farthestY, unused
  zoom_params: vec4<f32>,  // fg_speed, bg_speed, parallax_str, fog_density
  ripples: array<vec4<f32>, 50>, // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;


// <<< CHANGE #1: New helper function for seamless mirrored texture wrapping.
// This avoids the hard edges created by fract().
fn ping_pong(a: f32) -> f32 {
  return 1.0 - abs(fract(a * 0.5) * 2.0 - 1.0);
}

fn ping_pong_v2(v: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(ping_pong(v.x), ping_pong(v.y));
}


fn sample_zooming_layer(
  uv: vec2<f32>,
  depth: f32,
  zoom_time: f32,
  zoom_center: vec2<f32>,
  cycle_offset: f32
) -> vec4<f32> {
  let fg_speed = u.zoom_params.x;
  let bg_speed = u.zoom_params.y;
  let parallax_strength = u.zoom_params.z;

  let parallax_factor = pow(1.0 - depth, parallax_strength);
  let per_pixel_speed = mix(bg_speed, fg_speed, parallax_factor);
  
  // SOFTENED: Make breathing subtler and slower
  // Select preset tuning from uniform (zoom_config.w)
  let presetF = u.zoom_config.w;
  let preset = i32(floor(presetF + 0.5)); // 0=subtle,1=dreamy,2=aggressive

  var base_intensity: f32 = 1.2;
  var breath_amount: f32 = 0.28;
  var breath_speed: f32 = 0.6;
  var chroma_base: f32 = 0.002;
  var fade_duration: f32 = 0.5;

  if (preset == 0) { // subtle
    base_intensity = 1.0;
    breath_amount = 0.18;
    breath_speed = 0.45;
    chroma_base = 0.0008;
    fade_duration = 0.42;
  } else if (preset == 1) { // dreamy
    base_intensity = 1.4;
    breath_amount = 0.36;
    breath_speed = 0.55;
    chroma_base = 0.0018;
    fade_duration = 0.6;
  } else { // aggressive
    base_intensity = 1.9;
    breath_amount = 0.6;
    breath_speed = 0.95;
    chroma_base = 0.0035;
    fade_duration = 0.38;
  }

  let zoom_intensity = base_intensity + sin(zoom_time * breath_speed) * breath_amount;

  // Smooth the raw fract() progress to avoid abrupt edges
  let zoom_progress = fract(zoom_time * per_pixel_speed + cycle_offset);
  let smooth_prog = smoothstep(0.0, 1.0, zoom_progress);
  // scale now eases in/out smoothly
  let scale = 1.0 + (1.0 - smooth_prog) * zoom_intensity;

  let repeating_uv = (uv - zoom_center) * scale + zoom_center;

  // Use ping-pong wrap, then clamp to avoid tiny numerical overflow
  let wrapped_uv = clamp(ping_pong_v2(repeating_uv), vec2<f32>(0.0), vec2<f32>(1.0));

  // Subtle chromatic separation dependent on progression and depth
  let chroma_strength = chroma_base * (0.5 + 0.5 * smooth_prog) * (1.0 + parallax_factor * 0.8);
  let r_uv = clamp(wrapped_uv + vec2<f32>(chroma_strength, 0.0), vec2<f32>(0.0), vec2<f32>(1.0));
  let g_uv = wrapped_uv;
  let b_uv = clamp(wrapped_uv - vec2<f32>(chroma_strength * 0.7, 0.0), vec2<f32>(0.0), vec2<f32>(1.0));

  let rcol = textureSampleLevel(readTexture, non_filtering_sampler, r_uv, 0.0).rgb;
  let gcol = textureSampleLevel(readTexture, non_filtering_sampler, g_uv, 0.0).rgb;
  let bcol = textureSampleLevel(readTexture, non_filtering_sampler, b_uv, 0.0).rgb;
  let color_rgb = vec3<f32>(rcol.r, gcol.g, bcol.b);

  // Fade logic (duration influenced by preset)
  let fade_in = smoothstep(0.0, fade_duration, zoom_progress);
  let fade_out = 1.0 - smoothstep(1.0 - fade_duration, 1.0, zoom_progress);
  let alpha = fade_in * fade_out;

  // Slight tonemapping / contrast boost for punch
  let contrast = 0.15;
  let punched = mix(color_rgb, color_rgb * color_rgb * (3.0 - 2.0 * color_rgb), contrast);

  return vec4<f32>(punched, alpha);
}


@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  let uv = vec2<f32>(global_id.xy) / resolution;
  let zoom_time = u.zoom_config.x;
  let zoom_center = u.zoom_config.yz;

  var displaced_uv = uv; // Ripples are disabled

  let static_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

  // --- Compositing ---
  let layer1 = sample_zooming_layer(displaced_uv, static_depth, zoom_time, zoom_center, 0.0);
  let layer2 = sample_zooming_layer(displaced_uv, static_depth, zoom_time, zoom_center, 0.5);
  var final_color = mix(layer1, layer2, layer2.a);

  // <<< CHANGE #4: Add atmospheric fog to blend distant elements together.
  let fog_density = u.zoom_params.w;
  // A murky green-black is a good starting point for your image.
  let fog_color = vec3<f32>(0.05, 0.1, 0.08); 
  // The fog amount increases with distance (higher depth value).
  let fog_amount = pow(static_depth, 2.0) * fog_density; 
  
  final_color = vec4<f32>(mix(final_color.rgb, fog_color, fog_amount), final_color.a);

  textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));


  // --- Depth Texture Update ---
  // This logic needs to mirror the main color logic PRECISELY to stay in sync.
  let fg_speed = u.zoom_params.x;
  let bg_speed = u.zoom_params.y;
  let parallax_strength = u.zoom_params.z;
  
  let parallax_factor = pow(1.0 - static_depth, parallax_strength);
  let per_pixel_speed = mix(bg_speed, fg_speed, parallax_factor);

  // Use the same breathing intensity calculation
  let base_intensity = 2.0;
  let breath_amount = 0.5;
  let breath_speed = 0.8;
  let zoom_intensity = base_intensity + sin(zoom_time * breath_speed) * breath_amount;

  let main_zoom_progress = fract(zoom_time * per_pixel_speed);
  let main_scale = 1.0 + (1.0 - main_zoom_progress) * zoom_intensity;

  let transformed_uv = (displaced_uv - zoom_center) * main_scale + zoom_center;
  // Use the same wrapping for the depth texture!
  let wrapped_uv = ping_pong_v2(transformed_uv);
  let transformed_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, wrapped_uv, 0.0).r;

  textureStore(writeDepthTexture, global_id.xy, vec4<f32>(transformed_depth, 0.0, 0.0, 0.0));
}
