// DEBUGGING VERSION
struct FirePoint {
    pos: vec2<f32>,
    startTime: f32,
    _pading: f32,
};

struct Uniforms {
    time: f32,
    firePointCount: u32,
    _padding1: f32,
    _padding2: f32,
    @align(16) firePoints: array<FirePoint, 50>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

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
            let dist = distance(uv, fp.pos);
            let radius = time_since_click * 0.2;

            // Draw a simple expanding ring
            let ring = smoothstep(radius - 0.02, radius, dist) - smoothstep(radius, radius + 0.02, dist);
            final_color += vec3<f32>(ring);
        }
    }

    return vec4<f32>(final_color, 1.0);
}
