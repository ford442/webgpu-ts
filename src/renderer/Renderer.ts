// src/renderer/Renderer.ts

export type RenderMode = 'shader' | 'image' | 'video' | 'ripple' | 'liquid' | 'depth';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipelines = new Map<string, GPURenderPipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();
    private sampler!: GPUSampler;
    private imageTexture!: GPUTexture;
    private depthTexture!: GPUTexture;
    private parallaxUniformBuffer!: GPUBuffer;
    private mouseState = { x: 0.5, y: 0.5 };

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public updateMouse(x: number, y: number) { this.mouseState = { x, y }; }
    
    public updateDepthMap(data: Float32Array, width: number, height: number) {
        if (!this.device) return;
        if (!this.depthTexture || this.depthTexture.width !== width || this.depthTexture.height !== height) {
            if(this.depthTexture) this.depthTexture.destroy();
            this.depthTexture = this.device.createTexture({
                size: [width, height],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
        }
        this.device.queue.writeTexture(
            { texture: this.depthTexture },
            data,
            { bytesPerRow: width * 4 },
            [width, height]
        );
        this.createBindGroups();
    }

    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        this.device = await adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu')!;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        
        // --- THIS IS THE FIX for the WebGPU warning ---
        // Explicitly set the usage flags for the canvas's texture.
        this.context.configure({ 
            device: this.device, 
            format: this.presentationFormat, 
            alphaMode: 'premultiplied',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
        });

        await this.createResources();
        await this.createPipelines();
        // We now load the initial image from App.tsx to ensure the model runs first
        // await this.loadImage('https://i.imgur.com/vCNL2sT.jpeg'); 
        
        return true;
    }
    
    public async loadImage(imageUrl: string): Promise<void> {
        try {
            // Add a proxy to help with potential CORS issues
            const proxyUrl = 'https://corsproxy.io/?';
            const response = await fetch(proxyUrl + imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch image. Status: ${response.statusText}`);
            }
            const imageBitmap = await createImageBitmap(await response.blob());

            if (this.imageTexture) this.imageTexture.destroy();
            
            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba8unorm',
                // This texture is a source for sampling and a destination for the copy
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.imageTexture }, [imageBitmap.width, imageBitmap.height]);

            if (this.pipelines.size > 0) {
                this.createBindGroups();
            }
        } catch (e) { console.error("Failed to load image:", e); }
    }

    private async createResources(): Promise<void> {
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.parallaxUniformBuffer = this.device.createBuffer({
            size: 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    private async createPipelines(): Promise<void> {
        const parallaxCode = await fetch('shaders/parallax.wgsl').then(res => res.text());
        const parallaxModule = this.device.createShaderModule({ code: parallaxCode });

        this.pipelines.set('depth', this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: parallaxModule, entryPoint: 'vs_main' },
            fragment: {
                module: parallaxModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat }]
            },
            primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology }
        }));
    }

    private createBindGroups(): void {
        if (!this.imageTexture || !this.depthTexture) return;

        this.bindGroups.set('depth', this.device.createBindGroup({
            layout: this.pipelines.get('depth')!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.imageTexture.createView() },
                { binding: 2, resource: this.depthTexture.createView() },
                { binding: 3, resource: { buffer: this.parallaxUniformBuffer } },
            ]
        }));
    }

    public render(mode: RenderMode): void {
        if (!this.device || !this.context) return;

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{ view: textureView, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp, clearValue: { r: 0, g: 0, b: 0, a: 1 } }]
        };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        if (mode === 'depth' && this.bindGroups.has('depth')) {
            this.device.queue.writeBuffer(this.parallaxUniformBuffer, 0, new Float32Array([this.mouseState.x, this.mouseState.y]));
            passEncoder.setPipeline(this.pipelines.get('depth') as GPURenderPipeline);
            passEncoder.setBindGroup(0, this.bindGroups.get('depth')!);
            passEncoder.draw(4);
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
