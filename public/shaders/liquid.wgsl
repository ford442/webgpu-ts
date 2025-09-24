// ... (All previous bindings, structs, and helper functions are the same) ...

struct Ripple { /* ... */ };
struct Uniforms { /* ... */ };
@group(0) @binding(3) var<uniform> u: Uniforms;
fn hash(p: vec2<f32>) -> f32 { /* ... */ }
fn noise(p: vec2<f32>) -> f32 { /* ... */ }
fn fbm(p: vec2<f32>) -> f32 { /* ... */ }


// --- NEW: Color Grading Function ---
fn color_grade(color: vec3<f32>) -> vec3<f32> {
  // 1. Apply a cinematic S-curve for contrast
  let contrasted = smoothstep(0.1, 0.9, color);

  // 2. Boost saturation
  let luma = dot(contrasted, vec3(0.299, 0.587, 0.114));
  let saturated = mix(vec3(luma), contrasted, 1.2); // 1.2 = 20% saturation boost

  return saturated;
}


@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  // ... (Initial setup: resolution, uv, time is the same) ...
  let resolution = u.config.zw;
  if (global_id.x >= u32(resolution.x) || global_id.y >= u32(resolution.y)) { return; }
  let uv = vec2<f32>(global_id.xy) / resolution;
  let time = u.config.x;
  
  // --- 1. Calculate the displacement map and other surface effects ---
  // ... (This entire section for calculating totalDisplacement, specular, 
  //      addedColor, and causticStrength is IDENTICAL to the previous version) ...
  var totalDisplacement = vec2<f32>(0.0);
  var specular = 0.0;
  var addedColor = vec3<f32>(0.0);
  var causticStrength = 0.0;
  // (ambient fbm loop)
  // (interactive ripple loop)

  // --- 2. Sample Textures and Apply Effects ---

  // MODIFIED: Fetch the original, undisturbed color first
  let originalColor = textureSampleLevel(readTexture, u_sampler, uv, 0.0).rgb;

  // A. Refraction (Chromatic Aberration)
  let displacedUV_R = uv + totalDisplacement * 1.02;
  let displacedUV_G = uv + totalDisplacement;
  let displacedUV_B = uv + totalDisplacement * 0.98;
  
  let refractedColor = vec3(
    textureSampleLevel(readTexture, u_sampler, displacedUV_R, 0.0).r,
    textureSampleLevel(readTexture, u_sampler, displacedUV_G, 0.0).g,
    textureSampleLevel(readTexture, u_sampler, displacedUV_B, 0.0).b
  );

  // B. Caustics Simulation
  let caustic_uv = uv + totalDisplacement * 0.1;
  let caustics = fbm(caustic_uv * 12.0 + time * 0.5) * causticStrength;
  let causticColor = vec3(caustics * 0.6); // Increased brightness for HDR

  // --- 3. Composite Layers Together (The "Blending") ---
  
  // The "refraction amount" is based on how much displacement there is.
  // This prevents the whole image from looking distorted and creates the smooth slide.
  let refractionAmount = clamp(length(totalDisplacement) * 20.0, 0.0, 1.0);
  
  // Blend between the original color and the refracted color
  var compositedColor = mix(originalColor, refractedColor, refractionAmount);

  // Add the "dye" color on top
  compositedColor = mix(compositedColor, addedColor, clamp(length(addedColor), 0.0, 1.0));
  
  // Add caustics and specular highlights. These can push color values > 1.0
  compositedColor += causticColor;
  compositedColor += vec3(specular * 1.5); // Boost specular for HDR

  // --- 4. Final Polish: Color Grading ---
  let finalColor = color_grade(compositedColor);

  // --- 5. Final Output ---
  // The texture format is now rgba16float, so it can store the HDR values.
  textureStore(writeTexture, global_id.xy, vec4(finalColor, 1.0));
}
