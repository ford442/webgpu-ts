@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readVelocity: texture_2d<f32>;
@group(0) @binding(2) var writeVelocity: texture_storage_2d<rgba16float, write>;

struct Uniforms {
    mouse: vec4<f32>,
    delta: vec4<f32>, 
};
@group(0) @binding(3) var<uniform> u: Uniforms;

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

    let current_velocity = textureSampleLevel(readVelocity, u_sampler, uv, 0.0).xy;
    var advected_velocity = textureSampleLevel(readVelocity, u_sampler, uv - current_velocity * 0.002, 0.0).xy;

    // Implement dynamic friction for a 'layered' feel.
    // Low-speed ripples die out quickly, while high-speed swirls persist.
    let speed = length(advected_velocity);
    let friction_factor = smoothstep(0.001, 0.01, speed); // 0 -> 1 as speed increases
    let friction = mix(0.85, 0.98, friction_factor); // mix from high friction (0.85) to low friction (0.98)
    advected_velocity *= friction;

    // --- CHANGE IS HERE ---
    // The swirling force is now only applied if the fluid is already in motion.
    // This prevents it from starting the unwanted drifting effect.
    if (speed > 0.0001) {
        let pixel = 1.0 / resolution;
        let curl_center = curl(uv, resolution);
        let curl_l = curl(uv - vec2<f32>(pixel.x, 0.0), resolution);
        let curl_r = curl(uv + vec2<f32>(pixel.x, 0.0), resolution);
        let curl_t = curl(uv + vec2<f32>(0.0, pixel.y), resolution);
        let curl_b = curl(uv - vec2<f32>(0.0, pixel.y), resolution);
        
        var force = vec2<f32>(abs(curl_t) - abs(curl_b), abs(curl_l) - abs(curl_r));
        force = normalize(force + 0.0001);
        force *= curl_center * 0.0;
        advected_velocity += force;
    }

    let is_dragging = u.mouse.z;
    let mouse_pos = u.mouse.xy;
    let mouse_delta = u.delta.xy;

    let dist_to_mouse = distance(uv, mouse_pos);
    if (is_dragging > 0.5 && dist_to_mouse < 0.05) {
        let force_multiplier = 1.0 - smoothstep(0.0, 0.05, dist_to_mouse);
        advected_velocity += mouse_delta * 1.0 * force_multiplier;
    }
    
    textureStore(writeVelocity, global_id.xy, vec4<f32>(advected_velocity, 0.0, 1.0));
}
