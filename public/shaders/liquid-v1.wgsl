 let rate = 0.5;
    let strength = 0.02;
    let frequency = 15.0;

    // 2. Create a "background factor". 
    // This will be 0.0 for the absolute foreground (depth < 0.1)
    // and smoothly increase to 1.0 for the background.
    let background_factor = smoothstep(0.1, 0.5, depth);
    
    // --- MODIFIED: End of changes ---

    let time = u.time * rate;

    // 3. Calculate the displacement.
    var d1 = sin(uv.x * frequency + time) * strength;
    var d2 = cos(uv.y * frequency * 0.7 + time) * strength;
    
    // 4. Apply the background_factor to the final displacement.
    // This means the foreground will have zero ambient motion,
    // and the background will have full motion.
    var displacedUV = uv + (vec2<f32>(d1, d2) * background_factor);
    
    var color = textureSampleLevel(readTexture, u_sampler, displacedUV, 0.0);
    textureStore(writeTexture, global_id.xy, color);
}
