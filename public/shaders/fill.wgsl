// This texture stores the original image
@group(0) @binding(0) var originalTexture: texture_2d<f32>;
// This texture stores the current state of our fill (read-only)
@group(0) @binding(1) var readState: texture_2d<f32>;
// We write the *next* step of the fill to this texture
@group(0) @binding(2) var writeState: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    clickCoords: vec2<f32>,
    threshold: f32,
    targetColor: vec4<f32>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

// Helper function to compare colors
fn colorDistance(c1: vec3<f32>, c2: vec3<f32>) -> f32 {
    return distance(c1, c2);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let dims = textureDimensions(originalTexture);
    let coords = vec2<i32>(global_id.xy);
    let uv = vec2<f32>(coords) / vec2<f32>(dims);

    let currentState = textureLoad(readState, coords, 0);

    // --- FIX IS HERE: SEEDING LOGIC ---
    // If the read texture is empty at this spot, check if we should plant a seed.
    // This logic only runs on the very first iteration after a click.
    if (currentState.r == 0.0 && currentState.g == 0.0) {
        let dist = distance(uv, u.clickCoords);
        if (dist < 0.002) { // A tiny radius to ensure we hit the pixel
            let myColor = textureLoad(originalTexture, coords, 0);
            if (colorDistance(myColor.rgb, u.targetColor.rgb) < u.threshold) {
                // Plant the seed: Mark as filled (R=1) and an active edge (G=1)
                textureStore(writeState, coords, vec4<f32>(1.0, 1.0, 0.0, 1.0));
            } else {
                // Clicked on a color that doesn't match, do nothing.
                textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
            }
            return; // Done with this pixel for this pass
        }
    }
    
    // If this pixel is already filled, it should not spread further.
    // Mark it as filled (R=1) but no longer an active edge (G=0).
    if (currentState.r > 0.5) {
        textureStore(writeState, coords, vec4<f32>(1.0, 0.0, 0.0, 1.0));
        return;
    }

    // --- EXPANSION LOGIC ---
    var shouldFill = false;
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            if (x == 0 && y == 0) { continue; }

            let neighborCoords = coords + vec2<i32>(x, y);
            if (neighborCoords.x >= 0 && neighborCoords.x < i32(dims.x) &&
                neighborCoords.y >= 0 && neighborCoords.y < i32(dims.y)) {
                
                let neighborState = textureLoad(readState, neighborCoords, 0);
                // Check if the neighbor was part of the last active edge (G > 0.5)
                if (neighborState.g > 0.5) { 
                    shouldFill = true;
                    break;
                }
            }
        }
        if (shouldFill) { break; }
    }

    if (shouldFill) {
        let myColor = textureLoad(originalTexture, coords, 0);
        if (colorDistance(myColor.rgb, u.targetColor.rgb) < u.threshold) {
            // This pixel matches, make it the NEW active edge.
            textureStore(writeState, coords, vec4<f32>(1.0, 1.0, 0.0, 1.0));
        } else {
            // This pixel doesn't match, so it's a boundary. Stop the fill here.
            textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        }
    } else {
        // This pixel is not near an active edge, so it remains unchanged.
        textureStore(writeState, coords, currentState);
    }
}
