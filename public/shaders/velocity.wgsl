@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readVelocity: texture_2d<f32>;
@group(0) @binding(2) var writeVelocity: texture_storage_2d<rgba16float, write>;

struct Uniforms {
    mouse_pos: vec2<f32>,   // current mouse position (0.0 to 1.0)
    mouse_delta: vec2<f32>, // how much the mouse moved since last frame
    is_dragging: f32,       // 1.0 if dragging, 0.0 otherwise
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(textureDimensions(readVelocity));
    let uv = vec2<f32>(global_id.xy) / resolution;

    // Read the velocity from the previous frame
    var velocity = textureSampleLevel(readVelocity, u_sampler, uv, 0.0).xy;

    // Apply friction to slow everything down over time
    velocity *= 0.98;

    // If the mouse is dragging, inject new velocity
    let dist_to_mouse = distance(uv, u.mouse_pos);
    if (u.is_dragging > 0.5 && dist_to_mouse < 0.05) {
        // Create a smooth falloff around the mouse cursor
        let force_multiplier = 1.0 - smoothstep(0.0, 0.05, dist_to_mouse);
        // Add the mouse's velocity to the liquid, scaled by distance
        velocity += u.mouse_delta * 5.0 * force_multiplier;
    }
    
    textureStore(writeVelocity, global_id.xy, vec4<f32>(velocity, 0.0, 1.0));
}
