@group(0) @binding(0) var originalTexture: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(1) var readState: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(2) var writeState: texture_storage_2d<rgba8unorm, write>;

// --- FIX IS HERE: Simplified struct. The target color is now found inside the shader. ---
struct Uniforms {
    clickCoords: vec2<f32>,
    threshold: f32,
    _padding: f32, // Ensures vec4 alignment for the next element
    resolutions: vec4<f32>, // canvas.xy, source.xy
};
@group(0) @binding(3) var<uniform> u: Uniforms;

fn colorDistance(c1: vec3<f32>, c2: vec3<f32>) -> f32 {
    return distance(c1, c2);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coords = vec2<i32>(global_id.xy);

    // --- Aspect Ratio Correction & Target Color Discovery ---
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

    // --- FIX IS HERE: Determine the target color dynamically from the click coordinates ---
    let clickImageUV = (u.clickCoords - 0.5) * scale + 0.5;
    let targetColorCoords = vec2<i32>(floor(clickImageUV * textureRes));
    let targetColor = textureLoad(originalTexture, targetColorCoords).rgb;

    // --- Current Pixel Information ---
    let canvasUV = vec2<f32>(coords) / canvasRes;
    let imageUV = (canvasUV - 0.5) * scale + 0.5;

    // If this pixel is in a letterboxed (black bar) area, it can't be filled.
    if (imageUV.x < 0.0 || imageUV.x > 1.0 || imageUV.y < 0.0 || imageUV.y > 1.0) {
        textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        return;
    }
    
    let myColorCoords = vec2<i32>(floor(imageUV * textureRes));
    let myColor = textureLoad(originalTexture, myColorCoords);
    let currentState = textureLoad(readState, coords);

    // If a pixel is already filled, it should stay filled but not spread.
    if (currentState.r > 0.5) {
        textureStore(writeState, coords, vec4<f32>(1.0, 0.0, 0.0, 1.0));
        return;
    }
    
    // --- Seed Planting Logic ---
    let isInitialState = currentState.a < 0.5;
    if (isInitialState) {
        let dist = distance(canvasUV, u.clickCoords);
        if (dist < 0.002) {
            if (colorDistance(myColor.rgb, targetColor) < u.threshold) {
                textureStore(writeState, coords, vec4<f32>(1.0, 1.0, 0.0, 1.0));
            } else {
                textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
            }
        } else {
            textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        }
        return;
    }

    // --- Expansion Logic ---
    var shouldFill = false;
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            if (x == 0 && y == 0) { continue; }
            let neighborCoords = coords + vec2<i32>(x, y);
            if (neighborCoords.x >= 0 && neighborCoords.x < i32(canvasRes.x) &&
                neighborCoords.y >= 0 && neighborCoords.y < i32(canvasRes.y)) {
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
        if (colorDistance(myColor.rgb, targetColor) < u.threshold) {
            textureStore(writeState, coords, vec4<f32>(1.0, 1.0, 0.0, 1.0));
        } else {
            textureStore(writeState, coords, currentState);
        }
    } else {
        textureStore(writeState, coords, currentState);
    }
}
