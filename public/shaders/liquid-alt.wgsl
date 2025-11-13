// Alternate liquid shader: stronger ripples + color tint
@group(0) @binding(0) var u_sampler: sampler;
@group(0) @binding(1) var readTexture: texture_2d<f32>;
@group(0) @binding(2) var writeTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var readDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var non_filtering_sampler: sampler;
@group(0) @binding(6) var writeDepthTexture: texture_storage_2d<r32float, write>;

struct Uniforms {
  config: vec4<f32>,              // time, rippleCount, resolutionX, resolutionY
  ripples: array<vec4<f32>, 50>,  // x, y, startTime, unused
};

@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let resolution = u.config.zw;
  let uv = vec2<f32>(global_id.xy) / resolution;
  let currentTime = u.config.x;

  // stronger ambient displacement for alt shader
  var ambientDisplacement = vec2<f32>(0.0, 0.0);
  let background_factor = 1.0 - smoothstep(0.0, 0.15, textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r);
  if (background_factor > 0.0) {
    let time = currentTime * 0.6;
    let base_ambient_strength = 0.006;
    let ambient_freq = 12.0;
    let motion = vec2<f32>(sin(uv.y * ambient_freq + time * 1.6), cos(uv.x * ambient_freq + time * 0.9));
    ambientDisplacement = motion * base_ambient_strength * background_factor;
  }

  // mouse-driven ripples with higher amplitude and frequency
  var mouseDisplacement = vec2<f32>(0.0, 0.0);
  let rippleCount = u32(u.config.y);
  for (var i: u32 = 0u; i < rippleCount; i = i + 1u) {
    let rippleData = u.ripples[i];
    let timeSinceClick = u.config.x - rippleData.z;
    if (timeSinceClick > 0.0 && timeSinceClick < 4.0) {
      let direction_vec = uv - rippleData.xy;
      let dist = length(direction_vec);
      if (dist > 0.0001) {
        let rippleOriginDepthFactor = 1.0 - textureSampleLevel(readDepthTexture, non_filtering_sampler, rippleData.xy, 0.0).r;
        let ripple_speed = mix(1.2, 2.5, rippleOriginDepthFactor);
        let ripple_amplitude = mix(0.008, 0.02, rippleOriginDepthFactor);
        let wave = sin(dist * 30.0 - timeSinceClick * ripple_speed);
        let attenuation = 1.0 - smoothstep(0.0, 1.0, timeSinceClick / (4.0 * mix(0.5, 1.0, rippleOriginDepthFactor)));
        let falloff = 1.0 / (dist * 12.0 + 1.0);
        mouseDisplacement += (direction_vec / dist) * wave * ripple_amplitude * falloff * attenuation;
      }
    }
  }

  let totalDisplacement = mouseDisplacement + ambientDisplacement;
  let colorDisplacedUV = uv + totalDisplacement;

  // Sample base color and apply a subtle tint based on depth
  let baseColor = textureSampleLevel(readTexture, u_sampler, colorDisplacedUV, 0.0);
  let depthVal = textureSampleLevel(readDepthTexture, non_filtering_sampler, uv, 0.0).r;
  let tint = vec3<f32>(0.9 + depthVal * 0.2, 0.85 + depthVal * 0.15, 1.05 - depthVal * 0.2);
  let tinted = vec4<f32>(baseColor.rgb * tint, baseColor.a);
  textureStore(writeTexture, global_id.xy, tinted);

  // Update depth texture (slightly blurred by displacement)
  let depthDisplacedUV = uv + mouseDisplacement * 0.8;
  let displacedDepth = textureSampleLevel(readDepthTexture, non_filtering_sampler, depthDisplacedUV, 0.0).r;
  textureStore(writeDepthTexture, global_id.xy, vec4<f32>(displacedDepth, 0.0, 0.0, 0.0));
}

