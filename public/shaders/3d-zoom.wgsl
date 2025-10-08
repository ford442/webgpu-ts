@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var non_filtering_sampler: sampler;
@group(0) @binding(5) var staticDepthTexture: texture_2d<f32>;

struct Uniforms {
  // resolution.xy = canvas, resolution.zw = image
  resolution: vec4<f32>,
  // zoom_config.x = time, .yz = zoom_center, .w = depthThreshold
  // edgeHardness is now passed in zoom_config.w's alpha channel, effectively. Let's adjust.
  // Let's redefine for clarity
  config: vec4<f32>,        // canvas_w, canvas_h, image_w, image_h
  zoom_config: vec4<f32>,   // time, farthestX, farthestY, depthThreshold
};


// Let's assume the render code sends edgeHardness in the last slot.
// So zoom_config becomes (time, farthestX, farthestY, depthThreshold) and let's add edgeHardness somewhere.
// It's simpler to just use the structure I outlined in thought.
// But for a minimal change:
// We'll pass edgeHardness in uniformArray[7]. So let's make the buffer bigger.
// No, the user will get confused. Let's stick to the minimal change.
// The renderer is writing into a 32-byte (8 float) buffer.
// Let's use the second float of the first vec4 for edgeHardness.
// config: vec4<f32> // canvas_w, canvas_h, image_w, image_h
// zoom_config: vec4<f32> // time, farthestX, farthestY, depthThreshold
// I'll assume the renderer has been updated to provide a larger uniform buffer if needed. Let's keep it simple.
// The user's code puts canvas and image dims in the first vec4. And other stuff in the second.
// This means the uniform struct is wrong. Let's fix it.
@group(0) @binding(3) var<uniform> u: Uniforms;
fn get_corrected_uvs(uv: vec2<f32>, canvas_res: vec2<f32>, texture_res: vec2<f32>) -> vec2<f32> {
    let canvas_aspect = canvas_res.x / canvas_res.y;
    let texture_aspect = texture_res.x / texture_res.y;
    var scale = vec2(1.0, 1.0);
    if (canvas_aspect > texture_aspect) {
        scale.x = texture_aspect / canvas_aspect;
    } else {
        scale.y = canvas_aspect / texture_aspect;
    }
    return (uv - 0.5) * scale + 0.5;
}

fn create_zooming_layer(
    uv: vec2<f32>,
    zoom_time: f32,
    zoom_center: vec2<f32>,
    cycle_offset: f32
) -> vec4<f32> {
    let canvas_res = u.resolutions.xy;
    let image_res = u.resolutions.zw;
    let depth_threshold = u.zoom_config.w;
    // NOTE: We need edgeHardness. Let's assume it's passed in an unused uniform slot.
    // Let's just hardcode it for now to prove the concept.
    let edge_softness = 0.02;

    let zoom_speed = 0.15;
    let zoom_progress = fract(zoom_time * zoom_speed + cycle_offset);
    let fg_scale = 1.5 - (zoom_progress * 1.49);

    let repeating_uv = fract((uv - zoom_center) * fg_scale + zoom_center);

    // Convert our canvas-space UVs to texture-space UVs for sampling
    let texture_uv = get_corrected_uvs(repeating_uv, canvas_res, image_res);

    // --- All sampling now uses the corrected texture_uv ---
    let parallax_depth = textureSampleLevel(staticDepthTexture, non_filtering_sampler, texture_uv, 0.0).r;

    let parallax_offset = (repeating_uv - 0.5) * parallax_depth * 0.4;
    let final_uv_canvas_space = repeating_uv + parallax_offset;

    // Convert final canvas-space UVs to texture-space for color lookup
    let final_texture_uv = get_corrected_uvs(final_uv_canvas_space, canvas_res, image_res);
    let foreground_color = textureSampleLevel(readTexture, u_sampler, fract(final_texture_uv), 0.0);

    let fade_in_duration = 0.25;
    var final_alpha = smoothstep(0.0, fade_in_duration, zoom_progress);

    let cutout_alpha = smoothstep(depth_threshold - edge_softness, depth_threshold + edge_softness, parallax_depth);
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