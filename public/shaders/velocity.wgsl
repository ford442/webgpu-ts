@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readVelocity: texture_2d<f32>;
@group(0) @binding(2) var writeVelocity: texture_storage_2d<rgba16float, write>;

struct Uniforms {
    mouse: vec4<f32>,
    delta: vec4<f32>, 
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// Helper function to get the curl (rotation) at a point
fn curl(uv: vec2<f32>, resolution: vec2<f32>) -> f32 {
    let pixel = 1.0 / resolution;
    let vel_l = textureSampleLevel(readVelocity, u_sampler, uv - vec2<f32>(pixel.x, 0.0), 0.0).y;
    let vel_r = textureSampleLevel(readVelocity, u_sampler, uv + vec2<f32>(pixel.x, 0.0), 0.0).y;
    let vel_t = textureSampleLevel(readVelocity, u_sampler, uv + vec2<f32>(0.0, pixel.y), 0.0).x;
    let vel_b = textureSampleLevel(readVelocity, u_sampler, uv - vec2<f32>(0.0, pixel.y), 0.0).x;
    return (vel_r - vel_l) - (vel_t - vel_b);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(textureDimensions(readVelocity));
    let uv = vec2<f32>(global_id.xy) / resolution;

    // --- 1. Advection Step ---
    // Read the velocity from the previous frame at the current UV.
    let current_velocity = textureSampleLevel(readVelocity, u_sampler, uv, 0.0).xy;
    // Advect the velocity field by looking "upstream".
    var advected_velocity = textureSampleLevel(readVelocity, u_sampler, uv - current_velocity * 0.001, 0.0).xy;

    // Apply friction to the advected velocity
    advected_velocity *= 0.98;

    // --- 2. Vorticity Confinement (for swirls) ---
    let pixel = 1.0 / resolution;
    let curl_center = curl(uv, resolution);
    let curl_l = curl(uv - vec2<f32>(pixel.x, 0.0), resolution);
    let curl_r = curl(uv + vec2<f32>(pixel.x, 0.0), resolution);
    let curl_t = curl(uv + vec2<f32>(0.0, pixel.y), resolution);
    let curl_b = curl(uv - vec2<f32>(0.0, pixel.y), resolution);
    
    var force = vec2<f32>(abs(curl_t) - abs(curl_b), abs(curl_l) - abs(curl_r));
    force = normalize(force + vec2<f32>(0.0001)); // Add a small value to prevent normalization of zero
    force *= curl_center * 0.01; // Scale by curl magnitude
    advected_velocity += force;


    // --- 3. Add Mouse Force ---
    let is_dragging = u.mouse.z;
    let mouse_pos = u.mouse.xy;
    let mouse_delta = u.delta.xy;

    let dist_to_mouse = distance(uv, mouse_pos);
    if (is_dragging > 0.5 && dist_to_mouse < 0.05) {
        let force_multiplier = 1.0 - smoothstep(0.0, 0.05, dist_to_mouse);
        advected_velocity += mouse_delta * 5.0 * force_multiplier;
    }
    
    textureStore(writeVelocity, global_id.xy, vec4<f32>(advected_velocity, 0.0, 1.0));
}
