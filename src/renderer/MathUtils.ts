
export function fract(x: number): number {
    return x - Math.floor(x);
}

export function mix(x: number, y: number, a: number): number {
    return x * (1 - a) + y * a;
}

export function hash(x: number, y: number): number {
    const dot = x * 12.9898 + y * 78.233;
    return fract(Math.sin(dot) * 43758.5453);
}

export function noise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fract(x);
    const fy = fract(y);

    // Smoothstep
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);

    // Hash corners
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);

    // Mix
    return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

export function getTerrainHeight(x: number, z: number): number {
    // Matches public/shaders/terrain.wgsl:
    // let h = noise(p.xz * 0.05) * 5.0 + noise(p.xz * 0.2) * 1.0;
    return noise(x * 0.05, z * 0.05) * 5.0 + noise(x * 0.2, z * 0.2) * 1.0;
}
