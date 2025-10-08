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

    private depthTextureRead!: GPUTexture;
    private depthTextureWrite!: GPUTexture;
    // --- 1. Add the new texture property ---
    private staticDepthTexture!: GPUTexture;

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public async init(): Promise<boolean> {
        // ... (this function remains the same)
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        const requiredFeatures: GPUFeatureName[] = [];
        if (adapter.features.has('float32-filterable')) {
            requiredFeatures.push('float32-filterable');
        }
        this.device = await adapter.requestDevice({
            requiredFeatures,
        });
        this.context = this.canvas.getContext('webgpu')!;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: this.device, format: this.presentationFormat, alphaMode: 'premultiplied' });

        await this.fetchImageUrls();
        await this.createResources();
        await this.createPipelines();

        return true;
    }

    private async fetchImageUrls(): Promise<void> {
        // ... (this function remains the same)
    }

    public async loadRandomImage(): Promise<string | undefined> {
        // ... (this function remains the same)
    }

    public updateDepthMap(data: Float32Array, width: number, height: number): void {
        if (!this.device) return;

        // --- 2. Make sure to destroy/recreate the static texture with the others ---
        if (this.depthTextureRead && (this.depthTextureRead.width !== width || this.depthTextureRead.height !== height)) {
            this.depthTextureRead.destroy();
            this.depthTextureWrite.destroy();
            this.staticDepthTexture.destroy();
        }

        if (!this.depthTextureRead || this.depthTextureRead.width !== width || this.depthTextureRead.height !== height) {
            const depthTextureDescriptor: GPUTextureDescriptor = {
                size: [width, height],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
            };
            this.depthTextureRead = this.device.createTexture(depthTextureDescriptor);
            this.depthTextureWrite = this.device.createTexture(depthTextureDescriptor);
            this.staticDepthTexture = this.device.createTexture(depthTextureDescriptor);
        }

        // --- 3. Write the initial depth data to all three textures ---
        this.device.queue.writeTexture({ texture: this.depthTextureRead }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
        this.device.queue.writeTexture({ texture: this.depthTextureWrite }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
        this.device.queue.writeTexture({ texture: this.staticDepthTexture }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);

        this.createBindGroups();
    }

    private async createResources(): Promise<void> {
        // ... (sampler, buffer, writeTexture are the same)
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nonFilteringSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
        this.v2ComputeUniformBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        // --- 4. Create a placeholder for the static texture on init ---
        const placeholderDepthDescriptor: GPUTextureDescriptor = {
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
        };
        this.depthTextureRead = this.device.createTexture(placeholderDepthDescriptor);
        this.depthTextureWrite = this.device.createTexture(placeholderDepthDescriptor);
        this.staticDepthTexture = this.device.createTexture(placeholderDepthDescriptor);

        const placeholderData = new Float32Array([0.0]);
        this.device.queue.writeTexture({ texture: this.depthTextureRead }, placeholderData, { bytesPerRow: 4 }, [1, 1]);
        this.device.queue.writeTexture({ texture: this.depthTextureWrite }, placeholderData, { bytesPerRow: 4 }, [1, 1]);
        this.device.queue.writeTexture({ texture: this.staticDepthTexture }, placeholderData, { bytesPerRow: 4 }, [1, 1]);

        this.writeTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'rgba16float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });

        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> {
        // ... (this function remains the same)
    }

    private createBindGroups(): void {
        if (!this.imageTexture || !this.nonFilteringSampler || !this.depthTextureRead || !this.depthTextureWrite || !this.staticDepthTexture) return;

        this.bindGroups.set('present', this.device.createBindGroup({ layout: this.pipelines.get('present')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.writeTexture.createView() }] }));

        const computeZoomPipeline = this.pipelines.get('computeZoom');
        if (computeZoomPipeline) {
            this.bindGroups.set('computeZoom', this.device.createBindGroup({
                layout: computeZoomPipeline.getBindGroupLayout(0),
                // --- 5. Add the 8th entry to match the shader ---
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: this.imageTexture.createView() },
                    { binding: 2, resource: this.writeTexture.createView() },
                    { binding: 3, resource: { buffer: this.v2ComputeUniformBuffer } },
                    { binding: 4, resource: this.depthTextureRead.createView() },
                    { binding: 5, resource: this.nonFilteringSampler },
                    { binding: 6, resource: this.depthTextureWrite.createView() },
                    { binding: 7, resource: this.staticDepthTexture.createView() }, // The missing entry
                ]
            }));
        }
    }

    private swapDepthTextures() {
        // ... (this function remains the same)
    }

    public render(mode: RenderMode, zoom: number, panX: number, panY: number, farthestPoint: { x: number, y: number }, depthThreshold: number): void {
        // ... (this function remains the same)
    }
}