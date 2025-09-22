// ---- COMPUTE SHADER ----
// This shader performs an iterative flood fill.

@group(0) @binding(0) var originalTexture: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(1) var readState: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(2) var writeState: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
  // .xy = click coordinates in UV space (0-1)
  // .zw = texture dimensions
  params: vec4<f32>,
  threshold: f32,
  // The color of the region we want to fill
  targetColor: vec4<f32>,
  // 0 for seeding, > 0 for spreading
  frameNum: u32,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

fn colorDistance(c1: vec3<f32>, c2: vec3<f32>) -> f32 {
  // Using squared distance is slightly faster as it avoids a square root.
  // The threshold will need to be adjusted accordingly (e.g., if threshold was 0.1, it's now 0.01).
  let diff = c1 - c2;
  return dot(diff, diff);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let dims = u.params.zw;
  let coords = vec2<i32>(global_id.xy);

  // Prevent out-of-bounds access
  if (coords.x >= i32(dims.x) || coords.y >= i32(dims.y)) {
    return;
  }
  
  let uv = vec2<f32>(coords) / dims;

  // --- Seeding Step (first frame only) ---
  if (u.frameNum == 0u) {
    let dist = distance(uv, u.params.xy);
    // Is this the seed pixel?
    if (dist < 1.0 / dims.x) { // A radius of 1 pixel
        let myColor = textureLoad(originalTexture, coords, 0);
        // Check if the color at the click location matches the target
        if (colorDistance(myColor.rgb, u.targetColor.rgb) < u.threshold) {
             textureStore(writeState, coords, vec4(1.0, 0.0, 0.0, 1.0));
        } else {
             textureStore(writeState, coords, vec4(0.0, 0.0, 0.0, 1.0));
        }
    } else {
        textureStore(writeState, coords, vec4(0.0, 0.0, 0.0, 1.0));
    }
    return;
  }

  // --- Spreading Step (subsequent frames) ---

  let currentState = textureLoad(readState, coords);

  // If this pixel is already filled, just carry it over and stop.
  if (currentState.r > 0.5) {
    textureStore(writeState, coords, vec4(1.0, 0.0, 0.0, 1.0));
    return;
  }

  // Check if my color is within the fill region
  let myColor = textureLoad(originalTexture, coords);
  if (colorDistance(myColor.rgb, u.targetColor.rgb) >= u.threshold) {
    // My color is wrong, so I can't be filled. Copy old state.
    textureStore(writeState, coords, currentState);
    return;
  }

  // Check neighbors in the readState to see if the fill should spread to me.
  var shouldFill = false;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      if (x == 0 && y == 0) { continue; }

      let neighborCoords = coords + vec2<i32>(x, y);

      // Check bounds
      if (neighborCoords.x >= 0 && neighborCoords.x < i32(dims.x) &&
          neighborCoords.y >= 0 && neighborCoords.y < i32(dims.y)) {
        
        let neighborState = textureLoad(readState, neighborCoords, 0);
        if (neighborState.r > 0.5) { // Is neighbor filled?
          shouldFill = true;
          break;
        }
      }
    }
    if (shouldFill) { break; }
  }

  if (shouldFill) {
    textureStore(writeState, coords, vec4(1.0, 0.0, 0.0, 1.0));
  } else {
    // Not adjacent to a fill, so carry over the old state (which is empty).
    textureStore(writeState, coords, currentState);
  }
}
