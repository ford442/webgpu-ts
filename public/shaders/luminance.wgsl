// Input image
@group(0) @binding(0) var inputTexture: texture_2d<f32>;

// Output buffer. We use atomics to safely add from all shader threads.
// Array contains: { total_luminance_scaled, total_pixel_count }
@group(0) @binding(1) var<storage, read_write> outputBuffer: array<atomic<u32>>;

// WGSL's dot product is a clean way to calculate luminance
const LUMINANCE_VECTOR = vec3<f32>(0.2126, 0.7152, 0.0722);

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let dims = vec2<f32>(textureDimensions(inputTexture));
    
    // Boundary check to avoid reading outside the texture
    if (global_id.x >= u32(dims.x) || global_id.y >= u32(dims.y)) {
        return;
    }

    let color = textureLoad(inputTexture, global_id.xy, 0).rgb;
    let luminance = dot(color, LUMINANCE_VECTOR);

    // atomics only work with integers. We scale luminance (0.0-1.0) to a large integer
    // to preserve precision when we sum them up.
    let luminance_scaled = u32(luminance * 1000000.0);
    
    // Add this pixel's luminance and count to the total.
    atomicAdd(&outputBuffer[0], luminance_scaled);
    atomicAdd(&outputBuffer[1], 1u);
}
