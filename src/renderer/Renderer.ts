export type RenderMode = 'shader' | 'image' | 'video' | 'ripple' | 'liquid' | 'liquid-v3';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();
    private sampler!: GPUSampler;
    private imageUrls: string[] = [];
    private v3MouseUniformBuffer!: GPUBuffer;
    private velocityRead!: GPUTexture;
    private velocityWrite!: GPUTexture;
    private colorRead!: GPUTexture;
    private colorWrite!: GPUTexture;
    private imageTexture!: GPUTexture;
    private mouseState = { x: 0, y: 0, deltaX: 0, deltaY: 0, isDragging: false };
    private frameCount = 0;

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }
    public updateMouse(x: number, y: number, deltaX: number, deltaY: number, isDragging: boolean) { this.mouseState = { x, y, deltaX, deltaY, isDragging }; }
    public addRipplePoint(x: number, y: number) { /* No-op for v3 */ }

    public async init(): Promise<boolean> {
        // ... (init function from previous step is correct)
    }

    private async fetchImageUrls(): Promise<void> { /* ... (implementation is correct) ... */ }
    
    public async loadRandomImage(): Promise<void> {
        // ... (implementation from previous step is correct)
    }

    private async createResources(): Promise<void> {
        const { width, height } = this.canvas;
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.v3MouseUniformBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        const floatTextureDesc: GPUTextureDescriptor = { 
            size: [width, height], 
            format: 'rgba16float', 
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        };
        this.velocityRead = this.device.createTexture(floatTextureDesc);
        this.velocityWrite = this.device.createTexture(floatTextureDesc);
        this.colorRead = this.device.createTexture(floatTextureDesc);
        this.colorWrite = this.device.createTexture(floatTextureDesc);
        await this.loadRandomImage();
    }
    
    private _initializeV3State() {
        // ... (implementation from previous step is correct)
    }

    private async createPipelines(): Promise<void> {
        const [textureCode, velocityCode, advectionCode] = await Promise.all([
            fetch('shaders/texture.wgsl').then(res => res.text()),
            fetch('shaders/velocity.wgsl').then(res => res.text()),
            fetch('shaders/advection.wgsl').then(res => res.text()),
        ]);

        const textureModule = this.device.createShaderModule({ code: textureCode });
        const velocityModule = this.device.createShaderModule({ code: velocityCode });
        const advectionModule = this.device.createShaderModule({ code: advectionCode });

        this.pipelines.set('finalRender', this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: textureModule, entryPoint: 'vs_main' },
            fragment: { module: textureModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
        }));
        
        this.pipelines.set('texture', this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: textureModule, entryPoint: 'vs_main' },
            fragment: { module: textureModule, entryPoint: 'fs_main', targets: [{ format: 'rgba16float' as GPUTextureFormat }] },
        }));

        this.pipelines.set('velocity', this.device.createComputePipeline({ layout: 'auto', compute: { module: velocityModule, entryPoint: 'main' } }));
        this.pipelines.set('advection', this.device.createComputePipeline({ layout: 'auto', compute: { module: advectionModule, entryPoint: 'main' } }));
    }

    private createBindGroups(): void {
        if (!this.imageTexture) return;
        
        const velRead = this.frameCount % 2 === 0 ? this.velocityRead : this.velocityWrite;
        const velWrite = this.frameCount % 2 === 0 ? this.velocityWrite : this.velocityRead;
        const colRead = this.frameCount % 2 === 0 ? this.colorRead : this.colorWrite;
        const colWrite = this.frameCount % 2 === 0 ? this.colorWrite : this.colorRead;

        this.bindGroups.set('velocity', this.device.createBindGroup({ layout: this.pipelines.get('velocity')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: velRead.createView() }, { binding: 2, resource: velWrite.createView() }, { binding: 3, resource: { buffer: this.v3MouseUniformBuffer } }] }));
        this.bindGroups.set('advection', this.device.createBindGroup({ layout: this.pipelines.get('advection')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: velWrite.createView() }, { binding: 2, resource: colRead.createView() }, { binding: 3, resource: colWrite.createView() }, { binding: 4, resource: this.imageTexture.createView() }] }));
        this.bindGroups.set('finalRender', this.device.createBindGroup({ layout: this.pipelines.get('finalRender')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: colWrite.createView() }] }));
    }

    public render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number): void {
        if (mode !== 'liquid-v3') {
            // Draw black for other modes
            // ... (implementation is correct)
            return;
        }

        const { width, height } = this.canvas;
        const commandEncoder = this.device.createCommandEncoder();

        const mouseData = new Float32Array(8);
        mouseData.set([this.mouseState.x, this.mouseState.y, this.mouseState.isDragging ? 1.0 : 0.0], 0);
        mouseData.set([this.mouseState.deltaX, this.mouseState.deltaY], 4);
        this.device.queue.writeBuffer(this.v3MouseUniformBuffer, 0, mouseData);
        
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.pipelines.get('velocity') as GPUComputePipeline);
        computePass.setBindGroup(0, this.bindGroups.get('velocity')!);
        computePass.dispatchWorkgroups(width / 8, height / 8, 1);
        
        computePass.setPipeline(this.pipelines.get('advection') as GPUComputePipeline);
        computePass.setBindGroup(0, this.bindGroups.get('advection')!);
        computePass.dispatchWorkgroups(width / 8, height / 8, 1);
        computePass.end();

        const textureView = this.context.getCurrentTexture().createView();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{ view: textureView, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp, clearValue: {r:0,g:0,b:0,a:1}}]
        });
        passEncoder.setPipeline(this.pipelines.get('finalRender') as GPURenderPipeline);
        passEncoder.setBindGroup(0, this.bindGroups.get('finalRender')!);
        passEncoder.draw(4);
        passEncoder.end();
        
        this.device.queue.submit([commandEncoder.finish()]);

        this.frameCount++;
        this.createBindGroups();
    }
}
