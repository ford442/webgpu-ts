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
    
    private zoomUniformBuffer!: GPUBuffer;
    private liquidUniformBuffer!: GPUBuffer;
    
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;
    private staticDepthTexture!: GPUTexture;
    public imageDimensions = { width: 1, height: 1 };
    
    private currentImageUrl: string | undefined;
    
    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }
    
    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        const requiredFeatures: GPUFeatureName[] = [];
        if (adapter.features.has('float32-filterable')) {
            requiredFeatures.push('float32-filterable');
        }
        this.device = await adapter.requestDevice({ requiredFeatures });
        this.context = this.canvas.getContext('webgpu')!;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: this.device, format: this.presentationFormat, alphaMode: 'premultiplied' });
        await this.fetchImageUrls();
        await this.createPipelines();
        await this.createResources();
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

    public async loadRandomImage(): Promise<string | undefined> {
        try {
            if (this.imageUrls.length === 0) return;
            const imageUrl = this.imageUrls[Math.floor(Math.random() * this.imageUrls.length)];
            this.currentImageUrl = imageUrl;
            const response = await fetch(imageUrl);
            const imageBitmap = await createImageBitmap(await response.blob());
            this.imageDimensions = { width: imageBitmap.width, height: imageBitmap.height };
            if (this.imageTexture) this.imageTexture.destroy();
            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba16float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.imageTexture }, [imageBitmap.width, imageBitmap.height]);
            this.createBindGroups();
            return imageUrl;
        } catch (e) {
            console.error("Failed to load image:", e);
            return undefined;
        }
    }

    public getCurrentImageUrl(): string | undefined {
        return this.currentImageUrl;
    }

    public handleResize(): void {
        if (!this.device) return;
        const newCanvasWidth = 1280;
        const newCanvasHeight = 1280;
        if (this.canvas.width !== newCanvasWidth || this.canvas.height !== newCanvasHeight) {
            this.canvas.width = newCanvasWidth;
            this.canvas.height = newCanvasHeight;
            if (this.writeTexture) this.writeTexture.destroy();
            this.writeTexture = this.device.createTexture({
                size: [newCanvasWidth, newCanvasHeight],
                format: 'rgba16float',
                usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            this.createBindGroups();
        }
    }
    
    public updateDepthMap(data: Float32Array, width: number, height: number): void {
        if (!this.device) return;
        if (this.staticDepthTexture) this.staticDepthTexture.destroy();
        this.staticDepthTexture = this.device.createTexture({
            size: [width, height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        this.device.queue.writeTexture({ texture: this.staticDepthTexture }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
        this.createBindGroups();
    }

    private async createResources(): Promise<void> {
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nonFilteringSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
        
        this.zoomUniformBuffer = this.device.createBuffer({
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
        });

        this.liquidUniformBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.staticDepthTexture = this.device.createTexture({
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        
        this.writeTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'rgba16float',
            // --- THIS IS THE FIX ---
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        
        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> {
        const [zoomCode, liquidCode, textureCode] = await Promise.all([
            fetch('shaders/3d-zoom.wgsl').then(res => res.text()),
            fetch('shaders/liquid-ambient.wgsl').then(res => res.text()),
            fetch('shaders/texture.wgsl').then(res => res.text()),
        ]);

        const zoomModule = this.device.createShaderModule({ code: zoomCode });
        const liquidModule = this.device.createShaderModule({ code: liquidCode });
        const textureModule = this.device.createShaderModule({ code: textureCode });
        
        this.pipelines.set('present', this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: textureModule, entryPoint: 'vs_main' },
            fragment: { targets: [{ format: this.presentationFormat }], module: textureModule, entryPoint: 'fs_main' },
        }));

        this.pipelines.set('computeZoom', this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: zoomModule, entryPoint: 'main' }
        }));

        this.pipelines.set('computeLiquid', this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: liquidModule, entryPoint: 'main' }
        }));
    }

    private createBindGroups(): void {
        if (!this.imageTexture || !this.staticDepthTexture || !this.writeTexture) return;

        this.bindGroups.set('present', this.device.createBindGroup({
            layout: this.pipelines.get('present')!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.writeTexture.createView() }
            ]
        }));
        
        this.bindGroups.set('computeZoom', this.device.createBindGroup({
            layout: this.pipelines.get('computeZoom')!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.imageTexture.createView() },
                { binding: 2, resource: this.writeTexture.createView() },
                { binding: 3, resource: { buffer: this.zoomUniformBuffer } },
                { binding: 4, resource: this.nonFilteringSampler },
                { binding: 5, resource: this.staticDepthTexture.createView() },
            ]
        }));

        this.bindGroups.set('computeLiquid', this.device.createBindGroup({
            layout: this.pipelines.get('computeLiquid')!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.imageTexture.createView() },
                { binding: 2, resource: this.writeTexture.createView() },
                { binding: 3, resource: { buffer: this.liquidUniformBuffer } },
                { binding: 4, resource: this.staticDepthTexture.createView() },
                { binding: 5, resource: this.nonFilteringSampler },
            ]
        }));
    }

    public getImageDimensions(): { width: number, height: number } {
        return this.imageDimensions;
    }

    public render(
        mode: RenderMode,
        params: {
            farthestPoint: { x: number, y: number };
            imageDimensions: { width: number; height: number };
            depthDimensions: { width: number; height: number };
            parallaxStrength: number;
        }
    ): void {
        if (!this.device || !this.imageTexture) return;

        const currentTime = performance.now() / 1000.0;
        const commandEncoder = this.device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();

        if (mode === '3d-zoom') {
            const computeZoomBG = this.bindGroups.get('computeZoom');
            const pipeline = this.pipelines.get('computeZoom') as GPUComputePipeline;
            if (computeZoomBG && pipeline) {
                const uniforms = new Float32Array(24); 
                uniforms.set([this.canvas.width, this.canvas.height, params.imageDimensions.width, params.imageDimensions.height], 0);
                uniforms.set([currentTime, params.farthestPoint.x, params.farthestPoint.y], 4);
                uniforms.set([0.1, 0.1, 0.15, 4.0], 8); // Example fog
                uniforms.set([params.depthDimensions.width, params.depthDimensions.height], 12);
                uniforms.set([params.imageDimensions.width, params.imageDimensions.height], 16);
                uniforms.set([params.parallaxStrength], 20);
                this.device.queue.writeBuffer(this.zoomUniformBuffer, 0, uniforms);
                
                computePass.setPipeline(pipeline);
                computePass.setBindGroup(0, computeZoomBG);
            }
        } else if (mode === 'ambient-liquid') {
            const computeLiquidBG = this.bindGroups.get('computeLiquid');
            const pipeline = this.pipelines.get('computeLiquid') as GPUComputePipeline;
            if (computeLiquidBG && pipeline) {
                const uniforms = new Float32Array([currentTime, this.canvas.width, this.canvas.height]);
                this.device.queue.writeBuffer(this.liquidUniformBuffer, 0, uniforms);

                computePass.setPipeline(pipeline);
                computePass.setBindGroup(0, computeLiquidBG);
            }
        }
        
        if (this.canvas.width > 0 && this.canvas.height > 0) {
            computePass.dispatchWorkgroups(Math.ceil(this.canvas.width / 8), Math.ceil(this.canvas.height / 8), 1);
        }
        computePass.end();

        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            }]
        };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        const presentPipeline = this.pipelines.get('present') as GPURenderPipeline;
        if (presentPipeline && this.bindGroups.has('present')) {
            passEncoder.setPipeline(presentPipeline);
            passEncoder.setBindGroup(0, this.bindGroups.get('present')!);
            passEncoder.draw(4);
        }
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
