// This shader takes an HDR texture (with values > 1.0) and
// maps it to an LDR texture suitable for display.

@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var hdrTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  // A standard full-screen quad
  let pos = array<vec2<f32>, 4>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0),
    vec2(-1.0, 1.0), vec2(1.0, 1.0)
  );
  let uv = array<vec2<f32>, 4>(
    vec2(0.0, 1.0), vec2(1.0, 1.0),
    vec2(0.0, 0.0), vec2(1.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4(pos[vertex_index], 0.0, 1.0);
  output.uv = uv[vertex_index];
  return output;
}

// A simple and effective ACES-like tonemapping curve
// See: https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
fn aces_tonemap(color: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  let numerator = color * (a * color + b);
  let denominator = color * (c * color + d) + e;
  return clamp(numerator / denominator, vec3(0.0), vec3(1.0));
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let hdrColor = textureSample(hdrTexture, u_sampler, input.uv).rgb;

  // Apply tonemapping to bring HDR values into the LDR range
  let ldrColor = aces_tonemap(hdrColor);
  
  // Apply a gamma correction for sRGB displays
  let gamma_corrected = pow(ldrColor, vec3(1.0 / 2.2));

  return vec4(gamma_corrected, 1.0);
}
