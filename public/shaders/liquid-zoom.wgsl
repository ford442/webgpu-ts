@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,              // time, rippleCount, resolutionX, resolutionY
  zoom_config: vec4<f32>,         // zoomTime, farthestX, farthestY, unused
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let zoom_time = u.zoom_config.x;
    let zoom_center = u.zoom_config.yz;

    // --- MODIFIED: Start of new infinite zoom logic ---
    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed); // Loops from 0.0 to 1.0
    let scale = 1.0 + zoom_progress; // Scale from 1.0 to 2.0

    // Scale UVs from the zoom center and use fract() to make the texture repeat
    let repeating_uv = fract((uv - zoom_center) * scale + zoom_center);

    // Sample the depth at this new repeating coordinate
    let depth = textureSampleLevel(readDepthTexture, non_filtering_sampler, repeating_uv, 0.0).r;

    // Create a parallax effect: pixels with higher depth are pushed farther from the center
    let parallax_offset = (repeating_uv - 0.5) * depth * 0.4;
    let parallax_uv = repeating_uv + parallax_offset;

    // As the zoom progresses, "dissolve" the foreground objects to reveal the next layer
    let dissolve_threshold = 1.0 - zoom_progress;
    // Calculate an alpha based on depth. If depth > threshold, alpha is 1.0 (visible).
    let alpha = smoothstep(dissolve_threshold - 0.15, dissolve_threshold, depth);

    // The foreground is the parallax-affected color
    let foreground_color = textureSampleLevel(readTexture, u_sampler, parallax_uv, 0.0);
    // The background is the simple repeating texture
    let background_color = textureSampleLevel(readTexture, u_sampler, repeating_uv, 0.0);

    // Blend the foreground over the background using the calculated alpha
    let final_color = mix(background_color, foreground_color, alpha);

    textureStore(writeTexture, global_id.xy, vec4(final_color.rgb, 1.0));
    // --- MODIFIED: End of new infinite zoom logic ---

    // Update the depth texture for the next frame
    let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, repeating_uv, 0.0).r;
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
}
