@group(0) @binding(0) var originalTexture: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(1) var readState: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(2) var writeState: texture_storage_2d<rgba8unorm, write>;

struct Uniforms {
    clickCoords: vec2<f32>,
    threshold: f32,
    avgLuminance: f32, // The new average luminance data
    resolutions: vec4<f32>, // canvas.xy, source.xy
};
@group(0) @binding(3) var<uniform> u: Uniforms;

const LUMINANCE_VECTOR = vec3<f32>(0.2126, 0.7152, 0.0722);

fn colorDistance(c1: vec3<f32>, c2: vec3<f32>) -> f32 {
    return distance(c1, c2);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coords = vec2<i32>(global_id.xy);

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

    let clickImageUV = (u.clickCoords - 0.5) * scale + 0.5;
    let targetColorCoords = vec2<i32>(floor(clickImageUV * textureRes));
    let targetColorVec = textureLoad(originalTexture, targetColorCoords);
    let targetColor = targetColorVec.rgb;
    let targetLuminance = dot(targetColor, LUMINANCE_VECTOR);

    let canvasUV = vec2<f32>(coords) / canvasRes;
    let imageUV = (canvasUV - 0.5) * scale + 0.5;

    if (imageUV.x < 0.0 || imageUV.x > 1.0 || imageUV.y < 0.0 || imageUV.y > 1.0) {
        textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        return;
    }
    
    let myColorCoords = vec2<i32>(floor(imageUV * textureRes));
    let myColor = textureLoad(originalTexture, myColorCoords);
    let currentState = textureLoad(readState, coords);

    if (currentState.r > 0.5) {
        textureStore(writeState, coords, vec4<f32>(1.0, 0.0, currentState.b, 1.0)); // Preserve alpha
        return;
    }
    
    let isInitialState = currentState.a < 0.5;
    if (isInitialState) {
        let dist = distance(canvasUV, u.clickCoords);
        if (dist < 0.002) {
            if (colorDistance(myColor.rgb, targetColor) < u.threshold) {
                // --- FIX IS HERE: Calculate and store alpha on seed pixel ---
                let myLuminance = dot(myColor.rgb, LUMINANCE_VECTOR);
                var alpha = 1.0;
                if (myLuminance < targetLuminance) {
                    let darknessFactor = 1.0 - smoothstep(0.0, targetLuminance, myLuminance);
                    alpha = 1.0 - (darknessFactor * 0.85); // 85% max transparency
                }
                textureStore(writeState, coords, vec4<f32>(1.0, 1.0, alpha, 1.0));
            } else {
                textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
            }
        } else {
            textureStore(writeState, coords, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        }
        return;
    }

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
             // --- FIX IS HERE: Calculate and store alpha on expansion pixels ---
            let myLuminance = dot(myColor.rgb, LUMINANCE_VECTOR);
            var alpha = 1.0;
            if (myLuminance < targetLuminance) {
                let darknessFactor = 1.0 - smoothstep(0.0, targetLuminance, myLuminance);
                alpha = 1.0 - (darknessFactor * 0.85);
            }
            textureStore(writeState, coords, vec4<f32>(1.0, 1.0, alpha, 1.0));
        } else {
            textureStore(writeState, coords, currentState);
        }
    } else {
        textureStore(writeState, coords, currentState);
    }
}
