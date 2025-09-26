// (This is the full file for clarity)
export type RenderMode = 'shader' | 'image' | 'video' | 'ripple' | 'liquid' | 'depth';

const GRID_SIZE = 256;

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
    private cameraState = {
        rotationX: 0.5,
        rotationY: 0,
        zoom: 1.0,
        isDragging: false,
        lastMouseX: 0,
        lastMouseY: 0,
    };
    private params = { displacementScale: 0.3, ambient: 0.3, smoothness: 1.0, pointSize: 3.0 };
    public isReady = false;
    private imageUrls: string[] = [];

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public updateParams(params: any) { this.params = params; }

    public updateMouse(x: number, y: number, isDragging: boolean) {
        this.mouseState.x = x / this.canvas.width;
        this.mouseState.y = y / this.canvas.height;
        
        if (isDragging) {
            if (!this.cameraState.isDragging) {
                this.cameraState.isDragging = true;
                this.cameraState.lastMouseX = x;
                this.cameraState.lastMouseY = y;
            } else {
                const dx = x - this.cameraState.lastMouseX;
                const dy = y - this.cameraState.lastMouseY;
                this.cameraState.rotationY += dx * 0.01;
                this.cameraState.rotationX += dy * 0.01;
                this.cameraState.rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.cameraState.rotationX));
                this.cameraState.lastMouseX = x;
                this.cameraState.lastMouseY = y;
            }
        }
    }

    public stopMouseDrag() { this.cameraState.isDragging = false; }
    public updateZoom(deltaY: number) {
        this.cameraState.zoom += deltaY * 0.001;
        this.cameraState.zoom = Math.max(0.2, Math.min(5.0, this.cameraState.zoom));
    }
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
    public async fetchImageUrls(): Promise<void> {
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
        this.isReady = false;
        try {
            if (this.imageUrls.length === 0) return null;
            const imageUrl = this.imageUrls[Math.floor(Math.random() * this.imageUrls.length)];
            const response = await fetch(imageUrl);
            const imageBitmap = await createImageBitmap(await response.blob());

            if (this.imageTexture) this.imageTexture.destroy();

            const mipLevelCount = Math.floor(Math.log2(Math.max(imageBitmap.width, imageBitmap.height))) + 1;

            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height, 1],
                mipLevelCount,
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });

            this.device.queue.copyExternalImageToTexture(
                { source: imageBitmap },
                { texture: this.imageTexture },
                [imageBitmap.width, imageBitmap.height]
            );

            await this.generateMipmaps(this.imageTexture);
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
        this.device = await adapter.requestDevice({ requiredFeatures: ['float32-filterable'] as GPUFeatureName[], });
        this.context = this.canvas.getContext('webgpu')!;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: this.device, format: this.presentationFormat, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT });
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

            const mipLevelCount = Math.floor(Math.log2(Math.max(imageBitmap.width, imageBitmap.height))) + 1;

            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height, 1],
                mipLevelCount,
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });

            this.device.queue.copyExternalImageToTexture(
                { source: imageBitmap },
                { texture: this.imageTexture },
                [imageBitmap.width, imageBitmap.height]
            );

            await this.generateMipmaps(this.imageTexture);
        } catch (e) {
            console.error("Failed to load image:", e);
            throw e;
        }
    }
    private blitPipeline!: GPURenderPipeline; // To be created on demand

    private async generateMipmaps(texture: GPUTexture): Promise<void> {
        // 1. Create the blit pipeline if it doesn't exist
        if (!this.blitPipeline) {
            const blitShaderModule = this.device.createShaderModule({
                code: await fetch('shaders/blit.wgsl').then(r => r.text()),
            });
            this.blitPipeline = this.device.createRenderPipeline({
                layout: 'auto',
                vertex: { module: blitShaderModule, entryPoint: 'vs_main' },
                fragment: {
                    module: blitShaderModule,
                    entryPoint: 'fs_main',
                    targets: [{ format: texture.format }],
                },
                primitive: { topology: 'triangle-strip' },
            });
        }

        // 2. Create a sampler for the blit operation
        const blitSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        // 3. Create a single command encoder
        const commandEncoder = this.device.createCommandEncoder();

        // 4. Loop through mip levels and record the blit commands
        let srcView = texture.createView({ baseMipLevel: 0, mipLevelCount: 1 });

        for (let i = 1; i < texture.mipLevelCount; i++) {
            const dstView = texture.createView({ baseMipLevel: i, mipLevelCount: 1 });

            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: dstView,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: [0, 0, 0, 0],
                }],
            });

            const bindGroup = this.device.createBindGroup({
                layout: this.blitPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: blitSampler },
                    { binding: 1, resource: srcView },
                ],
            });

            passEncoder.setPipeline(this.blitPipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.draw(4);
            passEncoder.end();

            srcView = dstView; // The destination of this pass is the source for the next
        }

        // 5. Submit all recorded commands at once
        this.device.queue.submit([commandEncoder.finish()]);
    }
    private async createResources(): Promise<void> {
        // Now with mipmapping support
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
        this.uniformBuffer = this.device.createBuffer({
            size: 48, // Now holds rotation, zoom, displace, ambient, smooth, light, pointsize
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }
    private async createPipelines(): Promise<void> {
        try {
            const displacementCode = await fetch('shaders/parallax.wgsl').then(res => res.text());
            const module = this.device.createShaderModule({ code: displacementCode });
            this.pipelines.set('depth', await this.device.createRenderPipelineAsync({
                layout: 'auto',
                vertex: { module, entryPoint: 'vs_main' },
                fragment: { module, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
                primitive: { topology: 'triangle-strip' } // Back to triangle-strip
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
            colorAttachments: [{ view: textureView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }]
        });
        this.device.queue.writeBuffer(
            this.uniformBuffer, 0,
            new Float32Array([
                this.cameraState.rotationX, this.cameraState.rotationY,
                this.cameraState.zoom,
                this.params.displacementScale,
                this.params.ambient,
                this.params.smoothness,
                this.mouseState.x, this.mouseState.y,
                this.params.pointSize
            ])
        );
        passEncoder.setPipeline(this.pipelines.get('depth')!);
        passEncoder.setBindGroup(0, this.bindGroups.get('depth')!);
        // We now draw 4 vertices for each point to make a quad
        passEncoder.draw(GRID_SIZE * GRID_SIZE * 4);
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
