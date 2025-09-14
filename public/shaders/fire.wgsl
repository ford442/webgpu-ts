struct FirePoint {
    pos: vec2<f32>,
    startTime: f32,
    _pading: f32, // Added for 16-byte alignment
};

struct Uniforms {
    time: f32,
    firePointCount: u32,
    // Two f32s for padding to ensure firePoints is 16-byte aligned
    _padding1: f32,
    _padding2: f32,
    @align(16) firePoints: array<FirePoint, 50>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

// Function to convert HSV color to RGB
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
    let RGB = clamp(abs((c.x * 6.0 + vec3<f32>(0.0, 4.0, 2.0)) % 6.0 - 3.0) - 1.0, vec3<f32>(0.0), vec3<f32>(1.0));
    return c.z * mix(vec3<f32>(1.0), RGB, c.y);
}

fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// DEBUGGING: Replace the original fbm function with this one.
fn fbm(p: vec2<f32>) -> f32 {
    // We are temporarily removing the complex loop and noise calculations.
    // Returning a simple value will tell us if the crash is happening inside this function.
    return 0.5;
}

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
    let x = f32(in_vertex_index / 2u) * 4.0 - 1.0;
    let y = f32(in_vertex_index % 2u) * 4.0 - 1.0;
    return vec4<f32>(x, -y, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag_coord: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = frag_coord.xy / vec2<f32>(800.0, 600.0);
    var final_color = vec3<f32>(0.0);
    let currentTime = u.time;

    for (var i = 0u; i < u.firePointCount; i = i + 1u) {
        let fp = u.firePoints[i];
        let time_since_click = currentTime - fp.startTime;

        if (time_since_click > 0.0 && time_since_click < 4.0) {
            let dir = uv - fp.pos;
            let dist = length(dir);
            let angle = atan2(dir.y, dir.x);
            
            let fbm_uv = vec2<f32>(dist, angle * 2.0);
            
            var f = fbm(fbm_uv * 3.0 - vec2<f32>(time_since_click * 0.5, 0.0));
            
            let life = smoothstep(0.0, 1.0, time_since_click / 4.0);
            f *= 1.0 - life;
            f *= smoothstep(0.0, 0.05, dist) * (1.0 - smoothstep(0.2, 0.5, dist));

            let hue = fract(angle / (2.0 * 3.14159) + currentTime * 0.2);
            let color = hsv2rgb(vec3<f32>(hue, 1.0, f));
            
            final_color += color;
        }
    }

    return vec4<f32>(final_color, 1.0);
}
