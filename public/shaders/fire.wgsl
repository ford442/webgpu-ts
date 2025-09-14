fn fbm(p: vec2<f32>) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var shift = vec2<f32>(100.0);
    var p_mutable = p; // Create a mutable copy of 'p'
    for (var i = 0; i < 5; i = i + 1) {
        v += a * noise(p_mutable);
        p_mutable = p_mutable * 2.0 + shift; // Use the mutable copy
        a *= 0.5;
    }
    return v;
}
