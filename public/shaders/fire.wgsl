@group(0) @binding(0) var<uniform> uniforms : vec4<f32>;

fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);

    let a = hash(i + vec2<f32>(0.0, 0.0));
    let b = hash(i + vec2<f32>(1.0, 0.0));
    let c = hash(i + vec2<f32>(0.0, 1.0));
    let d = hash(i + vec2<f32>(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const octaves = 5;

fn fbm(p: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 0.0;

    for (var i = 0; i < octaves; i = i + 1) {
        value = value + amplitude * noise(p);
        p = p * 2.0;
        amplitude = amplitude * 0.5;
    }
    return value;
}

@fragment
fn fs_main(@builtin(position) frag_coord: vec4<f32>) -> @location(0) vec4<f32> {
    let time = uniforms.x * 0.5;
    var uv = frag_coord.xy / vec2<f32>(800.0, 600.0);
    
    let q = vec2<f32>(fbm(uv + time), fbm(uv + vec2<f32>(1.0)));
    let r = vec2<f32>(fbm(uv + q + vec2<f32>(1.7, 9.2) + 0.15 * time), fbm(uv + q + vec2<f32>(8.3, 2.8) + 0.126 * time));
    
    let value = fbm(uv + r);
    
    let color = mix(vec3<f32>(0.0), mix(vec3<f32>(1.0, 0.5, 0.0), vec3<f32>(1.0, 1.0, 0.0), value), pow(value, 2.0));
    
    return vec4<f32>(color, 1.0);
}

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
    let x = f32(in_vertex_index / 2u) * 4.0 - 1.0;
    let y = f32(in_vertex_index % 2u) * 4.0 - 1.0;
    return vec4<f32>(x, -y, 0.0, 1.0);
}
