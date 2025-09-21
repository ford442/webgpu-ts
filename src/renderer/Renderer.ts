export type RenderMode = 'liquid' | 'image' | 'video' | 'ripple' | 'liquid-v1' | 'shader' | 'colorFill';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();
    private sampler!: GPUSampler;
    private imageUrls: string[] = [];
    private ripplePoints: { x: number, y: number, startTime: number }[] = [];
    private MAX_RIPPLES = 50;
    private v2ComputeUniformBuffer!: GPUBuffer;
    private v1ComputeUniformBuffer!: GPUBuffer;
    private imageVideoUniformBuffer!: GPUBuffer;
    private galaxyUniformBuffer!: GPUBuffer;
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;

    private fillStateTextureA!: GPUTexture;
    private fillStateTextureB!: GPUTexture;
    private fillUniformBuffer!: GPUBuffer;
    private needsFillReset = false;
    private fillIterations = 0;
    // --- FIX #1: Increased the simulation steps for a larger fill area ---
    private readonly MAX_FILL_ITERATIONS = 256;


    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public addRipplePoint(x: number, y: number, mode: RenderMode) {
        const point = { x, y, startTime: performance.now() / 1000.0 };
        this.ripplePoints = [point]; 
        if (mode === 'colorFill') {
            this.needsFillReset = true; 
        }
    }

    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        this.device = await adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu')!;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: this.device, format: this.presentationFormat, alphaMode: 'premultiplied' });

        await this.fetchImageUrls();
        await this.createResources();
        await this.createPipelines();
        
        return true;
    }

    private async fetchImageUrls(): Promise<void> {
        const bucketName = 'my-sd35-space-images-2025';
        const apiUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}/o`;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`API error: ${response.status}`);
            const data = await response.json();
            this.imageUrls = data.items ? data.items.map((item: { name: string }) => `https://storage.googleapis.com/${bucketName}/${item.name}`) : [];
        } catch (e) {
            console.error("Failed to fetch image list:", e);
            this.imageUrls = ['https://i.imgur.com/vCNL2sT.jpeg'];
        }
    }

    public async loadRandomImage(): Promise<void> {
        try {
            if (this.imageUrls.length === 0) return;
            const imageUrl = this.imageUrls[Math.floor(Math.random() * this.imageUrls.length)];
            const response = await fetch(imageUrl);
            const imageBitmap = await createImageBitmap(await response.blob());

            // --- FIX #2: Resize the loaded image to match the canvas resolution ---
            const offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = this.canvas.width;
            offscreenCanvas.height = this.canvas.height;
            const ctx = offscreenCanvas.getContext('2d');
            if (ctx) {
                // This stretches the original image to fill our 2048x2048 simulation space
                ctx.drawImage(imageBitmap, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
            }
            const resizedBitmap = await createImageBitmap(offscreenCanvas);
            // --- End of resizing logic ---

            if (this.imageTexture) this.imageTexture.destroy();
            this.imageTexture = this.device.createTexture({
                size: [resizedBitmap.width, resizedBitmap.height], // Now guaranteed to be 2048x2048
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
            });
            // Copy the resized bitmap to the GPU texture
            this.device.queue.copyExternalImageToTexture({ source: resizedBitmap }, { texture: this.imageTexture }, [resizedBitmap.width, resizedBitmap.height]);

            if (this.pipelines.size > 0) {
                this.createBindGroups();
            }
        } catch (e) { console.error("Failed to load image:", e); }
    }

    // ... (the rest of the file remains the same) ...
    // Note: The `createResources` and other methods are correct as they are.
    // The `render` method's `colorFill` section is also correct as of the last update.
}
