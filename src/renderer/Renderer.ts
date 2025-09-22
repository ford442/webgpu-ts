export type RenderMode = 'liquid' | 'image' | 'video' | 'ripple' | 'liquid-v1' | 'shader' | 'colorFill';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();
    private sampler!: GPUSampler;
    private imageUrls: string[] = [];
    private ripplePoints: { x: number, y: number, startTime: number }[] = [];
    private MAX_RIPPLES = 50;
    private v1ComputeUniformBuffer!: GPUBuffer;
    private imageVideoUniformBuffer!: GPUBuffer;
    private galaxyUniformBuffer!: GPUBuffer;
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture;
    
    // --- NEW PROPERTIES FOR LUMINANCE AND LIGHT EFFECT ---
    private averageLuminance = 0.0;
    private luminanceResultBuffer!: GPUBuffer;
    private luminanceStagingBuffer!: GPUBuffer;
    private lightUniformBuffer!: GPUBuffer;

    // --- PROPERTIES FOR FLOOD FILL ---
    private fillStateTextureA!: GPUTexture;
    private fillStateTextureB!: GPUTexture;
    private fillUniformBuffer!: GPUBuffer;
    private needsFillReset = false;
    private fillIterations = 0;
    private readonly MAX_FILL_ITERATIONS = 64;


    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public addRipplePoint(x: number, y: number, mode: RenderMode) {
        const point = { x, y, startTime: performance.now() / 1000.0 };
        this.ripplePoints = [point];
        if (mode === 'colorFill') {
            this.needsFillReset = true;
        }
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
        
        return true;
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
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.imageTexture }, [imageBitmap.width, imageBitmap.height]);

            if (this.pipelines.size > 0) {
                this.createBindGroups();
                await this.calculateAverageLuminance();
            }
        } catch (e) { console.error("Failed to load image:", e); }
    }

    private async createResources(): Promise<void> {
        const { width, height } = this.canvas;
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.galaxyUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.imageVideoUniformBuffer = this.device.createBuffer({ size: 32 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v1ComputeUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        
        const stateTextureDesc: GPUTextureDescriptor = {
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST| GPUTextureUsage.RENDER_ATTACHMENT,
        };
        this.fillStateTextureA = this.device.createTexture(stateTextureDesc);
        this.fillStateTextureB = this.device.createTexture(stateTextureDesc);
        this.fillUniformBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        // --- NEW BUFFERS ---
        this.lightUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.luminanceResultBuffer = this.device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, });
        this.luminanceStagingBuffer = this.device.createBuffer({ size: 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, });


        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> {
        const [galaxyCode, imageVideoCode, liquidV1Code, colorFillCode, fillComputeCode, lightCode, luminanceCode] = await Promise.all([
            fetch('shaders/galaxy.wgsl').then(res => res.text()),
            fetch('shaders/imageVideo.wgsl').then(res => res.text()),
            fetch('shaders/liquid-v1.wgsl').then(res => res.text()),
            fetch('shaders/colorFill.wgsl').then(res => res.text()),
            fetch('shaders/fill.wgsl').then(res => res.text()),
            fetch('shaders/light.wgsl').then(res => res.text()),
            fetch('shaders/luminance.wgsl').then(res => res.text()),
        ]);

        // Create shader modules
        const imageVideoModule = this.device.createShaderModule({ code: imageVideoCode });
        const liquidV1Module = this.device.createShaderModule({ code: liquidV1Code });
        const fillComputeModule = this.device.createShaderModule({ code: fillComputeCode });
        const luminanceModule = this.device.createShaderModule({ code: luminanceCode });
        const lightModule = this.device.createShaderModule({ code: lightCode });
        const colorFillModule = this.device.createShaderModule({ code: colorFillCode });

        this.pipelines.set('imageVideo', this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: imageVideoModule, entryPoint: 'vs_main' },
            fragment: {
                module: imageVideoModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat }]
            },
            primitive: { topology: 'triangle-strip' }
        }));

        this.pipelines.set('computeV1', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidV1Module, entryPoint: 'main' } }));
        this.pipelines.set('fillCompute', this.device.createComputePipeline({ layout: 'auto', compute: { module: fillComputeModule, entryPoint: 'main' } }));
        this.pipelines.set('luminanceCompute', this.device.createComputePipeline({ layout: 'auto', compute: { module: luminanceModule, entryPoint: 'main' } }));

        this.pipelines.set('light', this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: lightModule, entryPoint: 'vs_main' },
            fragment: {
                module: lightModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat }]
            },
            primitive: { topology: 'triangle-strip' }
        }));
        
        // --- FIX IS HERE: Casting strings to their specific GPU types ---
        this.pipelines.set('colorFill', this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: colorFillModule, entryPoint: 'vs_main' },
            fragment: {
                module: colorFillModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: this.presentationFormat,
                    blend: {
                        color: { 
                            srcFactor: 'src-alpha' as GPUBlendFactor, 
                            dstFactor: 'one-minus-src-alpha' as GPUBlendFactor, 
                            operation: 'add' as GPUBlendOperation 
                        },
                        alpha: { 
                            srcFactor: 'one' as GPUBlendFactor, 
                            dstFactor: 'one-minus-src-alpha' as GPUBlendFactor, 
                            operation: 'add' as GPUBlendOperation 
                        }
                    }
                }]
            },
            primitive: { topology: 'triangle-strip' }
        }));
    }

    private createBindGroups(): void {
        if (!this.imageTexture) return;
        this.bindGroups.set('image', this.device.createBindGroup({ layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }] }));
        const fillLayout = this.pipelines.get('fillCompute')!.getBindGroupLayout(0);
        this.bindGroups.set('fill_A_to_B', this.device.createBindGroup({ layout: fillLayout, entries: [ { binding: 0, resource: this.imageTexture.createView() }, { binding: 1, resource: this.fillStateTextureA.createView() }, { binding: 2, resource: this.fillStateTextureB.createView() }, { binding: 3, resource: { buffer: this.fillUniformBuffer } }] }));
        this.bindGroups.set('fill_B_to_A', this.device.createBindGroup({ layout: fillLayout, entries: [ { binding: 0, resource: this.imageTexture.createView() }, { binding: 1, resource: this.fillStateTextureB.createView() }, { binding: 2, resource: this.fillStateTextureA.createView() }, { binding: 3, resource: { buffer: this.fillUniformBuffer } }] }));
        
        // --- NEW BIND GROUPS ---
        this.bindGroups.set('luminance', this.device.createBindGroup({ layout: this.pipelines.get('luminanceCompute')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.imageTexture.createView({format: 'rgba8unorm'}) }, { binding: 1, resource: { buffer: this.luminanceResultBuffer } }] }));
        this.bindGroups.set('light', this.device.createBindGroup({ layout: this.pipelines.get('light')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.lightUniformBuffer } }] }));
    }

    private async calculateAverageLuminance(): Promise<void> {
        if (!this.imageTexture || !this.pipelines.has('luminanceCompute')) return;

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipelines.get('luminanceCompute') as GPUComputePipeline);
        passEncoder.setBindGroup(0, this.bindGroups.get('luminance')!);
        passEncoder.dispatchWorkgroups(Math.ceil(this.imageTexture.width / 8), Math.ceil(this.imageTexture.height / 8));
        passEncoder.end();

        commandEncoder.copyBufferToBuffer(this.luminanceResultBuffer, 0, this.luminanceStagingBuffer, 0, 8);
        this.device.queue.submit([commandEncoder.finish()]);

        await this.luminanceStagingBuffer.mapAsync(GPUMapMode.READ);
        const data = new Uint32Array(this.luminanceStagingBuffer.getMappedRange());
        const totalLuminanceScaled = data[0];
        const totalPixels = data[1];
        this.luminanceStagingBuffer.unmap();
        
        if (totalPixels > 0) {
            this.averageLuminance = (totalLuminanceScaled / 1000000.0) / totalPixels;
        } else {
            this.averageLuminance = 0.5;
        }
    }


    public render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number): void {
        if (!this.device || !this.imageTexture) return;
        const currentTime = performance.now() / 1000.0;
        const commandEncoder = this.device.createCommandEncoder();

        if (mode === 'colorFill') {
            if (this.needsFillReset && this.ripplePoints.length > 0) {
                this.needsFillReset = false;
                this.fillIterations = 0;
                const clickPoint = this.ripplePoints[0];
                const threshold = 0.2;
                const uniformData = new Float32Array(8);
                uniformData.set([clickPoint.x, clickPoint.y]);
                uniformData.set([threshold], 2);
                uniformData.set([this.averageLuminance], 3);
                uniformData.set([this.canvas.width, this.canvas.height, this.imageTexture.width, this.imageTexture.height], 4);
                this.device.queue.writeBuffer(this.fillUniformBuffer, 0, uniformData);

                const clearColor = { r: 0, g: 0, b: 0, a: 0 };
                commandEncoder.beginRenderPass({ colorAttachments: [{ view: this.fillStateTextureA.createView(), clearValue: clearColor, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] }).end();
                commandEncoder.beginRenderPass({ colorAttachments: [{ view: this.fillStateTextureB.createView(), clearValue: clearColor, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] }).end();
            }

            if (this.fillIterations < this.MAX_FILL_ITERATIONS) {
                this.fillIterations++;
                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline(this.pipelines.get('fillCompute') as GPUComputePipeline);
                computePass.setBindGroup(0, (this.fillIterations % 2 === 1) ? this.bindGroups.get('fill_A_to_B')! : this.bindGroups.get('fill_B_to_A')!);
                computePass.dispatchWorkgroups(this.canvas.width / 8, this.canvas.height / 8);
                computePass.end();
            }
        }
        
        const textureView = this.context.getCurrentTexture().createView();
        
        switch (mode) {
            case 'colorFill':
                // --- RENDER PASS 1: The light effect underneath ---
                const lightPassEncoder = commandEncoder.beginRenderPass({ colorAttachments: [{ view: textureView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] });
                this.device.queue.writeBuffer(this.lightUniformBuffer, 0, new Float32Array([currentTime, this.canvas.width, this.canvas.height]));
                lightPassEncoder.setPipeline(this.pipelines.get('light') as GPURenderPipeline);
                lightPassEncoder.setBindGroup(0, this.bindGroups.get('light')!);
                lightPassEncoder.draw(4);
                lightPassEncoder.end();

                // --- RENDER PASS 2: The translucent color fill on top ---
                const colorFillPassEncoder = commandEncoder.beginRenderPass({ colorAttachments: [{ view: textureView, loadOp: 'load' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] });
                const finalStateTexture = (this.fillIterations % 2 === 1) ? this.fillStateTextureB : this.fillStateTextureA;
                const uniformArray = new Float32Array([this.canvas.width, this.canvas.height, this.imageTexture.width, this.imageTexture.height]);
                this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, uniformArray);
                const cfBindGroup = this.device.createBindGroup({ layout: this.pipelines.get('colorFill')!.getBindGroupLayout(0), entries: [ { binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: finalStateTexture.createView() }, { binding: 3, resource: { buffer: this.imageVideoUniformBuffer } }] });
                colorFillPassEncoder.setPipeline(this.pipelines.get('colorFill') as GPURenderPipeline);
                colorFillPassEncoder.setBindGroup(0, cfBindGroup);
                colorFillPassEncoder.draw(4);
                colorFillPassEncoder.end();
                break;
            default:
                const passEncoder = commandEncoder.beginRenderPass({ colorAttachments: [{ view: textureView, clearValue: {r:0,g:0,b:0,a:1}, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }]});
                if (this.pipelines.has('imageVideo') && this.bindGroups.has('image')) {
                    const uniformArray = new Float32Array(8 + this.MAX_RIPPLES * 4);
                    uniformArray.set([this.canvas.width, this.canvas.height, this.imageTexture.width, this.imageTexture.height]);
                    uniformArray.set([currentTime, this.ripplePoints.length, 0, 0], 4);
                    this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, uniformArray);
                    passEncoder.setPipeline(this.pipelines.get('imageVideo') as GPURenderPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('image')!);
                    passEncoder.draw(4);
                }
                passEncoder.end();
                break;
        }

        this.device.queue.submit([commandEncoder.finish()]);
    }
}
