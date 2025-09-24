@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    time: f32,
    resolutionX: f32,
    resolutionY: f32,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<f32>(u.resolutionX, u.resolutionY);
    let uv = vec2<f32>(global_id.xy) / resolution;
    let time = u.time * .5;
    let strength = 0.02;
    let frequency = 15.0;
    
    let d1 = sin(uv.x * frequency + time) * strength;
    let d2 = cos(uv.y * frequency * 0.7 + time) * strength;
    
    let displacedUV = uv + vec2<f32>(d1, d2);
    
    let color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);

let xy = global_id.xy;

if(((color.r+color.g+color.b)/3.0)>.75){
xy.x -= u32(d1/4.0);
xy.y -= u32(d2/4.0);
}

if(((color.r+color.g+color.b)/3.0)<.25){
xy.x += u32(d1/4.0);
xy.y += u32(d2/4.0);
}

    textureStore(writeTexture, xy, color);
}
