export class InputHandler {
    public keys: { [key: string]: boolean } = {};
    public mouseButtons: { [key: number]: boolean } = {};
    public mouseDelta: { x: number, y: number } = { x: 0, y: 0 };
    public isPointerLocked: boolean = false;

    private lastPressTime: { [key: string]: number } = {};
    private doubleTaps: { [key: string]: boolean } = {};
    private doubleTapThreshold = 300; // ms

    private element: HTMLElement;
    private cleanupTasks: (() => void)[] = [];

    constructor(element: HTMLElement) {
        this.element = element;
        this.init();
    }

    private addListener(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
        target.addEventListener(type, listener);
        this.cleanupTasks.push(() => target.removeEventListener(type, listener));
    }

    private init() {
        // Prevent context menu
        const contextMenuListener = (e: Event) => {
            e.preventDefault();
            return false;
        };
        this.addListener(this.element, 'contextmenu', contextMenuListener);

        const keyDownListener = (e: Event) => {
            const ke = e as KeyboardEvent;
            if (!this.keys[ke.code]) {
                this.checkDoubleTap(ke.code);
            }
            this.keys[ke.code] = true;
        };
        this.addListener(window, 'keydown', keyDownListener);

        const keyUpListener = (e: Event) => {
             const ke = e as KeyboardEvent;
             this.keys[ke.code] = false;
        };
        this.addListener(window, 'keyup', keyUpListener);

        const mouseDownListener = (e: Event) => {
             const me = e as MouseEvent;
             if (me.target === this.element || this.isPointerLocked) {
                 this.mouseButtons[me.button] = true;
                 this.checkDoubleTap(`Mouse${me.button}`);
             }
             if (me.target === this.element && !this.isPointerLocked) {
                this.element.requestPointerLock();
            }
        };
        this.addListener(document, 'mousedown', mouseDownListener);

        const mouseUpListener = (e: Event) => {
            const me = e as MouseEvent;
            this.mouseButtons[me.button] = false;
        };
        this.addListener(document, 'mouseup', mouseUpListener);

        const pointerLockListener = () => {
            this.isPointerLocked = document.pointerLockElement === this.element;
        };
        this.addListener(document, 'pointerlockchange', pointerLockListener);

        const mouseMoveListener = (e: Event) => {
            const me = e as MouseEvent;
            if (this.isPointerLocked) {
                this.mouseDelta.x += me.movementX;
                this.mouseDelta.y -= me.movementY;
            }
        };
        this.addListener(document, 'mousemove', mouseMoveListener);
    }

    private checkDoubleTap(code: string) {
        const now = performance.now();
        const last = this.lastPressTime[code] || 0;

        if (now - last < this.doubleTapThreshold) {
            this.doubleTaps[code] = true;
            this.lastPressTime[code] = 0;
        } else {
            this.lastPressTime[code] = now;
        }
    }

    public getMouseDelta() {
        const delta = { ...this.mouseDelta };
        this.mouseDelta = { x: 0, y: 0 };
        return delta;
    }

    public isKeyDown(code: string): boolean {
        return !!this.keys[code];
    }

    public isMouseButtonDown(button: number): boolean {
        return !!this.mouseButtons[button];
    }

    public consumeDoubleTap(code: string): boolean {
        if (this.doubleTaps[code]) {
            this.doubleTaps[code] = false;
            return true;
        }
        return false;
    }

    public destroy() {
        this.cleanupTasks.forEach(task => task());
        this.cleanupTasks = [];
    }
}
