export type RenderMode = 'shader' | 'image' | 'video' | 'ripple' | 'liquid-v1' | 'liquid';

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

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public addRipplePoint(x: number, y: number) {
        this.ripplePoints.push({ x, y, startTime: performance.now() / 1000.0 });
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
        if (this.imageTexture) {
            this.createBindGroups();
        }
        return true;
    }

    private async fetchImageUrls(): Promise<void> { /* ... (implementation is correct) ... */ }

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

            if (this.pipelines.size > 0) {
                this.createBindGroups();
            }
        } catch (e) { console.error("Failed to load image:", e); }
    }

    private async createResources(): Promise<void> {
        const { width, height } = this.canvas;
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.galaxyUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.imageVideoUniformBuffer = this.device.createBuffer({ size: 32 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v1ComputeUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v2ComputeUniformBuffer = this.device.createBuffer({ size: 16 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.writeTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> {
        const [galaxyCode, imageVideoCode, liquidV1Code, liquidCode, textureCode] = await Promise.all([
            fetch('shaders/galaxy.wgsl').then(res => res.text()),
            fetch('shaders/imageVideo.wgsl').then(res => res.text()),
            fetch('shaders/liquid-v1.wgsl').then(res => res.text()),
            fetch('shaders/liquid.wgsl').then(res => res.text()),
            fetch('shaders/texture.wgsl').then(res => res.text()),
        ]);

        const galaxyModule = this.device.createShaderModule({ code: galaxyCode });
        const imageVideoModule = this.device.createShaderModule({ code: imageVideoCode });
        const liquidV1Module = this.device.createShaderModule({ code: liquidV1Code });
        const liquidModule = this.device.createShaderModule({ code: liquidCode });
        const textureModule = this.device.createShaderModule({ code: textureCode });

        const commonConfig = { vertex: { module: imageVideoModule, entryPoint: 'vs_main' }, fragment: { targets: [{ format: this.presentationFormat }] }, primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology } };
        this.pipelines.set('galaxy', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, vertex: { module: galaxyModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: galaxyModule, entryPoint: 'fs_main' }, primitive: { topology: 'triangle-list' as GPUPrimitiveTopology } }));
        this.pipelines.set('imageVideo', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, fragment: { ...commonConfig.fragment, module: imageVideoModule, entryPoint: 'fs_main' } }));
        this.pipelines.set('liquid', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, vertex: { module: textureModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: textureModule, entryPoint: 'fs_main' } }));
        this.pipelines.set('computeV1', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidV1Module, entryPoint: 'main' } }));
        this.pipelines.set('compute', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidModule, entryPoint: 'main' } }));
    }

    private createBindGroups(): void {
        if (!this.imageTexture || !this.videoTexture) {
             if (this.videoTexture) return; // Wait for video to be ready if it exists
        }
 if (this.videoTexture) {
            this.bindGroups.set('galaxy', this.device.createBindGroup({ 
                layout: this.pipelines.get('galaxy')!.getBindGroupLayout(0), 
                entries: [
                    { binding: 0, resource: { buffer: this.galaxyUniformBuffer } }, 
                    { binding: 1, resource: this.sampler }, 
                    { binding: 2, resource: this.videoTexture.createView() }
                ] 
            }));
            this.bindGroups.set('video', this.device.createBindGroup({ 
                layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), 
                entries: [
                    { binding: 0, resource: this.sampler }, 
                    { binding: 1, resource: this.videoTexture.createView() }, 
                    { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }
                ] 
            }));
        }

        // These bind groups do not depend on the video, so they can always be created.
        this.bindGroups.set('image', this.device.createBindGroup({ 
            layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), 
            entries: [
                { binding: 0, resource: this.sampler }, 
                { binding: 1, resource: this.imageTexture.createView() }, 
                { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }
            ] 
        }));
        this.bindGroups.set('liquid', this.device.createBindGroup({ 
            layout: this.pipelines.get('liquid')!.getBindGroupLayout(0), 
            entries: [
                { binding: 0, resource: this.sampler }, 
                { binding: 1, resource: this.writeTexture.createView() }
            ] 
        }));
        this.bindGroups.set('computeV1', this.device.createBindGroup({ 
            layout: this.pipelines.get('computeV1')!.getBindGroupLayout(0), 
            entries: [
                { binding: 0, resource: this.sampler }, 
                { binding: 1, resource: this.imageTexture.createView() }, 
                { binding: 2, resource: this.writeTexture.createView() }, 
                { binding: 3, resource: { buffer: this.v1ComputeUniformBuffer } }
            ] 
        }));
        this.bindGroups.set('compute', this.device.createBindGroup({ 
            layout: this.pipelines.get('compute')!.getBindGroupLayout(0), 
            entries: [
                { binding: 0, resource: this.sampler }, 
                { binding: 1, resource: this.imageTexture.createView() }, 
                { binding: 2, resource: this.writeTexture.createView() }, 
                { binding: 3, resource: { buffer: this.v2ComputeUniformBuffer } }
            ] 
        }));
    }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
