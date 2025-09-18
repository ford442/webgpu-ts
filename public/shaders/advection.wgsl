@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readVelocity: texture_2d<f32>;
@group(0) @binding(2) var readColor: texture_2d<f32>;
@group(0) @binding(3) var writeColor: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var sourceImage: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(textureDimensions(readColor));
    let uv = vec2<f32>(global_id.xy) / resolution;

    let velocity = textureSampleLevel(readVelocity, u_sampler, uv, 0.0).xy;
    let advected_color = textureSampleLevel(readColor, u_sampler, uv - velocity, 0.0);
    let original_color = textureSampleLevel(sourceImage, u_sampler, uv, 0.0);

    // --- CHANGE IS HERE ---
    // Create a hard switch between the original image and the advected (liquid) color.
    // If speed is zero, mix_factor = 1.0 (100% original color).
    // If speed is > 0, mix_factor = 0.0 (100% liquid color).
    let speed = length(velocity);
    let mix_factor = 1.0 - smoothstep(0.0, 0.0001, speed);
    let final_color = mix(advected_color, original_color, mix_factor);

    textureStore(writeColor, global_id.xy, final_color);
}
