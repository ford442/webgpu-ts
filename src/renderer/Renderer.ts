import galaxyShader from './shaders/galaxy.wgsl';
import imageVideoShader from './shaders/imageVideo.wgsl';

export type RenderMode = 'shader' | 'image' | 'video';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;

    // Pipelines
    private galaxyPipeline!: GPURenderPipeline;
    private imageVideoPipeline!: GPURenderPipeline;

    // Resources
    private galaxyUniformBuffer!: GPUBuffer;
    private imageVideoUniformBuffer!: GPUBuffer; // New uniform buffer
    private sampler!: GPUSampler;
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture;
    
    // Bind Groups
    private galaxyBindGroup!: GPUBindGroup;
    private videoBindGroup!: GPUBindGroup;
    private imageBindGroup!: GPUBindGroup;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        this.device = await adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu')!;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied',
        });

        await this.createResources();
        await this.createPipelines();
        
        return true;
    }

    private async createResources(): Promise<void> {
        // Uniform Buffers
        this.galaxyUniformBuffer = this.device.createBuffer({
            size: 4 * 4, // 4 floats: time, zoom, panX, panY
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.imageVideoUniformBuffer = this.device.createBuffer({
            size: 4 * 4, // 4 floats: canvas.width, canvas.height, source.width, source.height
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Sampler
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });
        
        const imageUrl = 'https://i.imgur.com/vCNL2sT.jpeg';
        const response = await fetch(imageUrl, { mode: 'cors' });
        const imageBitmap = await createImageBitmap(await response.blob());
        
        this.imageTexture = this.device.createTexture({
            size: [imageBitmap.width, imageBitmap.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture: this.imageTexture },
            [imageBitmap.width, imageBitmap.height]
        );
    }

    private async createPipelines(): Promise<void> {
        const galaxyShaderCode = await (await fetch('shaders/galaxy.wgsl')).text();
        const imageVideoShaderCode = await (await fetch('shaders/imageVideo.wgsl')).text();

        const galaxyShaderModule = this.device.createShaderModule({ code: galaxyShaderCode });
        const imageVideoShaderModule = this.device.createShaderModule({ code: imageVideoShaderCode });
        
        const vertexEntryPoint = 'vs_main';
        const fragmentEntryPoint = 'fs_main';

        this.galaxyPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: galaxyShaderModule, entryPoint: vertexEntryPoint },
            fragment: {
                module: galaxyShaderModule,
                entryPoint: fragmentEntryPoint,
                targets: [{ format: this.presentationFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });

        this.imageVideoPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: imageVideoShaderModule, entryPoint: vertexEntryPoint },
            fragment: {
                module: imageVideoShaderModule,
                entryPoint: fragmentEntryPoint,
                targets: [{ format: this.presentationFormat }],
            },
            primitive: { topology: 'triangle-strip' },
        });

        this.imageBindGroup = this.device.createBindGroup({
            layout: this.imageVideoPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.imageTexture.createView() },
                { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } },
            ],
        });
    }

    public render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number): void {
        if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
             if (!this.videoTexture || this.videoTexture.width !== videoElement.videoWidth || this.videoTexture.height !== videoElement.videoHeight) {
                if (this.videoTexture) this.videoTexture.destroy();
                this.videoTexture = this.device.createTexture({
                    size: [videoElement.videoWidth, videoElement.videoHeight],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
                });
                this.videoBindGroup = this.device.createBindGroup({
                    layout: this.imageVideoPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: this.sampler },
                        { binding: 1, resource: this.videoTexture.createView() },
                        { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } },
                    ],
                });
                this.galaxyBindGroup = this.device.createBindGroup({
                    layout: this.galaxyPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: this.galaxyUniformBuffer } },
                        { binding: 1, resource: this.sampler },
                        { binding: 2, resource: this.videoTexture.createView() },
                    ],
                });
             }
            this.device.queue.copyExternalImageToTexture(
                { source: videoElement },
                { texture: this.videoTexture },
                [videoElement.videoWidth, videoElement.videoHeight]
            );
        }

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        switch (mode) {
            case 'shader':
                this.device.queue.writeBuffer(this.galaxyUniformBuffer, 0, new Float32Array([performance.now() / 1000.0, zoom, panX, panY]));
                if (this.galaxyPipeline && this.galaxyBindGroup) {
                    passEncoder.setPipeline(this.galaxyPipeline);
                    passEncoder.setBindGroup(0, this.galaxyBindGroup);
                    passEncoder.draw(6);
                }
                break;
            case 'image':
                this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, new Float32Array([this.canvas.width, this.canvas.height, this.imageTexture.width, this.imageTexture.height]));
                if (this.imageVideoPipeline && this.imageBindGroup) {
                    passEncoder.setPipeline(this.imageVideoPipeline);
                    passEncoder.setBindGroup(0, this.imageBindGroup);
                    passEncoder.draw(4);
                }
                break;
            case 'video':
                if (this.videoTexture) {
                    this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, new Float32Array([this.canvas.width, this.canvas.height, this.videoTexture.width, this.videoTexture.height]));
                    if (this.imageVideoPipeline && this.videoBindGroup) {
                        passEncoder.setPipeline(this.imageVideoPipeline);
                        passEncoder.setBindGroup(0, this.videoBindGroup);
                        passEncoder.draw(4);
                    }
                }
                break;
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
