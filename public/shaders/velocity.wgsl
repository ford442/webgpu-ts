@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readVelocity: texture_2d<f32>;
@group(0) @binding(2) var writeVelocity: texture_storage_2d<rgba16float, write>;

struct Uniforms {
    mouse: vec4<f32>, // mouse.xy = pos, mouse.z = is_dragging
    delta: vec4<f32>, // delta.xy = mouse_delta
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(textureDimensions(readVelocity));
    let uv = vec2<f32>(global_id.xy) / resolution;

    var velocity = textureSampleLevel(readVelocity, u_sampler, uv, 0.0).xy;
    velocity *= 0.98; // Apply friction

    let dist_to_mouse = distance(uv, u.mouse.xy);
    if (u.mouse.z > 0.5 && dist_to_mouse < 0.05) {
        let force = 1.0 - smoothstep(0.0, 0.05, dist_to_mouse);
        velocity += u.delta.xy * 5.0 * force;
    }
    
    textureStore(writeVelocity, global_id.xy, vec4<f32>(velocity, 0.0, 1.0));
}
