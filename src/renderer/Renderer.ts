import { RenderMode } from './types';
import { IRenderMode } from './IRenderMode';
import { LightingMode } from './modes/LightingMode';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private sampler!: GPUSampler;
    private nonFilteringSampler!: GPUSampler;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;
    private depthTextureRead!: GPUTexture;
    private uniformBuffer!: GPUBuffer;
    private finalRenderPipeline!: GPURenderPipeline;
    private finalRenderBindGroup!: GPUBindGroup;
    private imageUrls: string[] = [];
    private activeMode: IRenderMode | null = null;
    private activeModeName: RenderMode | null = null;
    private isModeReady: boolean = false;
    private isLoading: boolean = false;

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
        this.createSharedResources();
        await this.loadRandomImage();
        const textureShaderCode = await fetch('shaders/texture.wgsl').then(res => res.text());
        const textureModule = this.device.createShaderModule({ code: textureShaderCode });
        this.finalRenderPipeline = await this.device.createRenderPipelineAsync({
            layout: 'auto',
            vertex: { module: textureModule, entryPoint: 'vs_main' },
            fragment: { module: textureModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
            primitive: { topology: 'triangle-strip' }
        });
        return true;
    }

    private createSharedResources(): void {
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nonFilteringSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
        this.uniformBuffer = this.device.createBuffer({
            size: 24,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.imageTexture = this.device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
        this.writeTexture = this.device.createTexture({ size: [this.canvas.width, this.canvas.height], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
        this.depthTextureRead = this.device.createTexture({ size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING });
    }
    
    public async setMode(modeName: RenderMode): Promise<void> {
        if (modeName === this.activeModeName && this.activeMode) return;
        this.isModeReady = false;
        if (this.activeMode?.destroy) {
            this.activeMode.destroy();
        }
        switch (modeName) {
            case 'liquid-v1':
                this.activeMode = new LightingMode();
                break;
            default:
                console.warn(`Mode "${modeName}" not yet implemented.`);
                this.activeMode = null;
                this.activeModeName = modeName;
                return;
        }
        this.activeModeName = modeName;
        await this.activeMode.init(
            this.device, this.presentationFormat, this.sampler, this.nonFilteringSampler,
            this.imageTexture, this.depthTextureRead, this.writeTexture, this.uniformBuffer
        );
        this.isModeReady = true;
    }
    
    public render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number, farthestPoint: { x: number, y: number }, mousePosition: { x: number, y: number }, isMouseDown: boolean): void {
        if (this.isLoading || !this.device || !this.activeMode || !this.isModeReady || mode !== this.activeModeName) return;
        const commandEncoder = this.device.createCommandEncoder();
        const uniformData = new Float32Array([
            this.canvas.width, this.canvas.height,
            mousePosition.x, mousePosition.y,
            isMouseDown ? 1.0 : 0.0,
            0 // Padding to make the total size 24 bytes
        ]);
        this.activeMode.render(commandEncoder, uniformData);
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: textureView, clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        this.finalRenderBindGroup = this.device.createBindGroup({
            layout: this.finalRenderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.writeTexture.createView() }
            ]
        });
        passEncoder.setPipeline(this.finalRenderPipeline);
        passEncoder.setBindGroup(0, this.finalRenderBindGroup);
        passEncoder.draw(4);
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
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
        this.isLoading = true;
        try {
            if (this.imageUrls.length === 0) return;
            const imageUrl = this.imageUrls[Math.floor(Math.random() * this.imageUrls.length)];
            const response = await fetch(imageUrl);
            const imageBitmap = await createImageBitmap(await response.blob());
            const oldTexture = this.imageTexture;
            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba16float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.imageTexture }, [imageBitmap.width, imageBitmap.height]);
            await this.device.queue.onSubmittedWorkDone();
            if (oldTexture) {
                oldTexture.destroy();
            }
            if (this.activeModeName) {
                await this.setMode(this.activeModeName);
            }
            return imageUrl;
        } catch (e) {
            console.error("Failed to load image:", e);
            return undefined;
        } finally {
            this.isLoading = false;
        }
    }

    public async updateDepthMap(data: Float32Array, width: number, height: number): Promise<void> {
        this.isLoading = true;
        if (!this.device) {
            this.isLoading = false;
            return;
        };
        const oldTexture = this.depthTextureRead;
        this.depthTextureRead = this.device.createTexture({
            size: [width, height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
        });
        this.device.queue.writeTexture({ texture: this.depthTextureRead }, data, { bytesPerRow: width * 4 }, [width, height]);
        await this.device.queue.onSubmittedWorkDone();
        if (oldTexture) {
            oldTexture.destroy();
        }
        if (this.activeModeName) {
            await this.setMode(this.activeModeName);
        }
        this.isLoading = false;
    }
}
