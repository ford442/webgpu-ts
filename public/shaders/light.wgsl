struct Uniforms {
    time: f32,
    resolutionX: f32,
    resolutionY: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32(in_vertex_index / 2u) * 4.0 - 1.0;
    let y = f32(in_vertex_index % 2u) * 4.0 - 1.0;
    output.position = vec4<f32>(x, -y, 0.0, 1.0);
    return output;
}

fn hash1(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453);
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = fragCoord.xy / vec2<f32>(u.resolutionX, u.resolutionY);
    
    let time = u.time * 0.1;
    let angle = 0.5; // Angle of the light rays
    let c = cos(angle);
    let s = sin(angle);
    let rot_matrix = mat2x2<f32>(c, -s, s, c);
    var rotated_uv = (uv - 0.5) * rot_matrix + 0.5;

    let light_bands = sin(rotated_uv.x * 10.0 + time * 5.0) * 0.5 + 0.5;
    let light_intensity = pow(light_bands, 8.0) * 0.6;
    
    let noise = hash1(uv + time * 0.1) * 0.2;
    
    let final_intensity = (light_intensity + noise) * 0.8;
    
    return vec4<f32>(vec3<f32>(1.0, 0.95, 0.8) * final_intensity, 1.0);
}
