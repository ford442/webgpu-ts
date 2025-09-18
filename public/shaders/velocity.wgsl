@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readVelocity: texture_2d<f32>;
@group(0) @binding(2) var writeVelocity: texture_storage_2d<rgba16float, write>;

struct Uniforms {
    mouse: vec4<f32>,
    delta: vec4<f32>, 
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(textureDimensions(readVelocity));
    let uv = vec2<f32>(global_id.xy) / resolution;

    var velocity = textureSampleLevel(readVelocity, u_sampler, uv, 0.0).xy;

    // --- CHANGE IS HERE ---
    // Increased friction for a thicker, more viscous feel.
    velocity *= 0.65;

    let is_dragging = u.mouse.z;
    let mouse_pos = u.mouse.xy;
    let mouse_delta = u.delta.xy;

    let dist_to_mouse = distance(uv, mouse_pos);
    if (is_dragging > 0.5 && dist_to_mouse < 0.05) {
        let force_multiplier = 1.0 - smoothstep(0.0, 0.05, dist_to_mouse);
        velocity += mouse_delta * 5.0 * force_multiplier;
    }
    
    textureStore(writeVelocity, global_id.xy, vec4<f32>(velocity, 0.0, 1.0));
}
