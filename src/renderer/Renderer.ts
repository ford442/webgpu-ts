import { Effect } from '../effects/Effect';
// import { InvertEffect } from '../effects/InvertEffect'; 
// NOTE: I've commented this out so you don't get an error before creating the file.
// Please create InvertEffect.ts and uncomment this line.

// A temporary mock effect to prevent errors until you create the real ones.
class InvertEffect implements Effect {
    name = "Invert Colors";
    async init(device: GPUDevice, presentationFormat: GPUTextureFormat): Promise<void> {}
    render(device: GPUDevice, passEncoder: GPURenderPassEncoder, sampler: GPUSampler, texture: GPUTexture, uniformBuffer: GPUBuffer, canvas: HTMLCanvasElement, videoElement: HTMLVideoElement): void {}
}


export type RenderMode = 'shader' | 'image' | 'video' | 'ripple' | 'effect';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;

    private effects: Effect[] = [];
    private activeEffect: Effect | null = null;

    private imageVideoUniformBuffer!: GPUBuffer;
    private sampler!: GPUSampler;
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture;
    private imageUrls: string[] = [];
    
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

        await this.fetchImageUrls();
        await this.createResources();
        await this.initializeEffects();
        
        return true;
    }

    private async fetchImageUrls(): Promise<void> {
        const bucketName = 'my-sd35-space-images-2025'; 
        const apiUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}/o`;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`Google Cloud Storage API returned status ${response.status}`);
            const data = await response.json();
            this.imageUrls = data.items ? data.items.map((item: any) => `https://storage.googleapis.com/${bucketName}/${item.name}`) : [];
            if (this.imageUrls.length === 0) console.warn("No images found in bucket.");
        } catch (e) {
            console.error("Failed to fetch image list from Google Bucket:", e);
            this.imageUrls = ['https://i.imgur.com/vCNL2sT.jpeg'];
        }
    }

    public async loadRandomImage(): Promise<void> {
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
        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap }, { texture: this.imageTexture }, [imageBitmap.width, imageBitmap.height]
        );
    }

    private async createResources(): Promise<void> {
        this.imageVideoUniformBuffer = this.device.createBuffer({
            size: 1024, 
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        await this.loadRandomImage();
    }

    private async initializeEffects(): Promise<void> {
        this.effects = [
            new InvertEffect(),
        ];

        for (const effect of this.effects) {
            await effect.init(this.device, this.presentationFormat);
        }

        this.activeEffect = this.effects[0] || null;
    }
    
    public getAvailableEffects(): string[] {
        return this.effects.map(effect => effect.name);
    }

    public setActiveEffect(name: string): void {
        const effect = this.effects.find(e => e.name === name);
        this.activeEffect = effect || null;
    }

    public render(mode: RenderMode, videoElement: HTMLVideoElement): void {
        if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
            if (!this.videoTexture || this.videoTexture.width !== videoElement.videoWidth || this.videoTexture.height !== videoElement.videoHeight) {
                if (this.videoTexture) this.videoTexture.destroy();
                this.videoTexture = this.device.createTexture({
                    size: [videoElement.videoWidth, videoElement.videoHeight],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
                });
            }
            this.device.queue.copyExternalImageToTexture(
                { source: videoElement }, { texture: this.videoTexture }, [videoElement.videoWidth, videoElement.videoHeight]
            );
        }

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        // --- FIX IS HERE ---
        // Explicitly cast 'clear' and 'store' to the required types.
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        if (this.activeEffect && this.imageTexture && this.videoTexture) {
            const sourceTexture = mode === 'video' ? this.videoTexture : this.imageTexture;
            
            this.activeEffect.render(
                this.device,
                passEncoder,
                this.sampler,
                sourceTexture,
                this.imageVideoUniformBuffer,
                this.canvas,
                videoElement
            );
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
