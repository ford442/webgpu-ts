// music-gui.wgsl
// Displays a GUI image and highlights button regions controlled by a uniform array
@group(0) @binding(0) var<uniform> u: vec4<f32>; // time, buttonCount, unused, unused (we'll write buttons after this vec4)
@group(0) @binding(1) var u_sampler: sampler;
@group(0) @binding(2) var u_texture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> ui_rects: array<vec4<f32>, 6>;

// We will store button states in a separate array starting at binding index 3 in JS memory layout,
// but for safety we'll pack a few into additional uniforms via another buffer is not possible with auto layout,
// so we'll read button state from a small texture instead — however to keep simple, we pack button states into the second vec4 (u.yzw)

struct Buttons {
  states: array<f32, 8>,
}
// Note: we can't declare another uniform nicely with the auto pipeline layout fallback, so
// we'll read button indices from the first uniform block's spare components plus sample from texture if needed.

@fragment
fn fs_main(@builtin(position) fragPos: vec4<f32>) -> @location(0) vec4<f32> {
  // textureDimensions returns vec2<i32>; convert to float
  let texSize = vec2<f32>(textureDimensions(u_texture, 0));
  var uv = fragPos.xy / texSize;

  // Sample the GUI image
  let base = textureSample(u_texture, u_sampler, uv).rgb;

  // Simple button mapping: we'll treat up to 6 buttons arranged as rectangles supplied in ui_rects
  // Button states are encoded in u.z (bitmask)
  let time = u.x;
  let buttonMask = u.z;

  let rects = ui_rects;

  var outColor = base;

  for (var i: i32 = 0; i < 6; i = i + 1) {
    let r = rects[i];
    if (uv.x >= r.x && uv.x <= r.z && uv.y >= r.y && uv.y <= r.w) {
      // Cast buttonMask to unsigned, shift by u32(i), mask with 1u, then convert to float
      let bit = f32(((u32(buttonMask) >> u32(i)) & 1u));
      if (bit > 0.5) {
        // Illuminate: blend with a glow color and pulse with time
        let pulse = 0.5 + 0.5 * sin(time * 6.0 + f32(i) * 1.2);
        let glow = vec3<f32>(0.96, 0.6, 0.12) * (0.6 + 0.4 * pulse);
        outColor = mix(outColor, outColor + glow, 0.7);
      } else {
        // Dimmed button: slight desaturation
        let gray = dot(outColor, vec3<f32>(0.3,0.59,0.11));
        outColor = mix(outColor, vec3<f32>(gray), 0.55);
      }
    }
  }

  // gentle vignette
  let centered = uv - vec2<f32>(0.5);
  let v = smoothstep(0.8, 0.4, length(centered));
  outColor = mix(vec3<f32>(0.035, 0.03, 0.04), outColor, v);

  return vec4<f32>(outColor, 1.0);
}
