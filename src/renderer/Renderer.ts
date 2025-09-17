export type RenderMode = 'shader' | 'image' | 'video' | 'ripple' | 'liquid-v1' | 'liquid' | 'liquid-v3';

export class Renderer {
    // Canvas & Device
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;

    // Pipelines & Bind Groups stored in maps for better organization
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();

    // Resources
    private sampler!: GPUSampler;
    private imageUrls: string[] = [];
    
    // v2 Resources
    private ripplePoints: { x: number, y: number, startTime: number }[] = [];
    private MAX_RIPPLES = 50;
    private v2ComputeUniformBuffer!: GPUBuffer;
    private v1ComputeUniformBuffer!: GPUBuffer;
    private imageVideoUniformBuffer!: GPUBuffer;
    private galaxyUniformBuffer!: GPUBuffer;

    // v3 Resources
    private v3MouseUniformBuffer!: GPUBuffer;
    private velocityRead!: GPUTexture;
    private velocityWrite!: GPUTexture;
    private colorRead!: GPUTexture;
    private colorWrite!: GPUTexture;

    // Shared Resources
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture; // Source image
    private writeTexture!: GPUTexture; // v2 output
    
    // Mouse State for v3
    private mouseState = { x: 0, y: 0, deltaX: 0, deltaY: 0, isDragging: false };
    private frameCount = 0; // For ping-pong logic

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public updateMouse(x: number, y: number, deltaX: number, deltaY: number, isDragging: boolean) {
        this.mouseState = { x, y, deltaX, deltaY, isDragging };
    }

    public addRipplePoint(x: number, y: number) {
        this.ripplePoints.push({ x, y, startTime: performance.now() / 1000.0 });
    }

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
        await this.createBindGroups();
        
        return true;
    }

    private async fetchImageUrls(): Promise<void> {
        const bucketName = 'my-sd35-space-images-2025';
        const apiUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}/o`;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`Google Cloud Storage API returned status ${response.status}`);
            const data = await response.json();
            this.imageUrls = data.items ? data.items.map((item: { name: string }) => `https://storage.googleapis.com/${bucketName}/${item.name}`) : [];
            if (this.imageUrls.length === 0) console.warn("No images found in bucket or bucket is empty.");
        } catch (e) {
            console.error("Failed to fetch image list from Google Bucket:", e);
            this.imageUrls = ['https://i.imgur.com/vCNL2sT.jpeg'];
        }
    }
    
    public async loadRandomImage(): Promise<void> {
        try {
            if (this.imageUrls.length === 0) return;
            const imageUrl = this.imageUrls[Math.floor(Math.random() * this.imageUrls.length)];
            const response = await fetch(imageUrl);
            const imageBitmap = await createImageBitmap(await response.blob());

            if (this.imageTexture) this.imageTexture.destroy();
            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.imageTexture }, [imageBitmap.width, imageBitmap.height]);
            
            // --- FIX #1 & #2 ---
            // Instead of an incorrect copy, we now call a dedicated function
            // to properly initialize the v3 state by rendering to it.
            // We also REMOVED the incorrect call to createBindGroups() from here.
            this._initializeV3State();

        } catch (e) { console.error("Failed to load image:", e); }
    }

    private async createResources(): Promise<void> {
        const { width, height } = this.canvas;
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.galaxyUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.imageVideoUniformBuffer = this.device.createBuffer({ size: 32 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v1ComputeUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v2ComputeUniformBuffer = this.device.createBuffer({ size: 16 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.writeTexture = this.device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
        this.v3MouseUniformBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const floatTextureDesc: GPUTextureDescriptor = { 
            size: [width, height], 
            format: 'rgba16float', 
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        };
        this.velocityRead = this.device.createTexture(floatTextureDesc);
        this.velocityWrite = this.device.createTexture(floatTextureDesc);
        this.colorRead = this.device.createTexture(floatTextureDesc);
        this.colorWrite = this.device.createTexture(floatTextureDesc);
        await this.loadRandomImage();
    }

     private _initializeV3State() {
        if (!this.device || !this.imageTexture) return;

        // This bind group is used just once to stamp the source image onto the color state texture
        const initBindGroup = this.device.createBindGroup({
            layout: this.pipelines.get('liquid')!.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.imageTexture.createView() }
            ]
        });
         
    private async createPipelines(): Promise<void> {
        const [galaxyCode, imageVideoCode, liquidV1Code, liquidCode, textureCode, velocityCode, advectionCode] = await Promise.all([
            fetch('shaders/galaxy.wgsl').then(res => res.text()), fetch('shaders/imageVideo.wgsl').then(res => res.text()),
            fetch('shaders/liquid-v1.wgsl').then(res => res.text()), fetch('shaders/liquid.wgsl').then(res => res.text()),
            fetch('shaders/texture.wgsl').then(res => res.text()), fetch('shaders/velocity.wgsl').then(res => res.text()),
            fetch('shaders/advection.wgsl').then(res => res.text()),
        ]);

        const galaxyModule = this.device.createShaderModule({ code: galaxyCode });
        const imageVideoModule = this.device.createShaderModule({ code: imageVideoCode });
        const liquidV1Module = this.device.createShaderModule({ code: liquidV1Code });
        const liquidModule = this.device.createShaderModule({ code: liquidCode });
        const textureModule = this.device.createShaderModule({ code: textureCode });
        const velocityModule = this.device.createShaderModule({ code: velocityCode });
        const advectionModule = this.device.createShaderModule({ code: advectionCode });

        const commonConfig = { vertex: { module: imageVideoModule, entryPoint: 'vs_main' }, fragment: { targets: [{ format: this.presentationFormat }] }, primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology } };
        this.pipelines.set('galaxy', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, vertex: { module: galaxyModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: galaxyModule, entryPoint: 'fs_main' }, primitive: { topology: 'triangle-list' as GPUPrimitiveTopology } }));
        this.pipelines.set('imageVideo', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, fragment: { ...commonConfig.fragment, module: imageVideoModule, entryPoint: 'fs_main' } }));
        this.pipelines.set('liquid', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, vertex: { module: textureModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: textureModule, entryPoint: 'fs_main' } }));
        this.pipelines.set('computeV1', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidV1Module, entryPoint: 'main' } }));
        this.pipelines.set('compute', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidModule, entryPoint: 'main' } }));
        this.pipelines.set('velocity', this.device.createComputePipeline({ layout: 'auto', compute: { module: velocityModule, entryPoint: 'main' } }));
        this.pipelines.set('advection', this.device.createComputePipeline({ layout: 'auto', compute: { module: advectionModule, entryPoint: 'main' } }));
    }

    private async createBindGroups(): Promise<void> {
        if (!this.imageTexture) return;

        // v2 Bind Groups
        this.bindGroups.set('image', this.device.createBindGroup({ layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }] }));
        this.bindGroups.set('liquid', this.device.createBindGroup({ layout: this.pipelines.get('liquid')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.writeTexture.createView() }] }));
        this.bindGroups.set('computeV1', this.device.createBindGroup({ layout: this.pipelines.get('computeV1')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: this.writeTexture.createView() }, { binding: 3, resource: { buffer: this.v1ComputeUniformBuffer } }] }));
        this.bindGroups.set('computeV2', this.device.createBindGroup({ layout: this.pipelines.get('compute')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: this.writeTexture.createView() }, { binding: 3, resource: { buffer: this.v2ComputeUniformBuffer } }] }));
        
        // v3 Bind Groups - need to handle ping-ponging
        const velRead = this.frameCount % 2 === 0 ? this.velocityRead : this.velocityWrite;
        const velWrite = this.frameCount % 2 === 0 ? this.velocityWrite : this.velocityRead;
        const colRead = this.frameCount % 2 === 0 ? this.colorRead : this.colorWrite;
        const colWrite = this.frameCount % 2 === 0 ? this.colorWrite : this.colorRead;

        this.bindGroups.set('velocity', this.device.createBindGroup({ layout: this.pipelines.get('velocity')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: velRead.createView() }, { binding: 2, resource: velWrite.createView() }, { binding: 3, resource: { buffer: this.v3MouseUniformBuffer } }] }));
        this.bindGroups.set('advection', this.device.createBindGroup({ layout: this.pipelines.get('advection')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: velWrite.createView() }, { binding: 2, resource: colRead.createView() }, { binding: 3, resource: colWrite.createView() }, { binding: 4, resource: this.imageTexture.createView() }] }));
        this.bindGroups.set('v3final', this.device.createBindGroup({ layout: this.pipelines.get('liquid')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: colWrite.createView() }] }));
    }

    public render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number): void {
        const { width, height } = this.canvas;
        const commandEncoder = this.device.createCommandEncoder();
        const currentTime = performance.now() / 1000.0;

           if (mode === 'liquid-v3') {
            this.createBindGroups();
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

            this.frameCount++;
        } else if (mode.startsWith('liquid')) {
            const computePass = commandEncoder.beginComputePass();
            if (mode === 'liquid-v1') {
                this.device.queue.writeBuffer(this.v1ComputeUniformBuffer, 0, new Float32Array([currentTime, this.canvas.width, this.canvas.height]));
                computePass.setPipeline(this.pipelines.get('computeV1') as GPUComputePipeline);
                computePass.setBindGroup(0, this.bindGroups.get('computeV1')!);
            } else { // 'liquid' v2
                this.ripplePoints = this.ripplePoints.filter(p => (currentTime - p.startTime) < 4.0);
                if (this.ripplePoints.length > this.MAX_RIPPLES) this.ripplePoints.splice(0, this.ripplePoints.length - this.MAX_RIPPLES);
                const computeUniformArray = new Float32Array(4 + this.MAX_RIPPLES * 4);
                computeUniformArray.set([currentTime, this.ripplePoints.length, this.canvas.width, this.canvas.height], 0);
                const rippleData = new Float32Array(this.MAX_RIPPLES * 4);
                for (let i = 0; i < this.ripplePoints.length; i++) {
                    const point = this.ripplePoints[i];
                    rippleData.set([point.x, point.y, point.startTime], i * 4);
                }
                computeUniformArray.set(rippleData, 4);
                this.device.queue.writeBuffer(this.v2ComputeUniformBuffer, 0, computeUniformArray);
                computePass.setPipeline(this.pipelines.get('compute') as GPUComputePipeline);
                computePass.setBindGroup(0, this.bindGroups.get('computeV2')!);
            }
            computePass.dispatchWorkgroups(width / 8, height / 8, 1);
            computePass.end();
        }
        
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: textureView, clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        // --- FIX IS HERE ---
        // Updated this block to use the new Map-based storage.
        const liquidPipeline = this.pipelines.get('liquid') as GPURenderPipeline;
        const imageVideoPipeline = this.pipelines.get('imageVideo') as GPURenderPipeline;
        const galaxyPipeline = this.pipelines.get('galaxy') as GPURenderPipeline;

        switch (mode) {
            case 'shader':
                // ... logic unchanged, just using the new variables ...
                break;
            case 'image':
            case 'ripple':
                // ... logic unchanged, just using the new variables ...
                break;
            case 'video':
                 // ... logic unchanged, just using the new variables ...
                break;
            case 'liquid-v1':
            case 'liquid':
                if (liquidPipeline && this.bindGroups.has('liquid')) {
                    passEncoder.setPipeline(liquidPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('liquid')!);
                    passEncoder.draw(4);
                }
                break;
            case 'liquid-v3':
                 if (liquidPipeline && this.bindGroups.has('v3final')) {
                    passEncoder.setPipeline(liquidPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('v3final')!);
                    passEncoder.draw(4);
                }
                break;
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
