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
    private v2ComputeUniformBuffer!: GPUBuffer;
    private v1ComputeUniformBuffer!: GPUBuffer;
    private imageVideoUniformBuffer!: GPUBuffer;
    private galaxyUniformBuffer!: GPUBuffer;
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;

    private fillStateTextureA!: GPUTexture;
    private fillStateTextureB!: GPUTexture;
    private fillUniformBuffer!: GPUBuffer;
    private needsFillReset = false;
    private fillIterations = 0;
    private readonly MAX_FILL_ITERATIONS = 256;

    // --- NEW: For reading pixel color from the GPU ---
    private colorReadbackBuffer!: GPUBuffer;
    private needsColorReadback = false;


    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public addRipplePoint(x: number, y: number, mode: RenderMode) {
        const point = { x, y, startTime: performance.now() / 1000.0 };
        this.ripplePoints = [point]; 
        if (mode === 'colorFill') {
            this.needsFillReset = true;
            this.needsColorReadback = true; // Signal that we need to read the color at this point
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
        // createBindGroups is now called after image is loaded
        
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

            const offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = this.canvas.width;
            offscreenCanvas.height = this.canvas.height;
            const ctx = offscreenCanvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(imageBitmap, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
            }
            const resizedBitmap = await createImageBitmap(offscreenCanvas);

            if (this.imageTexture) this.imageTexture.destroy();
            this.imageTexture = this.device.createTexture({
                size: [resizedBitmap.width, resizedBitmap.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
            });
            this.device.queue.copyExternalImageToTexture({ source: resizedBitmap }, { texture: this.imageTexture }, [resizedBitmap.width, resizedBitmap.height]);

            if (this.pipelines.size > 0) {
                this.createBindGroups();
            }
        } catch (e) { console.error("Failed to load image:", e); }
    }

    private async createResources(): Promise<void> {
        const { width, height } = this.canvas;
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.galaxyUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.imageVideoUniformBuffer = this.device.createBuffer({ size: 32 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v1ComputeUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v2ComputeUniformBuffer = this.device.createBuffer({ size: 16 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.writeTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });

        const stateTextureDesc: GPUTextureDescriptor = {
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST| GPUTextureUsage.RENDER_ATTACHMENT,
        };
        this.fillStateTextureA = this.device.createTexture(stateTextureDesc);
        this.fillStateTextureB = this.device.createTexture(stateTextureDesc);
        this.fillUniformBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        
        // --- NEW: Buffer for reading pixel color ---
        this.colorReadbackBuffer = this.device.createBuffer({
            size: 4, // 4 bytes for one RGBA pixel
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> {
        const [galaxyCode, imageVideoCode, liquidV1Code, liquidCode, textureCode, colorFillCode, fillComputeCode] = await Promise.all([
            fetch('shaders/galaxy.wgsl').then(res => res.text()),
            fetch('shaders/imageVideo.wgsl').then(res => res.text()),
            fetch('shaders/liquid-v1.wgsl').then(res => res.text()),
            fetch('shaders/liquid.wgsl').then(res => res.text()),
            fetch('shaders/texture.wgsl').then(res => res.text()),
            fetch('shaders/colorFill.wgsl').then(res => res.text()),
            fetch('shaders/fill.wgsl').then(res => res.text()),
        ]);

        const galaxyModule = this.device.createShaderModule({ code: galaxyCode });
        const imageVideoModule = this.device.createShaderModule({ code: imageVideoCode });
        const liquidV1Module = this.device.createShaderModule({ code: liquidV1Code });
        const liquidModule = this.device.createShaderModule({ code: liquidCode });
        const textureModule = this.device.createShaderModule({ code: textureCode });
        const colorFillModule = this.device.createShaderModule({ code: colorFillCode });
        const fillComputeModule = this.device.createShaderModule({ code: fillComputeCode });

        const commonConfig = { vertex: { module: imageVideoModule, entryPoint: 'vs_main' }, fragment: { targets: [{ format: this.presentationFormat }] }, primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology } };
        this.pipelines.set('galaxy', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, vertex: { module: galaxyModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: galaxyModule, entryPoint: 'fs_main' }, primitive: { topology: 'triangle-list' as GPUPrimitiveTopology } }));
        this.pipelines.set('imageVideo', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, fragment: { ...commonConfig.fragment, module: imageVideoModule, entryPoint: 'fs_main' } }));
        this.pipelines.set('liquid', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, vertex: { module: textureModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: textureModule, entryPoint: 'fs_main' } }));
        this.pipelines.set('computeV1', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidV1Module, entryPoint: 'main' } }));
        this.pipelines.set('compute', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidModule, entryPoint: 'main' } }));
        this.pipelines.set('colorFill', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, fragment: { ...commonConfig.fragment, module: colorFillModule, entryPoint: 'fs_main' } }));

        this.pipelines.set('fillCompute', this.device.createComputePipeline({ layout: 'auto', compute: { module: fillComputeModule, entryPoint: 'main' } }));
    }

    private createBindGroups(): void {
        if (!this.imageTexture) return;

        if (this.videoTexture) {
            this.bindGroups.set('galaxy', this.device.createBindGroup({ layout: this.pipelines.get('galaxy')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.galaxyUniformBuffer } }, { binding: 1, resource: this.sampler }, { binding: 2, resource: this.videoTexture.createView() }] }));
            this.bindGroups.set('video', this.device.createBindGroup({ layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.videoTexture.createView() }, { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }] }));
        }

        this.bindGroups.set('image', this.device.createBindGroup({ layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }] }));
        this.bindGroups.set('liquid', this.device.createBindGroup({ layout: this.pipelines.get('liquid')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.writeTexture.createView() }] }));
        this.bindGroups.set('computeV1', this.device.createBindGroup({ layout: this.pipelines.get('computeV1')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: this.writeTexture.createView() },{ binding: 3, resource: { buffer: this.v1ComputeUniformBuffer } } ] }));
        this.bindGroups.set('compute', this.device.createBindGroup({ layout: this.pipelines.get('compute')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: this.writeTexture.createView() }, { binding: 3, resource: { buffer: this.v2ComputeUniformBuffer } }] }));
        
        const fillLayout = this.pipelines.get('fillCompute')!.getBindGroupLayout(0);
        this.bindGroups.set('fill_A_to_B', this.device.createBindGroup({ layout: fillLayout, entries: [ { binding: 0, resource: this.imageTexture.createView() }, { binding: 1, resource: this.fillStateTextureA.createView() }, { binding: 2, resource: this.fillStateTextureB.createView() }, { binding: 3, resource: { buffer: this.fillUniformBuffer } }] }));
        this.bindGroups.set('fill_B_to_A', this.device.createBindGroup({ layout: fillLayout, entries: [ { binding: 0, resource: this.imageTexture.createView() }, { binding: 1, resource: this.fillStateTextureB.createView() }, { binding: 2, resource: this.fillStateTextureA.createView() }, { binding: 3, resource: { buffer: this.fillUniformBuffer } }] }));
    }

    public async render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number): Promise<void> {
        if (!this.device || !this.imageTexture) return;
        
        const commandEncoder = this.device.createCommandEncoder();

        // --- NEW: Read color from texture if requested ---
        if (mode === 'colorFill' && this.needsColorReadback && this.ripplePoints.length > 0) {
            this.needsColorReadback = false;
            const clickPoint = this.ripplePoints[0];
            const pixelX = Math.floor(clickPoint.x * this.imageTexture.width);
            const pixelY = Math.floor(clickPoint.y * this.imageTexture.height);

            commandEncoder.copyTextureToBuffer(
                { texture: this.imageTexture, mipLevel: 0, origin: { x: pixelX, y: pixelY } },
                { buffer: this.colorReadbackBuffer, bytesPerRow: 256 }, // bytesPerRow must be a multiple of 256
                { width: 1, height: 1 }
            );
        }

        // --- UPDATED: Flood fill compute pass ---
        if (mode === 'colorFill') {
            if (this.needsFillReset && this.ripplePoints.length > 0) {
                this.needsFillReset = false;
                this.fillIterations = 0;
                
                // We'll set the uniforms *after* we read the color back
            }

            if (this.fillIterations < this.MAX_FILL_ITERATIONS) {
                this.fillIterations++;
                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline(this.pipelines.get('fillCompute') as GPUComputePipeline);
                
                if (this.fillIterations % 2 === 1) {
                    computePass.setBindGroup(0, this.bindGroups.get('fill_A_to_B')!);
                } else {
                    computePass.setBindGroup(0, this.bindGroups.get('fill_B_to_A')!);
                }
                computePass.dispatchWorkgroups(this.canvas.width / 8, this.canvas.height / 8, 1);
                computePass.end();
            }
        }

        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: textureView, clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        const colorFillPipeline = this.pipelines.get('colorFill') as GPURenderPipeline;
        const imageVideoPipeline = this.pipelines.get('imageVideo') as GPURenderPipeline;

        switch (mode) {
            case 'colorFill':
                 if (colorFillPipeline) {
                    const finalStateTexture = (this.fillIterations % 2 === 1) ? this.fillStateTextureB : this.fillStateTextureA;
                    
                    const uniformArray = new Float32Array(8);
                    uniformArray.set([this.canvas.width, this.canvas.height, this.imageTexture.width, this.imageTexture.height], 0);
                    this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, uniformArray);

                    // **THE SECOND FIX IS HERE**
                    // The bind group now includes all 4 entries expected by the shader.
                    const colorFillBindGroup = this.device.createBindGroup({ 
                        layout: colorFillPipeline.getBindGroupLayout(0), 
                        entries: [
                            { binding: 0, resource: this.sampler }, 
                            { binding: 1, resource: this.imageTexture.createView() }, 
                            { binding: 2, resource: finalStateTexture.createView() },
                            { binding: 3, resource: { buffer: this.imageVideoUniformBuffer } } // Added the missing buffer
                        ] 
                    });

                    passEncoder.setPipeline(colorFillPipeline);
                    passEncoder.setBindGroup(0, colorFillBindGroup);
                    passEncoder.draw(4);
                }
                break;
            case 'image':
            case 'ripple':
                if (imageVideoPipeline && this.bindGroups.has('image')) {
                    const uniformArray = new Float32Array(8 + this.MAX_RIPPLES * 4);
                    uniformArray.set([this.canvas.width, this.canvas.height, this.imageTexture.width, this.imageTexture.height], 0);
                    uniformArray.set([currentTime, this.ripplePoints.length, mode === 'ripple' ? 1.0 : 0.0, 0.0], 4);
                    for (let i = 0; i < this.ripplePoints.length; i++) {
                        const point = this.ripplePoints[i];
                        uniformArray.set([point.x, point.y, point.startTime, 0.0], 8 + i * 4);
                    }
                    this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, uniformArray);
                    passEncoder.setPipeline(imageVideoPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('image')!);
                    passEncoder.draw(4);
                }
                break;
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);

         if (mode === 'colorFill' && this.fillIterations === 0 && this.ripplePoints.length > 0) {
            await this.colorReadbackBuffer.mapAsync(GPUMapMode.READ);
            const colorData = new Uint8Array(this.colorReadbackBuffer.getMappedRange());
            const targetColor = [colorData[0] / 255, colorData[1] / 255, colorData[2] / 255, colorData[3] / 255];
            this.colorReadbackBuffer.unmap();
            
            // Now that we have the color, set the uniforms for the *next* frame's compute pass
            const clickPoint = this.ripplePoints[0];
            const threshold = 0.4; // You can tune this
            const uniformData = new Float32Array([...[clickPoint.x, clickPoint.y], threshold, 0, ...targetColor]);
            this.device.queue.writeBuffer(this.fillUniformBuffer, 0, uniformData);

            // And we still need to clear the state textures to start the simulation
            const resetEncoder = this.device.createCommandEncoder();
            const clearColor = { r: 0, g: 0, b: 0, a: 0 };
            resetEncoder.beginRenderPass({ colorAttachments: [{ view: this.fillStateTextureA.createView(), clearValue: clearColor, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] }).end();
            resetEncoder.beginRenderPass({ colorAttachments: [{ view: this.fillStateTextureB.createView(), clearValue: clearColor, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] }).end();
            this.device.queue.submit([resetEncoder.finish()]);
        }
        
    }
}
