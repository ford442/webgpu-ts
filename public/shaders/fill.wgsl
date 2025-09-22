@group(0) @binding(0) var originalTexture: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(1) var readState: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(2) var writeState: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    clickCoords: vec2<f32>,
    threshold: f32,
    targetColor: vec4<f32>,
};
@group(0) @binding(3) var<uniform> u: Uniforms;

fn colorDistance(c1: vec3<f32>, c2: vec3<f32>) -> f32 {
    return distance(c1, c2);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let dims = textureDimensions(originalTexture);
    let coords = vec2<i32>(global_id.xy);
    let uv = vec2<f32>(coords) / vec2<f32>(dims);

    let currentState = textureLoad(readState, coords);

    // If the read texture is empty, check if we should plant a seed.
    if (currentState.r == 0.0 && currentState.g == 0.0 && currentState.b == 0.0 && currentState.a == 0.0) {
        let dist = distance(uv, u.clickCoords);
        if (dist < 0.002) {
            // --- THIS LOGIC IS NOW RE-ENABLED ---
            // The uniform 'u.targetColor' now holds the actual color we clicked on.
            let myColor = textureLoad(originalTexture, coords);
            if (colorDistance(myColor.rgb, u.targetColor.rgb) < u.threshold) {
                // Plant the seed: Mark as filled (R=1) and an active edge (G=1)
                textureStore(writeState, coords, vec4<f32>(1.0, 1.0, 0.0, 1.0));
            } else {
                // Clicked on a color that doesn't match, store empty state.
                textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
            }
        } else {
            // This is not the seed pixel, so it starts empty.
            textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        }
        return;
    }
    
    // If a pixel is already filled, it should not spread further.
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
                
                let neighborState = textureLoad(readState, neighborCoords);
                if (neighborState.g > 0.5) { 
                    shouldFill = true;
                    break;
                }
            }
        }
        if (shouldFill) { break; }
    }

    if (shouldFill) {
        let myColor = textureLoad(originalTexture, coords);
        if (colorDistance(myColor.rgb, u.targetColor.rgb) < u.threshold) {
            textureStore(writeState, coords, vec4<f32>(1.0, 1.0, 0.0, 1.0));
        } else {
            textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        }
    } else {
        textureStore(writeState, coords, currentState);
    }
}
