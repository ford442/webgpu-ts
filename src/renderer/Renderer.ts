export type RenderMode = 'shader' | 'image' | 'video' | 'ripple' | 'liquid-v1' | 'liquid' | 'liquid-v3';

export class Renderer {
    // Canvas & Device
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;

    // Pipelines
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();

    // Resources
    private sampler!: GPUSampler;
    private imageUrls: string[] = [];
    
    // v2 Resources
    private ripplePoints: { x: number, y: number, startTime: number }[] = [];
    private MAX_RIPPLES = 50;
    private v2ComputeUniformBuffer!: GPUBuffer;
    private v1ComputeUniformBuffer!: GPUBuffer;
    private imageVideoUniformBuffer!: GPUBuffer;
    private galaxyUniformBuffer!: GPUBuffer;

    // v3 Resources
    private v3MouseUniformBuffer!: GPUBuffer;
    private velocityRead!: GPUTexture;
    private velocityWrite!: GPUTexture;
    private colorRead!: GPUTexture;
    private colorWrite!: GPUTexture;

    // Shared Resources
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture; // Source image
    private writeTexture!: GPUTexture; // v2 output
    
    // Bind Groups
    private bindGroups = new Map<string, GPUBindGroup>();

    // Mouse State for v3
    private mouseState = { x: 0, y: 0, deltaX: 0, deltaY: 0, isDragging: false };

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public updateMouse(x: number, y: number, deltaX: number, deltaY: number, isDragging: boolean) {
        this.mouseState = { x, y, deltaX, deltaY, isDragging };
    }

    public addRipplePoint(x: number, y: number) { /* ... unchanged ... */ }

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
        await this.createBindGroups();
        
        return true;
    }

    private async fetchImageUrls(): Promise<void> { /* ... unchanged ... */ }
    
    public async loadRandomImage(): Promise<void> {
        try {
            if (this.imageUrls.length === 0) return;
            const imageUrl = this.imageUrls[Math.floor(Math.random() * this.imageUrls.length)];
            const response = await fetch(imageUrl);
            const imageBitmap = await createImageBitmap(await response.blob());

            if (this.imageTexture) this.imageTexture.destroy();
            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.imageTexture }, [imageBitmap.width, imageBitmap.height]);
            
            // Recreate bind groups that depend on the source image
            await this.createBindGroups();

        } catch (e) { console.error("Failed to load image:", e); }
    }

    private async createResources(): Promise<void> {
        const { width, height } = this.canvas;
        // Sampler
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        // v2 Buffers
        this.galaxyUniformBuffer = this.device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.imageVideoUniformBuffer = this.device.createBuffer({ size: (4 * 4) * 2 + (this.MAX_RIPPLES * 4 * 4), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v1ComputeUniformBuffer = this.device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v2ComputeUniformBuffer = this.device.createBuffer({ size: (4 * 4) + (this.MAX_RIPPLES * 4 * 4), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        
        // v2 Output Texture
        this.writeTexture = this.device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });

        // v3 Buffers
        this.v3MouseUniformBuffer = this.device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        // v3 State Textures (using float textures for precision)
        const floatTextureDesc: GPUTextureDescriptor = {
            size: [width, height],
            format: 'rgba16float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        };
        this.velocityRead = this.device.createTexture(floatTextureDesc);
        this.velocityWrite = this.device.createTexture(floatTextureDesc);
        this.colorRead = this.device.createTexture(floatTextureDesc);
        this.colorWrite = this.device.createTexture(floatTextureDesc);
        
        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> { /* ... (refactored to just create pipelines) ... */ }

    private async createBindGroups(): Promise<void> {
        if (!this.imageTexture) return;

        // v2 Bind Groups
        this.bindGroups.set('image', this.device.createBindGroup({ layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }] }));
        this.bindGroups.set('liquid', this.device.createBindGroup({ layout: this.pipelines.get('liquid')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.writeTexture.createView() }] }));
        this.bindGroups.set('computeV1', this.device.createBindGroup({ layout: this.pipelines.get('computeV1')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: this.writeTexture.createView() }, { binding: 3, resource: { buffer: this.v1ComputeUniformBuffer } }] }));
        this.bindGroups.set('computeV2', this.device.createBindGroup({ layout: this.pipelines.get('compute')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: this.writeTexture.createView() }, { binding: 3, resource: { buffer: this.v2ComputeUniformBuffer } }] }));
        
        // v3 Bind Groups
        this.bindGroups.set('velocityRead', this.device.createBindGroup({ layout: this.pipelines.get('velocity')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.velocityRead.createView() }, { binding: 2, resource: this.velocityWrite.createView() }, { binding: 3, resource: { buffer: this.v3MouseUniformBuffer } }] }));
        this.bindGroups.set('velocityWrite', this.device.createBindGroup({ layout: this.pipelines.get('velocity')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.velocityWrite.createView() }, { binding: 2, resource: this.velocityRead.createView() }, { binding: 3, resource: { buffer: this.v3MouseUniformBuffer } }] }));
        this.bindGroups.set('advectionRead', this.device.createBindGroup({ layout: this.pipelines.get('advection')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.velocityRead.createView() }, { binding: 2, resource: this.colorRead.createView() }, { binding: 3, resource: this.colorWrite.createView() }, { binding: 4, resource: this.imageTexture.createView() }] }));
        this.bindGroups.set('advectionWrite', this.device.createBindGroup({ layout: this.pipelines.get('advection')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.velocityWrite.createView() }, { binding: 2, resource: this.colorWrite.createView() }, { binding: 3, resource: this.colorRead.createView() }, { binding: 4, resource: this.imageTexture.createView() }] }));
        this.bindGroups.set('v3final', this.device.createBindGroup({ layout: this.pipelines.get('liquid')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.colorRead.createView() }] }));
    }

    public render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number): void {
        const { width, height } = this.canvas;
        const commandEncoder = this.device.createCommandEncoder();

        if (mode === 'liquid-v3') {
            // V3 Multi-pass simulation
            this.device.queue.writeBuffer(this.v3MouseUniformBuffer, 0, new Float32Array([this.mouseState.x, this.mouseState.y, this.mouseState.deltaX, this.mouseState.isDragging ? 1.0 : 0.0]));
            
            const computePass = commandEncoder.beginComputePass();
            // 1. Velocity pass
            computePass.setPipeline(this.pipelines.get('velocity') as GPUComputePipeline);
            computePass.setBindGroup(0, this.bindGroups.get('velocityRead')!);
            computePass.dispatchWorkgroups(width / 8, height / 8, 1);
            
            // 2. Advection pass
            computePass.setPipeline(this.pipelines.get('advection') as GPUComputePipeline);
            computePass.setBindGroup(0, this.bindGroups.get('advectionRead')!);
            computePass.dispatchWorkgroups(width / 8, height / 8, 1);
            computePass.end();

            // Ping-pong textures for next frame
            [this.velocityRead, this.velocityWrite] = [this.velocityWrite, this.velocityRead];
            [this.colorRead, this.colorWrite] = [this.colorWrite, this.colorRead];
            this.createBindGroups(); // Re-create bind groups with swapped textures
        } else if (mode.startsWith('liquid')) {
            // V1/V2 single-pass simulation
            /* ... unchanged ... */
        }
        
        // ... (rest of render function, render pass, and switch statement) ...
    }
}
