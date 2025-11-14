@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var u_texture: texture_2d<f32>;

struct PinballUniforms {
  ballPos: vec2<f32>,
  ballVel: vec2<f32>,
  leftFlipperActive: f32,
  rightFlipperActive: f32,
  canvasSize: vec2<f32>,
  audioFreq: f32,       // 0..1 audio intensity
  time: f32,
  _pad: vec2<f32>,       // padding for alignment
};

@group(0) @binding(2) var<uniform> u: PinballUniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) fragUV: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32(in_vertex_index / 2u) * 4.0 - 1.0;
    let y = f32(in_vertex_index % 2u) * 4.0 - 1.0;
    output.position = vec4<f32>(x, -y, 0.0, 1.0);
    output.fragUV = vec2<f32>((x + 1.0) * 0.5, (y + 1.0) * 0.5);
    return output;
}

// Smooth shading for the ball with glossy highlight
fn shadedBall(uv: vec2<f32>, center: vec2<f32>, radius: f32, audioFreq: f32) -> vec4<f32> {
    let d = distance(uv, center);
    let edge = smoothstep(radius + 0.01, radius - 0.02, d);
    if (edge < 0.01) { return vec4<f32>(0.0); }

    // Base ball color (golden/yellow with audio modulation)
    let hue = mix(0.12, 0.15, audioFreq * 0.3); // shift yellow tone
    let saturation = mix(0.9, 1.0, audioFreq);
    let brightness = mix(0.8, 1.0, audioFreq);
    let baseColor = hsv2rgb(vec3<f32>(hue, saturation, brightness));

    // Glossy highlight based on angle from center
    let dir = normalize(uv - center);
    let highlight = pow(max(0.0, dot(dir, normalize(vec2<f32>(0.3, -0.5)))), 8.0);
    let highlightColor = mix(baseColor, vec3<f32>(1.0), highlight * 0.6);

    // Shadow/depth on opposite side
    let shadow = pow(max(0.0, 1.0 - dot(dir, vec2<f32>(0.3, -0.5))), 3.0) * 0.3;
    let finalColor = mix(highlightColor - shadow, highlightColor, edge);

    return vec4<f32>(finalColor, edge);
}

// HSV to RGB conversion
fn hsv2rgb(hsv: vec3<f32>) -> vec3<f32> {
    let c = hsv.z * hsv.y;
    let x = c * (1.0 - abs((hsv.x * 6.0) % 2.0 - 1.0));
    let m = hsv.z - c;

    var rgb: vec3<f32>;
    if (hsv.x < 1.0 / 6.0) { rgb = vec3<f32>(c, x, 0.0); }
    else if (hsv.x < 2.0 / 6.0) { rgb = vec3<f32>(x, c, 0.0); }
    else if (hsv.x < 3.0 / 6.0) { rgb = vec3<f32>(0.0, c, x); }
    else if (hsv.x < 4.0 / 6.0) { rgb = vec3<f32>(0.0, x, c); }
    else if (hsv.x < 5.0 / 6.0) { rgb = vec3<f32>(x, 0.0, c); }
    else { rgb = vec3<f32>(c, 0.0, x); }

    return rgb + m;
}

// Draw a flipper (rectangle with rounded corners)
fn drawFlipper(uv: vec2<f32>, flipperCenter: vec2<f32>, angle: f32, length: f32, width: f32) -> f32 {
    // Transform to flipper-local coords
    let rel = uv - flipperCenter;
    let rotated = vec2<f32>(
        rel.x * cos(angle) - rel.y * sin(angle),
        rel.x * sin(angle) + rel.y * cos(angle)
    );

    // Rounded rectangle in local space
    let halfLen = length * 0.5;
    let halfWid = width * 0.5;
    let rectDist = max(abs(rotated.x) - halfLen, abs(rotated.y) - halfWid);
    let cornerRadius = width * 0.3;

    if (rectDist > cornerRadius) { return 0.0; }
    return smoothstep(cornerRadius + 0.01, cornerRadius - 0.02, rectDist);
}

// Draw bumper circles
fn drawBumper(uv: vec2<f32>, center: vec2<f32>, radius: f32, activeStrength: f32) -> vec4<f32> {
    let d = distance(uv, center);
    let edge = smoothstep(radius + 0.02, radius - 0.03, d);
    if (edge < 0.01) { return vec4<f32>(0.0); }

    // Bumper glow based on activation
    let glowColor = mix(vec3<f32>(0.2, 0.8, 1.0), vec3<f32>(1.0, 0.2, 0.2), activeStrength);
    let glow = pow(edge, 2.0) * (1.0 + activeStrength * 2.0);

    return vec4<f32>(glowColor * glow, edge);
}

@fragment
fn fs_main(@location(0) fragUV: vec2<f32>) -> @location(0) vec4<f32> {
    // background sample
    var color:vec3<f32> = vec3f(textureSample(u_texture, u_sampler, fragUV).rgb);

    // Draw bumpers (top and bottom center, left and right middle)
    let bumperRadius = 0.04;
    let bump1 = drawBumper(fragUV, vec2<f32>(0.5, 0.15), bumperRadius, 0.2);
    let bump2 = drawBumper(fragUV, vec2<f32>(0.5, 0.8), bumperRadius, 0.2);
    let bump3 = drawBumper(fragUV, vec2<f32>(0.2, 0.5), bumperRadius, 0.3);
    let bump4 = drawBumper(fragUV, vec2<f32>(0.8, 0.5), bumperRadius, 0.3);

    color = mix(color, bump1.rgb, bump1.a);
    color = mix(color, bump2.rgb, bump2.a);
    color = mix(color, bump3.rgb, bump3.a);
    color = mix(color, bump4.rgb, bump4.a);

    // Draw flippers (angle based on activity)
    let leftFlipperAngle = mix(-0.5, 0.7, u.leftFlipperActive);
    let rightFlipperAngle = mix(0.5, -0.7, u.rightFlipperActive);

    let flipperLeft = drawFlipper(fragUV, vec2<f32>(0.2, 0.85), leftFlipperAngle, 0.25, 0.06);
    let flipperRight = drawFlipper(fragUV, vec2<f32>(0.8, 0.85), rightFlipperAngle, 0.25, 0.06);

    let flipperColor = vec3<f32>(0.1, 0.9, 0.1);
    color = mix(color, flipperColor, flipperLeft * 0.8);
    color = mix(color, flipperColor, flipperRight * 0.8);

    // Draw the ball with enhanced shading
    let ballShaded = shadedBall(fragUV, u.ballPos, 0.03, u.audioFreq);
    color = mix(color, ballShaded.rgb, ballShaded.a);

    // Add slight vignette
    let vignette = smoothstep(1.0, 0.3, distance(fragUV, vec2<f32>(0.5, 0.5)));
    color = color * mix(0.7, 1.0, vignette);

    return vec4<f32>(color, 1.0);
}

