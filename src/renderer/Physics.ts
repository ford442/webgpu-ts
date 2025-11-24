import { vec3 } from 'gl-matrix';
import { getTerrainHeight } from './MathUtils';

export class PhysicsEngine {
    private treePositions: vec3[];
    private mapSize: number = 200;
    private treeRadius: number = 0.3; // Matches Geometry.ts trunk radius
    private playerRadius: number = 0.5;

    constructor(treePositions: vec3[]) {
        this.treePositions = treePositions;
    }

    public getGroundHeight(x: number, z: number): number {
        return getTerrainHeight(x, z);
    }

    public constrainToBounds(position: vec3) {
        const halfSize = this.mapSize / 2;
        // Clamp X and Z
        if (position[0] < -halfSize) position[0] = -halfSize;
        if (position[0] > halfSize) position[0] = halfSize;
        if (position[2] < -halfSize) position[2] = -halfSize;
        if (position[2] > halfSize) position[2] = halfSize;
    }

    // Returns true if collision occurred
    public resolveTreeCollisions(position: vec3): boolean {
        let hit = false;
        const pX = position[0];
        const pZ = position[2];
        const minDist = this.treeRadius + this.playerRadius;
        const minDistSq = minDist * minDist;

        for (const tree of this.treePositions) {
            const dx = pX - tree[0];
            const dz = pZ - tree[2];
            const distSq = dx*dx + dz*dz;

            if (distSq < minDistSq && distSq > 0.0001) {
                // Collision
                const dist = Math.sqrt(distSq);
                const overlap = minDist - dist;

                // Push out vector
                const nx = dx / dist;
                const nz = dz / dist;

                // Slide
                position[0] += nx * overlap;
                position[2] += nz * overlap;
                hit = true;
            }
        }
        return hit;
    }
}
