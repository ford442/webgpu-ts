@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readVelocity: texture_2d<f32>;
@group(0) @binding(2) var readColor: texture_2d<f32>;
@group(0) @binding(3) var writeColor: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var sourceImage: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(textureDimensions(readColor));
    let uv = vec2<f32>(global_id.xy) / resolution;

    // Read the velocity at this point to know where the fluid is coming from.
    let velocity = textureSampleLevel(readVelocity, u_sampler, uv, 0.0).xy;

    // --- CHANGE IS HERE ---
    // The advected_color is now the final_color.
    // The 'mix' operation that pulled it back to the original image has been removed.
    // The particles will now stay where the currents take them.
    let final_color = textureSampleLevel(readColor, u_sampler, uv - velocity, 0.0);

    textureStore(writeColor, global_id.xy, final_color);
}
