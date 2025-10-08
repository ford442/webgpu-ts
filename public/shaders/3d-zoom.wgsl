@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var non_filtering_sampler: sampler;
@group(0) @binding(5) var staticDepthTexture: texture_2d<f32>;

struct Uniforms {
  config: vec4<f32>,
  zoom_config: vec4<f32>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// --- Helper function to calculate a zooming foreground COLOR layer ---
fn create_zooming_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let background_depth_threshold = u.zoom_config.w;
    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
    let fg_scale = 1.5 - (zoom_progress * 1.49);

    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);

    let parallax_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, repeating_uv, 0.0).r;
    let parallax_offset = (repeating_uv - 0.5) * parallax_depth * 0.4;
    let parallax_uv = repeating_uv + parallax_offset;
    let foreground_color = textureSampleLevel(readTexture, u_sampler, fract(parallax_uv), 0.0);

    let fade_in_duration = 0.25;
    var final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);

    let cutout_alpha = smoothstep(background_depth_threshold - 0.02, background_depth_threshold + 0.02, parallax_depth);
    final_alpha = final_alpha * cutout_alpha;

    return vec4(foreground_color.rgb, final_alpha);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let zoom_time = u.zoom_config.x;
    let zoom_center = u.zoom_config.yz;

    let background_color = textureSampleLevel(readTexture, u_sampler, uv, 0.0);

    let foreground1 = create_zooming_layer(uv, zoom_time, zoom_center, 0.0);
    let foreground2 = create_zooming_layer(uv, zoom_time, zoom_center, 0.5);

    let blended_foreground = mix(foreground1, foreground2, foreground2.a);
    let final_color = mix(background_color, blended_foreground, blended_foreground.a);

    textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));
}