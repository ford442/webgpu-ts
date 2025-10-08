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
    private v2ComputeUniformBuffer!: GPUBuffer;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;

    // --- REMOVED: depthTextureRead and depthTextureWrite ---
    private staticDepthTexture!: GPUTexture;

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

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

    private async fetchImageUrls(): Promise<void> { /* ... (no change) ... */ }
    public async loadRandomImage(): Promise<string | undefined> { /* ... (no change) ... */ }

    public updateDepthMap(data: Float32Array, width: number, height: number): void {
        if (!this.device) return;
        if (this.staticDepthTexture) this.staticDepthTexture.destroy();

        const depthTextureDescriptor: GPUTextureDescriptor = {
            size: [width, height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        };
        this.staticDepthTexture = this.device.createTexture(depthTextureDescriptor);
        this.device.queue.writeTexture({ texture: this.staticDepthTexture }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
        this.createBindGroups();
    }

    private async createResources(): Promise<void> {
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nonFilteringSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
        this.v2ComputeUniformBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        const placeholderDepthDescriptor: GPUTextureDescriptor = {
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        };
        this.staticDepthTexture = this.device.createTexture(placeholderDepthDescriptor);
        this.device.queue.writeTexture({ texture: this.staticDepthTexture }, new Float32Array([0.0]), { bytesPerRow: 4 }, [1, 1]);

        this.writeTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'rgba16float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> { /* ... (no change) ... */ }

    private createBindGroups(): void {
        if (!this.imageTexture || !this.staticDepthTexture) return;

        this.bindGroups.set('present', this.device.createBindGroup({ layout: this.pipelines.get('present')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.writeTexture.createView() }] }));

        const computeZoomPipeline = this.pipelines.get('computeZoom');
        if (computeZoomPipeline) {
            this.bindGroups.set('computeZoom', this.device.createBindGroup({
                layout: computeZoomPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: this.imageTexture.createView() },
                    { binding: 2, resource: this.writeTexture.createView() },
                    { binding: 3, resource: { buffer: this.v2ComputeUniformBuffer } },
                    { binding: 4, resource: this.nonFilteringSampler },
                    { binding: 5, resource: this.staticDepthTexture.createView() },
                ]
            }));
        }
    }

    // --- REMOVED: swapDepthTextures() function ---

    public render(mode: RenderMode, zoom: number, panX: number, panY: number, farthestPoint: { x: number, y: number }, depthThreshold: number): void {
        if (!this.device || !this.imageTexture) return;
        const currentTime = performance.now() / 1000.0;
        const commandEncoder = this.device.createCommandEncoder();

        if (mode === '3d-zoom') {
            const computePass = commandEncoder.beginComputePass();
            const computeZoomBG = this.bindGroups.get('computeZoom');
            if (computeZoomBG) {
                const uniformArray = new Float32Array(8);
                uniformArray.set([currentTime, 0, this.canvas.width, this.canvas.height], 0);
                uniformArray.set([currentTime, farthestPoint.x, farthestPoint.y, depthThreshold], 4);
                this.device.queue.writeBuffer(this.v2ComputeUniformBuffer, 0, uniformArray);
                computePass.setPipeline(this.pipelines.get('computeZoom') as GPUComputePipeline);
                computePass.setBindGroup(0, computeZoomBG);
                computePass.dispatchWorkgroups(this.canvas.width / 8, this.canvas.height / 8, 1);
            }
            computePass.end();
            // --- REMOVED: swapDepthTextures() call ---
        }

        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: textureView, clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, loadOp: 'clear', storeOp: 'store' }] };
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