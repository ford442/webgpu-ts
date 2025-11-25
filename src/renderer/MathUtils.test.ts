import { getTerrainHeight, hash, noise } from './MathUtils';

describe('MathUtils', () => {
    test('hash should return value between 0 and 1', () => {
        const v = hash(10, 20);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
    });

    test('noise should return smooth values', () => {
        const n1 = noise(10, 10);
        const n2 = noise(10.1, 10);
        expect(Math.abs(n1 - n2)).toBeLessThan(0.5);
    });

    test('getTerrainHeight returns height', () => {
        const h = getTerrainHeight(0, 0);
        expect(typeof h).toBe('number');
    });
});
