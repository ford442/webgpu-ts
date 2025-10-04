// A set of pseudo-random and noise functions for generating organic patterns.
// These are fundamental for realistic natural effects.
fn random(st: vec2<f32>) -> f32 {
    return fract(sin(dot(st.xy, vec2<f32>(12.9898, 78.233))) * 43758.5453123);
}

fn noise(st: vec2<f32>) -> f32 {
    let i = floor(st);
    let f = fract(st);

    let a = random(i);
    let b = random(i + vec2<f32>(1.0, 0.0));
    let c = random(i + vec2<f32>(0.0, 1.0));
    let d = random(i + vec2<f32>(1.0, 1.0));

    let u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
}

// Fractal Brownian Motion (FBM) - layering noise for detailed textures.
// This is what creates the multi-scale, complex ambient motion.
fn fbm(st: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 0.0;
    var stt = st;
    // 4 octaves are a good balance between detail and performance.
    for (var i = 0; i < 4; i = i + 1) {
        value += amplitude * noise(stt);
        stt *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}


@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    // config.x = time
    // config.y = rippleCount
    // config.z = resolutionX
    // config.w = resolutionY
    config: vec4<f32>,
    
    // params.x = refractionStrength (e.g., 0.05)
    // params.y = chromaticAberration (e.g., 0.01)
    // params.z = causticStrength (e.g., 0.3)
    // params.w = ambientStrength (e.g., 0.03)
    params: vec4<f32>,

    // x, y, startTime, strength
    ripples: array<vec4<f32>, 50>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// We need to calculate height at neighboring pixels for refraction and caustics.
// This function encapsulates the entire height calculation logic.
fn calculate_height(uv: vec2<f32>, currentTime: f32) -> f32 {
    var totalHeight = 0.0;
    let time = currentTime * 0.2;
    let ambientStrength = u.params.w;
    
    // 1. New Ambient "liquid" effect using FBM for organic swirls.
    // We use two FBM lookups scrolling in different directions for a chaotic "fluid" look.
    let fbm_uv1 = vec2<f32>(uv.x + time * 0.1, uv.y);
    let fbm_uv2 = vec2<f32>(uv.x, uv.y - time * 0.07);
    let ambient_fbm = fbm(fbm_uv1 * 3.0) + fbm(fbm_uv2 * 4.0);
    totalHeight += ambient_fbm * ambientStrength;

    // 2. Mouse-driven ripple logic
    let rippleCount = u32(u.config.y);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let rippleData = u.ripples[i];
        let rippleCenter = rippleData.xy;
        let rippleStartTime = rippleData.z;
        let rippleStrength = rippleData.w; // Use strength from uniform
        let timeSinceClick = currentTime - rippleStartTime;
        
        let lifeTime = 3.5;
        if (timeSinceClick > 0.0 && timeSinceClick < lifeTime) {
            let dist = length(uv - rippleCenter);
            let ripple_speed = 0.6;
            let ripple_frequency = 40.0;
            let max_dist = lifeTime * ripple_speed * 0.5; // Max travel distance

            if (dist < max_dist) {
                // Sharper wave shape using pow() and abs() for more defined crests.
                let wave_val = dist * ripple_frequency - timeSinceClick * ripple_speed * 20.0;
                let wave = pow(abs(sin(wave_val)), 1.5);
                
                // Attenuation over time
                let time_attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / lifeTime);
                
                // Falloff based on distance from center, creating a "wave packet"
                let dist_falloff = smoothstep(0.0, 0.8, dist / max_dist);
                let dist_falloff_inv = 1.0 - dist_falloff;

                let height_delta = wave * rippleStrength * time_attenuation * dist_falloff_inv;
                totalHeight += height_delta;
            }
        }
    }
    return totalHeight;
}


@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    let pixel = vec2<f32>(global_id.xy);
    let uv = pixel / resolution;
    letcurrentTime = u.config.x;
    
    // --- STEP 1: CALCULATE THE HEIGHT MAP AND ITS DERIVATIVES ---
    let pixelSize = 1.0 / resolution;
    
    // Calculate height at the current pixel and its four direct neighbors.
    // This is the core data for simulating 3D lighting effects.
    let h_center = calculate_height(uv, currentTime);
    let h_right = calculate_height(uv + vec2<f32>(pixelSize.x, 0.0), currentTime);
    let h_left = calculate_height(uv - vec2<f32>(pixelSize.x, 0.0), currentTime);
    let h_up = calculate_height(uv + vec2<f32>(0.0, pixelSize.y), currentTime);
    let h_down = calculate_height(uv - vec2<f32>(0.0, pixelSize.y), currentTime);

    // --- STEP 2: SIMULATE REFRACTION (Bending Light) ---
    // The gradient of the height map gives us the surface normal.
    let gradient = vec2<f32>(h_right - h_left, h_up - h_down);
    let refractionStrength = u.params.x;
    
    // The displacement vector is the gradient of the height field.
    // This simulates light bending as it passes through the "thicker" parts of the liquid.
    let displacement = gradient * refractionStrength;
    let refractedUV = uv + displacement;

    // --- STEP 3: SIMULATE CHROMATIC ABERRATION ---
    // Sample R, G, and B channels at slightly different offsets to mimic light dispersion.
    // This adds a subtle, high-quality prismatic effect.
    let ca_amount = u.params.y;
    let r_uv = uv + displacement * (1.0 - ca_amount);
    let g_uv = uv + displacement; // Green is the baseline
    let b_uv = uv + displacement * (1.0 + ca_amount);

    let final_r = textureSampleLevel(readTexture, u_sampler, r_uv, 0.0).r;
    let final_g = textureSampleLevel(readTexture, u_sampler, g_uv, 0.0).g;
    let final_b = textureSampleLevel(readTexture, u_sampler, b_uv, 0.0).b;

    var final_color = vec4(final_r, final_g, final_b, 1.0);

    // --- STEP 4: FAKE CAUSTICS (Light Focusing) ---
    // The Laplacian of the height field tells us the curvature of the surface.
    // Concave surfaces (troughs of waves) focus light, making them brighter.
    let laplacian = (h_right + h_left + h_up + h_down) - 4.0 * h_center;
    let caustic_boost = clamp(-laplacian * 200.0, 0.0, 1.0) * u.params.z;
    
    final_color.rgb += caustic_boost;
    
    textureStore(writeTexture, global_id.xy, final_color);
}
