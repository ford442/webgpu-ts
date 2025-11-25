import { vec3 } from 'gl-matrix';
import { PhysicsEngine } from './Physics';

describe('PhysicsEngine', () => {
    test('resolveTreeCollisions should push player out of tree', () => {
        const treePos = vec3.fromValues(10, 0, 10);
        const physics = new PhysicsEngine([treePos]);

        // Player slightly inside tree
        const playerPos = vec3.fromValues(10.1, 0, 10);
        const hit = physics.resolveTreeCollisions(playerPos);

        expect(hit).toBe(true);
        // Should be pushed away
        const dist = Math.sqrt(Math.pow(playerPos[0] - 10, 2) + Math.pow(playerPos[2] - 10, 2));
        expect(dist).toBeGreaterThanOrEqual(0.8); // 0.3 (tree) + 0.5 (player)
    });

    test('constrainToBounds should clamp position', () => {
        const physics = new PhysicsEngine([]);
        const pos = vec3.fromValues(200, 0, 0);
        physics.constrainToBounds(pos);
        expect(pos[0]).toBe(100); // mapSize is 200, half is 100
    });
});
