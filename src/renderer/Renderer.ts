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
    private uniformBuffer!: GPUBuffer;

    private mouseState = { x: 0.5, y: 0.5 };
    private params = { strength: 0.05, layers: 24, occlusion: 0.2, ambient: 0.3 };
    public isReady = false;
    private imageUrls: string[] = [];

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public updateMouse(x: number, y: number) { this.mouseState = { x, y }; }
    public updateParams(params: any) { this.params = params; }

    public updateDepthMap(data: Float32Array, width: number, height: number) {
        if (!this.device || !width || !height) return;
        if (!this.depthTexture || this.depthTexture.width !== width || this.depthTexture.height !== height) {
            if(this.depthTexture) this.depthTexture.destroy();
            this.depthTexture = this.device.createTexture({
                size: [width, height],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
        }
        this.device.queue.writeTexture({ texture: this.depthTexture }, data, { bytesPerRow: width * 4 }, [width, height]);
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

    public async loadRandomImage(): Promise<string | null> {
        try {
            if (this.imageUrls.length === 0) return null;
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

            return imageUrl;
        } catch (e) { 
            console.error("Failed to load image:", e);
            return null;
        }
    }

    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        this.device = await adapter.requestDevice({
            requiredFeatures: ['float32-filterable'] as GPUFeatureName[],
        });
        this.context = this.canvas.getContext('webgpu')!;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();

        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });

        await this.fetchImageUrls();
        await this.createResources();
        await this.createPipelines();
        return true;
    }

    public async loadImage(imageUrl: string): Promise<void> {
        this.isReady = false;
        try {
            const urlToFetch = imageUrl.startsWith('https://storage.googleapis.com/') ? imageUrl : `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`;
            const response = await fetch(urlToFetch);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            const imageBitmap = await createImageBitmap(await response.blob());

            if (this.imageTexture) this.imageTexture.destroy();
            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.imageTexture }, [imageBitmap.width, imageBitmap.height]);
        } catch (e) { console.error("Failed to load image:", e); throw e; }
    }

    private async createResources(): Promise<void> {
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.uniformBuffer = this.device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    private async createPipelines(): Promise<void> {
        try {
            const parallaxCode = await fetch('shaders/parallax.wgsl').then(res => res.text());
            const module = this.device.createShaderModule({ code: parallaxCode });
            this.pipelines.set('depth', await this.device.createRenderPipelineAsync({
                layout: 'auto',
                vertex: { module, entryPoint: 'vs_main' },
                fragment: { module, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
                primitive: { topology: 'triangle-strip' }
            }));
        } catch(e) { console.error("Pipeline creation failed:", e); }
    }

    public createBindGroups(): void {
        this.isReady = false;
        if (!this.imageTexture || !this.depthTexture || !this.pipelines.has('depth')) return;

        this.bindGroups.set('depth', this.device.createBindGroup({
            layout: this.pipelines.get('depth')!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.imageTexture.createView() },
                { binding: 2, resource: this.depthTexture.createView() },
                { binding: 3, resource: { buffer: this.uniformBuffer } },
            ]
        }));
        this.isReady = true;
    }

    public render(): void {
        if (!this.isReady || !this.device || !this.context) return;

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{ view: textureView, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp, clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }]
        });

        this.device.queue.writeBuffer(
            this.uniformBuffer, 0,
            new Float32Array([
                this.mouseState.x, this.mouseState.y, this.mouseState.x, this.mouseState.y,
                this.params.strength, this.params.layers, this.params.occlusion, this.params.ambient
            ])
        );
        passEncoder.setPipeline(this.pipelines.get('depth')!);
        passEncoder.setBindGroup(0, this.bindGroups.get('depth')!);
        passEncoder.draw(4);
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
