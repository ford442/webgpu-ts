@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,              // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,         // zoomTime, unused, unused, unused
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let currentTime = u.config.x;
    let zoom_time = u.zoom_config.x;

    let zoom_speed = 0.2;
    let zoom = fract(zoom_time * zoom_speed);

    let center_depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

    // Parallax effect for the foreground
    let parallax_uv = uv + (uv - 0.5) * zoom * (1.0 - center_depth) * 0.5;

    // Liquid effect for the background
    let time = currentTime * 0.5;
    let base_ambient_strength = 0.02;
    let ambient_freq = 15.0;
    let motion_background = vec2<f32>(0.0, cos(uv.x * ambient_freq + time));
    var ambientDisplacement = motion_background * base_ambient_strength;
    let displaced_liquid_uv = uv + ambientDisplacement;
    let background_color = textureSampleLevel(readTexture, u_sampler, displaced_liquid_uv, 0.0);

    // Foreground color
    let foreground_color = textureSampleLevel(readTexture, u_sampler, parallax_uv, 0.0);

    // Combine based on depth and zoom
    let threshold = 1.0 - zoom;
    var final_color = mix(background_color, foreground_color, smoothstep(threshold - 0.1, threshold, center_depth));

    textureStore(writeTexture, global_id.xy, final_color);

    let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
}
