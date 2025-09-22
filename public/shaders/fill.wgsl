@group(0) @binding(0) var originalTexture: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(1) var readState: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(2) var writeState: texture_storage_2d<rgba8unorm, write>;

// --- FIX IS HERE: Updated Uniforms struct to receive resolution data ---
struct Uniforms {
    clickCoords: vec2<f32>,
    threshold: f32,
    _padding: f32, // Ensures vec4 alignment for the next element
    targetColor: vec4<f32>,
    resolutions: vec4<f32>, // canvas.xy, source.xy
};
@group(0) @binding(3) var<uniform> u: Uniforms;

fn colorDistance(c1: vec3<f32>, c2: vec3<f32>) -> f32 {
    return distance(c1, c2);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coords = vec2<i32>(global_id.xy);

    // --- FIX IS HERE: Added aspect ratio correction logic ---
    let canvasRes = u.resolutions.xy;
    let textureRes = u.resolutions.zw;
    let canvasAspect = canvasRes.x / canvasRes.y;
    let textureAspect = textureRes.x / textureRes.y;
    var scale = vec2(1.0, 1.0);
    
    if (canvasAspect > textureAspect) {
        scale.x = textureAspect / canvasAspect;
    } else {
        scale.y = canvasAspect / textureAspect;
    }

    let canvasUV = vec2<f32>(coords) / canvasRes;
    // Transform the current pixel's UV to find its position on the source image
    let imageUV = (canvasUV - 0.5) * scale + 0.5;

    // If this pixel is in a letterboxed (black bar) area, it can't be filled.
    if (imageUV.x < 0.0 || imageUV.x > 1.0 || imageUV.y < 0.0 || imageUV.y > 1.0) {
        textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0)); // Mark as empty/processed
        return;
    }

    // Get the original color of this pixel using the corrected coordinates
    let myColorCoords = vec2<i32>(floor(imageUV * textureRes));
    let myColor = textureLoad(originalTexture, myColorCoords);
    
    let currentState = textureLoad(readState, coords);

    // If a pixel is already filled, it should stay filled but not spread.
    if (currentState.r > 0.5) {
        textureStore(writeState, coords, vec4<f32>(1.0, 0.0, 0.0, 1.0));
        return;
    }
    
    // --- Seed Planting Logic ---
    // Check if we should plant the initial seed on the very first pass.
    // The check for currentState.a == 0.0 handles the initial empty state.
    let isInitialState = currentState.r == 0.0 && currentState.g == 0.0 && currentState.b == 0.0 && currentState.a == 0.0;
    if (isInitialState) {
        // Compare the click position (in canvas space) to the pixel's position (in canvas space)
        let dist = distance(canvasUV, u.clickCoords);
        if (dist < 0.002) {
            // This is the clicked pixel. Now check if its color matches the target.
            if (colorDistance(myColor.rgb, u.targetColor.rgb) < u.threshold) {
                // Plant the seed: Mark as filled (R=1) and an active edge (G=1)
                textureStore(writeState, coords, vec4<f32>(1.0, 1.0, 0.0, 1.0));
            } else {
                textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
            }
        } else {
            textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        }
        return; // Done with this pixel for the first frame
    }

    // --- Expansion Logic ---
    var shouldFill = false;
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            if (x == 0 && y == 0) { continue; }

            let neighborCoords = coords + vec2<i32>(x, y);
            // Boundary check
            if (neighborCoords.x >= 0 && neighborCoords.x < i32(canvasRes.x) &&
                neighborCoords.y >= 0 && neighborCoords.y < i32(canvasRes.y)) {
                
                let neighborState = textureLoad(readState, neighborCoords);
                // Check if neighbor was an active edge in the previous frame
                if (neighborState.g > 0.5) { 
                    shouldFill = true;
                    break;
                }
            }
        }
        if (shouldFill) { break; }
    }

    if (shouldFill) {
        // Check if the current pixel's color matches the target before filling it.
        if (colorDistance(myColor.rgb, u.targetColor.rgb) < u.threshold) {
            textureStore(writeState, coords, vec4<f32>(1.0, 1.0, 0.0, 1.0));
        } else {
            // Color doesn't match, so don't fill. Copy the old state.
            textureStore(writeState, coords, currentState);
        }
    } else {
        // Not adjacent to an active edge, just copy the old state.
        textureStore(writeState, coords, currentState);
    }
}
