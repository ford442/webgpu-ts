import { RenderMode } from './types';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();
    private sampler!: GPUSampler;
    private nonFilteringSampler!: GPUSampler;
    private imageUrls: string[] = [];
    private uniformBuffer!: GPUBuffer;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;
    private staticDepthTexture!: GPUTexture;
    public imageDimensions = { width: 1, height: 1 };
    private maxTextureSize = 8192; // A safe default

    private isDeviceLost = false;

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

public async init(): Promise<boolean> {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;

    // --- NEW: Check if the 'float32-filterable' feature is available ---
    const requiredFeatures: GPUFeatureName[] = [];
    if (adapter.features.has('float32-filterable')) {
        requiredFeatures.push('float32-filterable');
    }
    
    // --- MODIFIED: Request the feature when creating the device ---
    this.device = await adapter.requestDevice({
        requiredFeatures, // Pass the requested features here
        requiredLimits: {
            maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
        },
    });

    this.device.lost.then((info) => {
        console.error(`WebGPU device was lost: ${info.message}`);
        this.isDeviceLost = true;
    });

    this.context = this.canvas.getContext('webgpu')!;
    this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.presentationFormat, alphaMode: 'premultiplied' });
    
    await this.fetchImageUrls();
    await this.createResources();
    await this.createPipelines();
    return true;
}

    private async createResources(): Promise<void> {
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nonFilteringSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
        this.uniformBuffer = this.device.createBuffer({
            size: 96, // Matches the uniform buffer size in the shader
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.staticDepthTexture = this.device.createTexture({
            size: [1, 1], format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        this.device.queue.writeTexture({texture: this.staticDepthTexture}, new Float32Array([0.0]), {bytesPerRow: 4}, [1,1]);

        this.writeTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height], format: 'rgba16float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        await this.loadRandomImage();
    }
    
    private async createPipelines(): Promise<void> {
        const [zoomCode, textureCode] = await Promise.all([
            fetch('shaders/3d-zoom.wgsl').then(r => r.text()),
            fetch('shaders/texture.wgsl').then(r => r.text()),
        ]);

        const zoomModule = this.device.createShaderModule({ code: zoomCode });
        const textureModule = this.device.createShaderModule({ code: textureCode });

        this.pipelines.set('present', this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: textureModule, entryPoint: 'vs_main' },
            fragment: { module: textureModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
            primitive: { topology: 'triangle-strip' }
        }));
        
        this.pipelines.set('computeZoom', this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: zoomModule, entryPoint: 'main' }
        }));
    }

    public createBindGroups(): void {
        if (!this.imageTexture || !this.staticDepthTexture) return;
        
        const computeZoomPipeline = this.pipelines.get('computeZoom') as GPUComputePipeline;
        this.bindGroups.set('computeZoom', this.device.createBindGroup({
            layout: computeZoomPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.imageTexture.createView() },
                { binding: 2, resource: this.writeTexture.createView() },
                { binding: 3, resource: { buffer: this.uniformBuffer } },
                { binding: 4, resource: this.nonFilteringSampler },
                { binding: 5, resource: this.staticDepthTexture.createView() }
            ]
        }));
        
        const presentPipeline = this.pipelines.get('present') as GPURenderPipeline;
        this.bindGroups.set('present', this.device.createBindGroup({
            layout: presentPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.writeTexture.createView() }
            ]
        }));
    }
    
    public updateDepthMap(data: Float32Array, width: number, height: number): void {
        if (!this.device || this.isDeviceLost) return;
        this.staticDepthTexture?.destroy();
        this.staticDepthTexture = this.device.createTexture({
            size: [width, height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });
        this.device.queue.writeTexture(
            { texture: this.staticDepthTexture },
            data,
            { bytesPerRow: width * 4, rowsPerImage: height },
            [width, height]
        );
        this.createBindGroups();
    }

    public getImageDimensions = () => this.imageDimensions;
    
    private async fetchImageUrls(): Promise<void> {
        // This is a simplified version for stability
        this.imageUrls = ['https://i.imgur.com/vCNL2sT.jpeg'];
    }
    
   public handleResize(): void {
    if (!this.device || this.isDeviceLost || !this.canvas.parentElement) return;

    let newWidth = this.canvas.parentElement.clientWidth;
    let newHeight = this.canvas.parentElement.clientHeight;
    
    // --- NEW: Add a safeguard to clamp the size to the max limit ---
    newWidth = Math.min(newWidth, this.maxTextureSize);
    newHeight = Math.min(newHeight, this.maxTextureSize);
    
    if (newWidth === 0 || newHeight === 0) return;
    
    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        this.context.configure({ device: this.device, format: this.presentationFormat, alphaMode: 'premultiplied' });

        this.writeTexture?.destroy();
        this.writeTexture = this.device.createTexture({
            size: [newWidth, newHeight],
            format: 'rgba16float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.createBindGroups();
    }
}
    
    public async loadRandomImage(): Promise<string | undefined> {
        try {
            const imageUrl = this.imageUrls[0]; // Always load the same image for now
            const response = await fetch(imageUrl, { mode: 'cors' });
            const imageBitmap = await createImageBitmap(await response.blob());
            this.imageDimensions = { width: imageBitmap.width, height: imageBitmap.height };

            this.imageTexture?.destroy();
            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba8unorm', // Use a standard format
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            this.device.queue.copyExternalImageToTexture(
                { source: imageBitmap },
                { texture: this.imageTexture },
                [imageBitmap.width, imageBitmap.height]
            );

            this.createBindGroups();
            return imageUrl;
        } catch (e) {
            console.error("Failed to load image:", e);
            return undefined;
        }
    }
    
    public render(
        mode: RenderMode,
        farthestPoint: { x: number, y: number },
        imageDimensions: {width: number, height: number},
        depthDimensions: {width: number, height: number},
        parallaxStrength: number
    ): void {
        if (this.isDeviceLost) return;

        let textureView: GPUTextureView;
        try {
            textureView = this.context.getCurrentTexture().createView();
        } catch (e) {
            console.error("Could not get texture from context. Device may be lost.", e);
            // This is a strong indicator of device loss, so we'll set the flag and stop.
            this.isDeviceLost = true;
            return;
        }

        const commandEncoder = this.device.createCommandEncoder();
        
        // Compute Pass
        const computePass = commandEncoder.beginComputePass();
        const bg = this.bindGroups.get('computeZoom');
        if (bg) {
            const uniforms = new Float32Array(24);
            uniforms.set([this.canvas.width, this.canvas.height, imageDimensions.width, imageDimensions.height], 0);
            uniforms.set([performance.now()/1000.0, farthestPoint.x, farthestPoint.y, 0], 4);
            uniforms.set([depthDimensions.width, depthDimensions.height], 12);
            uniforms.set([imageDimensions.width, imageDimensions.height], 16);
            uniforms.set([parallaxStrength, 0.5, 0.5, 5], 20); // Using some default values
            this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
            
            computePass.setPipeline(this.pipelines.get('computeZoom') as GPUComputePipeline);
            computePass.setBindGroup(0, bg);
            computePass.dispatchWorkgroups(Math.ceil(this.canvas.width / 8), Math.ceil(this.canvas.height / 8), 1);
        }
        computePass.end();

        // Render Pass
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{ view: textureView, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp, clearValue: [0,0,0,1] }]
        });
        const presentBG = this.bindGroups.get('present');
        if (presentBG) {
            passEncoder.setPipeline(this.pipelines.get('present') as GPURenderPipeline);
            passEncoder.setBindGroup(0, presentBG);
            passEncoder.draw(4);
        }
        passEncoder.end();
        
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
