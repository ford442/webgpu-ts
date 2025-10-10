@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var sourceImage: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;

struct Uniforms {
    rotation: vec2<f32>,
    lightPos: vec2<f32>,
    zoom: f32,
    displacementScale: f32,
    ambientLight: f32,
    smoothness: f32,
    pointSize: f32,
    backlightOn: f32,
    time: f32,
};

@group(0) @binding(3) var<uniform> u: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
    @location(1) worldNormal: vec3<f32>,
    @location(2) worldPos: vec3<f32>,
    @location(3) particleUV: vec2<f32>,
};

const GRID_SIZE = 1024u;

fn sample_depth(uv: vec2<f32>) -> f32 { /* no change */ }

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput { /* no change */ }

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let dist_from_center = distance(in.particleUV, vec2<f32>(0.5));
    if (dist_from_center > 0.5) {
        discard;
    }

    let textureColor = textureSample(sourceImage, u_sampler, in.fragUV).rgb;
    let normal = normalize(in.worldNormal);
    
    // --- MODIFICATION START ---
    
    // 1. Calculate the standard front lighting. This is our base.
    let front_light_pos = vec3<f32>( (u.lightPos.x * 2.0 - 1.0), (1.0 - u.lightPos.y) * 2.0 - 1.0, -1.0);
    let front_light_dir = normalize(front_light_pos - in.worldPos);
    let front_diffuse = max(dot(normal, front_light_dir), 0.0) * 0.8;
    let base_lighting = u.ambientLight + front_diffuse;
    var finalColor = textureColor * base_lighting;

    var additive_light = vec3<f32>(0.0);

    // 2. If the backlight is on, calculate its effects.
    if (u.backlightOn > 0.5) {
        let backlightColor = vec3<f32>(1.0, 0.85, 0.7);
        let backlightIntensity = 2.5;

        // "Shine-through" effect
        let luminance = dot(textureColor, vec3<f32>(0.299, 0.587, 0.114));
        let through_light = backlightColor * pow(luminance, 4.0) * backlightIntensity;
        
        // Rim light effect
        let back_light_pos = vec3<f32>((u.lightPos.x * 2.0 - 1.0), (1.0 - u.lightPos.y) * 2.0 - 1.0, 1.5);
        let back_light_dir = normalize(back_light_pos - in.worldPos);
        let view_dir = normalize(-in.worldPos);
        let back_diffuse = max(dot(normal, back_light_dir), 0.0);
        let rim_dot = pow(1.0 - max(dot(view_dir, normal), 0.0), 2.0);
        let rim_light = backlightColor * rim_dot * back_diffuse * backlightIntensity;

        // Glow effect
        var glow = vec3<f32>(0.0);
        // ... (glow logic is complex, so keeping it simple)

        // Combine the backlight effects into a single additive light color
        additive_light = through_light + rim_light + glow;
    }

    // 3. Add the backlight effects to the base color.
    finalColor += additive_light;
    
    // --- MODIFICATION END ---
    
    return vec4<f32>(finalColor, 1.0);
}
