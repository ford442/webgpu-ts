// Alternate liquid shader: stronger ripples + HSL-based complementary palette mapping
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

// Tunables
const KERNEL_RADIUS: i32 = 2; // 2 -> 5x5 neighborhood; set to 1 for 3x3 to reduce cost
const PALETTE_STRENGTH: f32 = 0.6; // how strongly palette color replaces original when coherent
const VAR_THRESHOLD: f32 = 0.006; // luminance variance threshold for coherence
const HUE_DELTA: f32 = 0.055; // ~20 degrees

struct Uniforms {
  config: vec4<f32>;              // time, rippleCount, resolutionX, resolutionY
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

// ---- Color space helpers (RGB <-> HSL) ----
fn rgb_max(a: vec3<f32>) -> f32 { return max(a.x, max(a.y, a.z)); }
fn rgb_min(a: vec3<f32>) -> f32 { return min(a.x, min(a.y, a.z)); }

fn rgb_to_hsl(c: vec3<f32>) -> vec3<f32> {
    let maxc = rgb_max(c);
    let minc = rgb_min(c);
    var h: f32 = 0.0;
    var s: f32 = 0.0;
    let l: f32 = (maxc + minc) * 0.5;
    if (maxc != minc) {
        let d: f32 = maxc - minc;
        s = d / (1.0 - abs(2.0 * l - 1.0));
        if (maxc == c.x) {
            h = (c.y - c.z) / d;
            if (c.y < c.z) { h = h + 6.0; }
        } else if (maxc == c.y) {
            h = (c.z - c.x) / d + 2.0;
        } else {
            h = (c.x - c.y) / d + 4.0;
        }
        h = h / 6.0; // normalize to [0,1)
    }
    return vec3<f32>(h, s, l);
}

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
    var tt = t;
    if (tt < 0.0) { tt = tt + 1.0; }
    if (tt > 1.0) { tt = tt - 1.0; }
    if (tt < 1.0/6.0) { return p + (q - p) * 6.0 * tt; }
    if (tt < 1.0/2.0) { return q; }
    if (tt < 2.0/3.0) { return p + (q - p) * (2.0/3.0 - tt) * 6.0; }
    return p;
}

fn hsl_to_rgb(hsl: vec3<f32>) -> vec3<f32> {
    let h = hsl.x;
    let s = hsl.y;
    let l = hsl.z;
    if (s == 0.0) {
        return vec3<f32>(l, l, l);
    }
    var q: f32 = 0.0;
    if (l < 0.5) { q = l * (1.0 + s); } else { q = l + s - l * s; }
    let p: f32 = 2.0 * l - q;
    return vec3<f32>(
        hue2rgb(p, q, h + 1.0/3.0),
        hue2rgb(p, q, h),
        hue2rgb(p, q, h - 1.0/3.0)
    );
}

// ---- Neighborhood sampling ----
fn sampleNeighborhoodAvgAndLumaVar(centerUV: vec2<f32>, radius: i32, texSize: vec2<f32>) -> vec4<f32> {
    // returns (avg_rgb.r, avg_rgb.g, avg_rgb.b, lumaVariance)
    let inv = vec2<f32>(1.0 / texSize.x, 1.0 / texSize.y);
    var sum: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
    var sumLuma: f32 = 0.0;
    var sumLumaSq: f32 = 0.0;
    var count: i32 = 0;
    for (var y: i32 = -radius; y <= radius; y = y + 1) {
        for (var x: i32 = -radius; x <= radius; x = x + 1) {
            let offset = vec2<f32>(f32(x), f32(y)) * inv;
            let sampleUV = clamp(centerUV + offset, vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));
            let c = textureSampleLevel(readTexture, u_sampler, sampleUV, 0.0).rgb;
            sum = sum + c;
            let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
            sumLuma = sumLuma + luma;
            sumLumaSq = sumLumaSq + luma * luma;
            count = count + 1;
        }
    }
    let n: f32 = f32(count);
    let avg = sum / n;
    let avgLuma = sumLuma / n;
    let avgLumaSq = sumLumaSq / n;
    let variance = max(0.0, avgLumaSq - avgLuma * avgLuma);
    return vec4<f32>(avg, variance);
}

// ---- Palette generation (HSL hue-shift complementary) ----
fn generateHueShiftPalette(avgRGB: vec3<f32>, hueShift: f32, delta: f32) -> array<vec3<f32>, 3> {
    var pal: array<vec3<f32>, 3>;
    let hsl = rgb_to_hsl(avgRGB);
    // shift hue by hueShift (0..1) (e.g., 0.5 -> 180deg)
    let baseH: f32 = fract(hsl.x + hueShift);
    let h1: f32 = fract(baseH + delta);
    let h2: f32 = fract(baseH - delta + 1.0);
    pal[0] = hsl_to_rgb(vec3<f32>(baseH, hsl.y, hsl.z));
    pal[1] = hsl_to_rgb(vec3<f32>(h1, clamp(hsl.y * 0.9, 0.0, 1.0), clamp(hsl.z * 1.05, 0.0, 1.0)));
    pal[2] = hsl_to_rgb(vec3<f32>(h2, clamp(hsl.y * 0.8, 0.0, 1.0), clamp(hsl.z * 0.95, 0.0, 1.0)));
    return pal;
}

// ---- Main compute shader ----
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let texSize = u.config.zw; // resolutionX, resolutionY
    let resolution = texSize;
    let uv = vec2<f32>(global_id.xy) / resolution;
    let currentTime = u.config.x;

    // Ambient displacement (same as before)
    var ambientDisplacement: vec2<f32> = vec2<f32>(0.0, 0.0);
    let background_factor = 1.0 - smoothstep(0.0, 0.15, textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r);
    if (background_factor > 0.0) {
        let time = currentTime * 0.6;
        let base_ambient_strength = 0.006;
        let ambient_freq = 12.0;
        let motion = vec2<f32>(sin(uv.y * ambient_freq + time * 1.6), cos(uv.x * ambient_freq + time * 0.9));
        ambientDisplacement = motion * base_ambient_strength * background_factor;
    }

    // Mouse ripples (same as before)
    var mouseDisplacement: vec2<f32> = vec2<f32>(0.0, 0.0);
    let rippleCount: u32 = u32(u.config.y);
    for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
        let rippleData = u.ripples[i];
        let timeSinceClick = currentTime - rippleData.z;
        if (timeSinceClick > 0.0 && timeSinceClick < 4.0) {
            let direction_vec = uv - rippleData.xy;
            let dist = length(direction_vec);
            if (dist > 0.0001) {
                let rippleOriginDepthFactor = 1.0 - textureSampleLevel(readDepthTexture, non_filtering_sampler, rippleData.xy, 0.0).r;
                let ripple_speed = mix(1.2, 2.5, rippleOriginDepthFactor);
                let ripple_amplitude = mix(0.008, 0.02, rippleOriginDepthFactor);
                let wave = sin(dist * 30.0 - timeSinceClick * ripple_speed);
                let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / (4.0 * mix(0.5, 1.0, rippleOriginDepthFactor)));
                let falloff = 1.0 / (dist * 12.0 + 1.0);
                mouseDisplacement += (direction_vec / dist) * wave * ripple_amplitude * falloff * attenuation;
            }
        }
    }

    let totalDisplacement = mouseDisplacement + ambientDisplacement;
    let colorDisplacedUV = uv + totalDisplacement;

    // Sample base color (displaced) and depth
    let baseColor = textureSampleLevel(readTexture, u_sampler, colorDisplacedUV, 0.0);
    let depthVal = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;

    // Neighborhood stats (avg RGB and luminance variance)
    let stats = sampleNeighborhoodAvgAndLumaVar(colorDisplacedUV, KERNEL_RADIUS, resolution);
    let avgRGB = stats.xyz;
    let lumaVar = stats.w;

    // Generate HSL complementary palette and pick nearest
    let palette = generateHueShiftPalette(avgRGB, 0.5, HUE_DELTA);
    var bestColor: vec3<f32> = palette[0];
    var bestDist: f32 = 1e9;
    // choose nearest palette color to avgRGB
    for (var pi: i32 = 0; pi < 3; pi = pi + 1) {
        let pcol = palette[pi];
        let d = dot(pcol - avgRGB, pcol - avgRGB);
        if (d < bestDist) { bestDist = d; bestColor = pcol; }
    }

    // coherence: stronger mapping when local variance is low
    let coherence = clamp(1.0 - (lumaVar / VAR_THRESHOLD), 0.0, 1.0);

    // depth-based subtle tint (preserve existing behavior)
    let tint = vec3<f32>(0.9 + depthVal * 0.2, 0.85 + depthVal * 0.15, 1.05 - depthVal * 0.2);
    let originalTinted = baseColor.rgb * tint;

    // Blend toward palette color based on coherence and global strength
    let finalRGB = mix(originalTinted, bestColor, coherence * PALETTE_STRENGTH);
    let finalColor = vec4<f32>(finalRGB, baseColor.a);

    // Write color and depth (same as before)
    textureStore(writeTexture, global_id.xy, finalColor);
    let depthDisplacedUV = uv + mouseDisplacement * 0.8;
    let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, depthDisplacedUV, 0.0).r;
    textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
}
