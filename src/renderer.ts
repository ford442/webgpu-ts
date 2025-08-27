import galaxyShader from './shaders/galaxy.wgsl';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private pipeline!: GPURenderPipeline;
    private uniformBuffer!: GPUBuffer;
    private uniformBindGroup!: GPUBindGroup;
    private videoTexture!: GPUTexture;
    private sampler!: GPUSampler;

    private zoom: number = 1.0;
    private panX: number = 0.5;
    private panY: number = 0.5;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public async init(): Promise<void> {
        if (!navigator.gpu) {
            throw new Error("WebGPU not supported on this browser.");
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error("No appropriate GPUAdapter found.");
        }

        this.device = await adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: presentationFormat,
        });

        this.createResources();
        this.createPipeline();
    }

    private createResources(): void {
        // Uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            size: 3 * 4, // 3 floats (time, zoom, pan)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Sampler
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        // Video texture
        const video = document.getElementById('video') as HTMLVideoElement;
        this.videoTexture = this.device.createTexture({
            size: [video.videoWidth, video.videoHeight],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    private createPipeline(): void {
        const shaderModule = this.device.createShaderModule({ code: galaxyShader });

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'main',
                targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        this.uniformBindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: this.videoTexture.createView() },
            ],
        });
    }

    public setZoom(value: number): void {
        this.zoom = value;
    }

    public setPanX(value: number): void {
        this.panX = value;
    }

    public setPanY(value: number): void {
        this.panY = value;
    }

    public render(): void {
        const video = document.getElementById('video') as HTMLVideoElement;
        if (video.readyState >= 2) {
            this.device.queue.copyExternalImageToTexture(
                { source: video },
                { texture: this.videoTexture },
                [video.videoWidth, video.videoHeight]
            );
        }

        this.device.queue.writeBuffer(
            this.uniformBuffer,
            0,
            new Float32Array([performance.now() / 1000, this.zoom, this.panX, this.panY])
        );

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.uniformBindGroup);
        passEncoder.draw(6, 1, 0, 0);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }
}
