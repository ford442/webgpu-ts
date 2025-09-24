// A more advanced, multi-layered water ripple compute shader.
//
// Features:
// 1. Organic Ambient Motion (FBM-based)
// 2. Interactive Ripples on-click
// 3. Chromatic Aberration (for colored refraction fringes)
// 4. Specular Highlights (for a 'wet' look)
// 5. Simulated Caustics (light patterns on the 'floor')
// 6. Color "dye" injection with each ripple

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
  // config: x=time, y=rippleCount, z=resolutionX, w=resolutionY
  config: vec4<f32>,
  // light: x=lightX, y=lightY, z=unused, w=unused
  light_pos: vec4<f32>,
  // ripples: x, y, startTime, packedColor(intensity in alpha)
  ripples: array<vec4<f32>, 50>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// --- Helper Functions for Noise ---
// Simple pseudo-random number generator
fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

// 2D Noise function based on the hash
fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f); // Smoothstep

    let a = hash(i + vec2<f32>(0.0, 0.0));
    let b = hash(i + vec2<f32>(1.0, 0.0));
    let c = hash(i + vec2<f32>(0.0, 1.0));
    let d = hash(i + vec2<f32>(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractional Brownian Motion (FBM) - creates organic, layered noise
fn fbm(p: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 2.0;
    for (var i = 0; i < 4; i = i + 1) {
        value += amplitude * noise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    return value;
}

// --- Main Compute Shader ---
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = u.config.zw;
    if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) {
        return;
    }
  
    let uv = vec2<f32>(global_id.xy) / resolution;
    let time = u.config.x;

    // --- 1. Calculate the displacement map ---
    var totalDisplacement = vec2<f32>(0.0);
    var specular = 0.0;
    var addedColor = vec3<f32>(0.0);
    var causticStrength = 0.0;

    // A. Organic Ambient "liquid" effect using FBM
    let ambient_uv = uv * 3.0; // Scale UV for more detail
    let d1 = fbm(ambient_uv + time * 0.1) - 0.25; // fbm returns [0,1], recenter to [-0.25, 0.75]
    let d2 = fbm(ambient_uv - time * 0.1 + vec2(5.2, 1.3)) - 0.25;
    totalDisplacement += vec2(d1, d2) * 0.01; // Lower strength for subtle background
    
    // B. Mouse-driven ripple logic
    let rippleCount = u32(u.config.y);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let rippleData = u.ripples[i];
        let rippleCenter = rippleData.xy;
        let rippleStartTime = rippleData.z;
        let rippleColor = rippleData.rgb;
        let rippleIntensity = rippleData.a;
        let timeSinceClick = time - rippleStartTime;
        
        let lifeTime = 4.0;
        if (timeSinceClick > 0.0 && timeSinceClick < lifeTime) {
            let direction_vec = uv - rippleCenter;
            let dist = length(direction_vec);

            if (dist > 0.0001) {
                let ripple_speed = 1.5;
                let ripple_frequency = 30.0;
                let ripple_amplitude = 0.012;

                // Wave function
                let wave_val = dist * ripple_frequency - timeSinceClick * ripple_speed;
                let wave = sin(wave_val);
                
                // Attenuation (fade out over time) and Falloff (fade out with distance)
                let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / lifeTime);
                let falloff = pow(1.0 / (1.0 + dist * 20.0), 2.0);

                // Calculate displacement from this ripple
                let displacement = wave * ripple_amplitude * attenuation * falloff;
                totalDisplacement += normalize(direction_vec) * displacement;
                
                // Add to specular based on wave crests
                // The pow() makes the highlights sharp and glinty
                let crest = smoothstep(0.8, 1.0, wave);
                specular += pow(crest * attenuation * falloff, 32.0) * 0.8;
                
                // Add "dye" to the water
                // It's strongest at the wave front and fades
                let dye_wave = sin(wave_val - 1.57); // Phase shifted to be just behind crest
                let dye_strength = smoothstep(0.5, 1.0, dye_wave) * attenuation * falloff;
                addedColor += rippleColor * dye_strength * rippleIntensity;
                
                // Accumulate strength for caustics effect
                causticStrength += abs(displacement) * 200.0;
            }
        }
    }

    // --- 2. Apply Effects based on the displacement map ---

    // A. Chromatic Aberration
    // Displace R, G, and B channels by slightly different amounts
    let displacedUV_R = uv + totalDisplacement * 1.01;
    let displacedUV_G = uv + totalDisplacement;
    let displacedUV_B = uv + totalDisplacement * 0.99;
    
    var finalColor = vec4(0.0);
    finalColor.r = textureSampleLevel(readTexture, u_sampler, displacedUV_R, 0.0).r;
    finalColor.g = textureSampleLevel(readTexture, u_sampler, displacedUV_G, 0.0).g;
    finalColor.b = textureSampleLevel(readTexture, u_sampler, displacedUV_B, 0.0).b;
    finalColor.a = 1.0;

    // B. Caustics Simulation
    // Distort a noise pattern using the displacement field
    let caustic_uv = uv + totalDisplacement * 0.2; // A different distortion amount
    let caustics = fbm(caustic_uv * 10.0 + time * 0.4) * causticStrength;
    finalColor.rgb += vec3(caustics * 0.5);

    // C. Apply added color "dye" and specular highlights
    finalColor.rgb += addedColor;
    finalColor.rgb += vec3(specular);

    // --- 3. Final Output ---
    textureStore(writeTexture, global_id.xy, finalColor);
}
