// galaxy-alt.wgsl
// Alternate galaxy shader: layered radial noise with orbiting stars and subtle bloom
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> uniforms : vec4<f32>; // time, zoom, panX, panY

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898,78.233))) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i + vec2<f32>(0.0,0.0)), hash(i + vec2<f32>(1.0,0.0)), u.x), mix(hash(i + vec2<f32>(0.0,1.0)), hash(i + vec2<f32>(1.0,1.0)), u.x), u.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + amp * noise(p * freq);
    freq = freq * 2.0;
    amp = amp * 0.5;
  }
  return v;
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>;
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32(in_vertex_index / 2u) * 4.0 - 1.0;
    let y = f32(in_vertex_index % 2u) * 4.0 - 1.0;
    output.position = vec4<f32>(x, -y, 0.0, 1.0);
    var uv = vec2<f32>((x + 1.0) * 0.5, (y + 1.0) * 0.5);
    uv = (uv - 0.5) / uniforms.y;
    uv += vec2<f32>(uniforms.z - 0.5, uniforms.w - 0.5);
    output.fragUV = uv;
    return output;
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
    let t = uniforms.x * 0.6;
    let centered = fragUV - vec2<f32>(0.5);
    let r = length(centered) * 1.6;
    let a = atan2(centered.y, centered.x);

    // layered rotatory noise bands
    let rings = smoothstep(0.0, 0.5, fract(r * 6.0 - t * 0.2));
    let swirl = fbm(vec2<f32>(r * 4.0, a * 1.2 + t * 0.5));

    // star layer: sparse bright points orbiting
    let starSeed = hash(floor(centered * 40.0) + vec2<f32>(floor(t * 0.5), 0.0));
    let star = step(0.995, starSeed + 0.02 * sin(t * 4.0 + r * 30.0));
    let starGlow = pow(max(0.0, 1.0 - r * 3.0), 4.0) * star;

    // base color gradient
    let base = mix(vec3<f32>(0.02, 0.03, 0.07), vec3<f32>(0.35, 0.1, 0.5), smoothstep(0.0, 1.2, r));

    // combine with swirl and rings
    var col = base * (0.5 + 0.8 * swirl * rings);

    // add soft bloom from star highlights
    col = col + vec3<f32>(1.2, 0.9, 0.6) * starGlow * 0.9;

    // subtle chroma shift over time
    col.r = col.r * (0.9 + 0.1 * sin(t * 0.7));
    col.b = col.b * (0.95 + 0.05 * cos(t * 0.9));

    // Mix with input texture lightly for richness
    let tex = textureSample(inputTexture, u_sampler, fragUV);
    col = mix(col, tex.rgb, 0.15);

    // final tone map
    col = col / (col + vec3<f32>(0.6));
    col = pow(col, vec3<f32>(0.95));

    return vec4<f32>(col, 1.0);
}

