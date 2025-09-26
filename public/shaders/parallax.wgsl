@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    mouse: vec2<f32>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32(in_vertex_index / 2u) * 2.0 - 1.0;
    let y = f32(in_vertex_index % 2u) * -2.0 + 1.0;
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.fragUV = vec2<f32>(output.position.x * 0.5 + 0.5, output.position.y * -0.5 + 0.5);
    return output;
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
    // 1. Sample the AI-generated depth map (normalized in JS)
    let depth_from_model = textureSample(depthMap, u_sampler, fragUV).r;

    // --- START: New Logic ---
    // 2. Sample the original color image at the same position
    let original_color = textureSample(sourceImage, u_sampler, fragUV);

    // 3. Calculate the luminance (brightness) of the pixel.
    // These are standard values for converting RGB to grayscale.
    let luminance = dot(original_color.rgb, vec3<f32>(0.299, 0.587, 0.114));
    
    // 4. Combine the AI depth with the luminance.
    // We add a small fraction of the luminance to the model's depth.
    // The '0.2' is a strength factor you can tweak to change the effect's intensity.
    let luminance_strength = 0.2;
    let combined_depth = depth_from_model + (luminance * luminance_strength);
    // --- END: New Logic ---

    // 5. Calculate the final parallax offset using the new combined depth value
    let mouse_offset = u.mouse - 0.5;
    let parallax_strength = 0.05; // You can still adjust the overall strength here
    let parallax_uv = fragUV - (mouse_offset * combined_depth * parallax_strength);
    
    // Sample the source image using the final, calculated UV coordinates
    return textureSample(sourceImage, u_sampler, parallax_uv);
}
