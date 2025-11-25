import { mat4, vec3, glMatrix } from 'gl-matrix';
import { InputHandler } from './InputHandler';
import { PhysicsEngine } from './Physics';

const toRadian = glMatrix.toRadian;

export class Camera {
    public position: vec3;
    private front: vec3;
    private up: vec3;
    private right: vec3;
    private worldUp: vec3;

    public yaw: number;
    public pitch: number;

    private fov: number;
    private aspect: number;
    private near: number;
    private far: number;

    // Physics State
    private walkVelocity: vec3 = vec3.create();
    private impactVelocity: vec3 = vec3.create();
    private verticalVelocity: number = 0;

    public isGrounded: boolean = false;
    public isDebug: boolean = false;
    private debugToggleLatch: boolean = false;

    private eyeHeight: number = 2.0; // Player height

    // Constants
    private walkSpeed: number = 10.0;
    private flySpeed: number = 20.0;
    private jumpForce: number = 8.0;
    private gravity: number = 20.0;
    private dodgeForce: number = 15.0;
    private impactDamping: number = 0.90; // Decay per frame

    constructor(position: vec3 = vec3.fromValues(0, 0, 0), aspect: number = 1.0) {
        this.position = position;
        this.worldUp = vec3.fromValues(0, 1, 0);
        this.front = vec3.fromValues(0, 0, -1);
        this.up = vec3.create();
        this.right = vec3.create();

        this.yaw = -90.0;
        this.pitch = 0.0;

        this.fov = 45.0;
        this.aspect = aspect;
        this.near = 0.1;
        this.far = 1000.0;

        this.updateCameraVectors();
    }

    public getViewMatrix(): mat4 {
        const target = vec3.create();
        vec3.add(target, this.position, this.front);
        const view = mat4.create();
        mat4.lookAt(view, this.position, target, this.up);
        return view;
    }

    public getProjectionMatrix(): mat4 {
        const projection = mat4.create();
        if ((mat4 as any).perspectiveZO) {
             (mat4 as any).perspectiveZO(projection, toRadian(this.fov), this.aspect, this.near, this.far);
        } else {
            mat4.perspective(projection, toRadian(this.fov), this.aspect, this.near, this.far);
        }
        return projection;
    }

    public updateAspect(aspect: number) {
        this.aspect = aspect;
    }

    public processMouseMovement(xoffset: number, yoffset: number, constrainPitch: boolean = true) {
        const sensitivity = 0.1;
        xoffset *= sensitivity;
        yoffset *= sensitivity;

        this.yaw += xoffset;
        this.pitch += yoffset;

        if (constrainPitch) {
            if (this.pitch > 89.0) this.pitch = 89.0;
            if (this.pitch < -89.0) this.pitch = -89.0;
        }

        this.updateCameraVectors();
    }

    // New Update Method replacing processKeyboard
    public update(dt: number, input: InputHandler, physics: PhysicsEngine) {
        // Toggle Debug
        if (input.isKeyDown('Backquote')) {
            if (!this.debugToggleLatch) {
                this.isDebug = !this.isDebug;
                this.verticalVelocity = 0;
                vec3.set(this.walkVelocity, 0, 0, 0);
                vec3.set(this.impactVelocity, 0, 0, 0);
                this.debugToggleLatch = true;
                console.log("Debug Mode:", this.isDebug);
            }
        } else {
            this.debugToggleLatch = false;
        }

        if (this.isDebug) {
            this.updateDebug(dt, input);
        } else {
            this.updateWalk(dt, input, physics);
        }
    }

    private updateDebug(dt: number, input: InputHandler) {
        const speed = this.flySpeed * dt;
        const moveVec = vec3.create();

        // Right Click: Forward
        if (input.isMouseButtonDown(2)) {
            vec3.scale(moveVec, this.front, speed);
            vec3.add(this.position, this.position, moveVec);
        }
        // S: Backward
        if (input.isKeyDown('KeyS')) {
            vec3.scale(moveVec, this.front, speed);
            vec3.sub(this.position, this.position, moveVec);
        }
        // A: Left
        if (input.isKeyDown('KeyA')) {
            vec3.scale(moveVec, this.right, speed);
            vec3.sub(this.position, this.position, moveVec);
        }
        // D: Right
        if (input.isKeyDown('KeyD')) {
            vec3.scale(moveVec, this.right, speed);
            vec3.add(this.position, this.position, moveVec);
        }
        // W: Up
        if (input.isKeyDown('KeyW')) {
            this.position[1] += speed;
        }
        // Shift: Down
        if (input.isKeyDown('ShiftLeft')) {
            this.position[1] -= speed;
        }
    }

    private updateWalk(dt: number, input: InputHandler, physics: PhysicsEngine) {
        // 1. Calculate Input Direction (Horizontal)
        const inputDir = vec3.create();
        const flatFront = vec3.fromValues(this.front[0], 0, this.front[2]);
        vec3.normalize(flatFront, flatFront);
        const flatRight = vec3.fromValues(this.right[0], 0, this.right[2]);
        vec3.normalize(flatRight, flatRight);

        // Forward (Right Click)
        if (input.isMouseButtonDown(2)) {
            vec3.add(inputDir, inputDir, flatFront);
        }
        // Backward (S)
        if (input.isKeyDown('KeyS')) {
            vec3.sub(inputDir, inputDir, flatFront);
        }
        // Right (D)
        if (input.isKeyDown('KeyD')) {
            vec3.add(inputDir, inputDir, flatRight);
        }
        // Left (A)
        if (input.isKeyDown('KeyA')) {
            vec3.sub(inputDir, inputDir, flatRight);
        }

        if (vec3.length(inputDir) > 0) {
            vec3.normalize(inputDir, inputDir);
        }

        // 2. Dodge (Double Tap)
        const addDodge = (dir: vec3) => {
            const impulse = vec3.create();
            vec3.scale(impulse, dir, this.dodgeForce);
            vec3.add(this.impactVelocity, this.impactVelocity, impulse);
        };

        if (input.consumeDoubleTap('KeyA')) addDodge(vec3.fromValues(-flatRight[0], 0, -flatRight[2]));
        if (input.consumeDoubleTap('KeyD')) addDodge(flatRight);
        if (input.consumeDoubleTap('KeyS')) addDodge(vec3.fromValues(-flatFront[0], 0, -flatFront[2]));
        if (input.consumeDoubleTap('Mouse2')) addDodge(flatFront);


        // 3. Update Velocities

        // Impact Decay
        vec3.scale(this.impactVelocity, this.impactVelocity, this.impactDamping);

        // Walk Velocity
        if (this.isGrounded) {
             // Snappy Movement: Set directly
             vec3.scale(this.walkVelocity, inputDir, this.walkSpeed);

             // Jump
             if (input.isKeyDown('Space')) {
                 this.verticalVelocity = this.jumpForce;
                 this.isGrounded = false;
                 // Add small forward momentum if moving?
             }
        } else {
             // No Air Control: walkVelocity remains constant (momentum)
             // Should we apply drag? Maybe slight air drag.
             vec3.scale(this.walkVelocity, this.walkVelocity, 0.99);
        }

        // Gravity
        this.verticalVelocity -= this.gravity * dt;

        // 4. Integrate Position
        const totalVel = vec3.create();
        vec3.add(totalVel, this.walkVelocity, this.impactVelocity);

        const moveStep = vec3.create();
        vec3.scale(moveStep, totalVel, dt);

        // Apply Horizontal
        vec3.add(this.position, this.position, moveStep);

        // Apply Vertical
        this.position[1] += this.verticalVelocity * dt;

        // 5. Collision

        // Trees (Horizontal)
        // If we hit a tree, we should stop/slide.
        physics.resolveTreeCollisions(this.position);

        // Bounds
        physics.constrainToBounds(this.position);

        // Terrain (Vertical)
        const groundH = physics.getGroundHeight(this.position[0], this.position[2]);
        if (this.position[1] < groundH + this.eyeHeight) {
            this.position[1] = groundH + this.eyeHeight;
            this.verticalVelocity = 0;
            this.isGrounded = true;
        } else {
            this.isGrounded = false;
        }
    }

    private updateCameraVectors() {
        const front = vec3.create();
        front[0] = Math.cos(toRadian(this.yaw)) * Math.cos(toRadian(this.pitch));
        front[1] = Math.sin(toRadian(this.pitch));
        front[2] = Math.sin(toRadian(this.yaw)) * Math.cos(toRadian(this.pitch));
        vec3.normalize(this.front, front);

        vec3.cross(this.right, this.front, this.worldUp);
        vec3.normalize(this.right, this.right);

        vec3.cross(this.up, this.right, this.front);
        vec3.normalize(this.up, this.up);
    }
}
