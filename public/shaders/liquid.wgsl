@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    config: vec4<f32>,      // time, rippleCount, resolutionX, resolutionY
    ripples: array<vec4<f32>, 50>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

fn ease_out_back(x: f32) -> f32 {
    let c1 = 1.70158;
    let c3 = c1 + 1.0;
    return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0);
}

fn get_displacement(uv: vec2<f32>) -> vec2<f32> {
    var total_offset = vec2<f32>(0.0, 0.0);
    let currentTime = u.config.x;

    total_offset += vec2<f32>(
        sin(uv.x * 15.0 + currentTime * 0.5) * 0.01,
        cos(uv.y * 15.0 * 0.7 + currentTime * 0.5) * 0.01
    );

    let rippleCount = u32(u.config.y);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let ripple = u.ripples[i];
        let duration = 4.0;
        let timeSinceClick = currentTime - ripple.z;

        if (timeSinceClick > 0.0 && timeSinceClick < duration) {
            let direction_vec = uv - ripple.xy;
            let dist = length(direction_vec);
            if (dist > 0.0001) {
                let wave = sin(dist * 25.0 - timeSinceClick * 2.0);
                let falloff = 1.0 / (dist * 100.0 + 1.0);
                let ease_progress = smoothstep(0.75, 1.0, timeSinceClick / duration);
                let attenuation = 1.0 - ease_out_back(ease_progress);
                let displacement = wave * 0.015 * attenuation * falloff;
                total_offset += (direction_vec / dist) * displacement;
            }
        }
    }
    return total_offset;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let uv = vec2<f32>(global_id.xy) / resolution;

    let displacement_offset = get_displacement(uv);
    let displacedUV = uv + displacement_offset;

    let aberration_strength = length(displacement_offset) * 2.0;
    let uv_r = displacedUV + displacement_offset * aberration_strength * 0.5;
    let uv_g = displacedUV;
    let uv_b = displacedUV - displacement_offset * aberration_strength * 0.5;

    let color_r = textureSampleLevel(readTexture, u_sampler, saturate(uv_r), 0.0).r;
    let color_g = textureSampleLevel(readTexture, u_sampler, saturate(uv_g), 0.0).g;
    let color_b = textureSampleLevel(readTexture, u_sampler, saturate(uv_b), 0.0).b;
    let finalColor = vec4<f32>(color_r, color_g, color_b, 1.0);
    textureStore(writeTexture, global_id.xy, finalColor);
}
