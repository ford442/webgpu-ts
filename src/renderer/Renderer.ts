/**
 * A modular WebGPU renderer that supports stateful compute effects via texture ping-ponging.
 */
export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private activePipeline: GPUComputePipeline | null = null;
    private displayPipeline!: GPURenderPipeline;
    private universalBindGroupLayout!: GPUBindGroupLayout;
    private uniformBuffer!: GPUBuffer;
    private primaryTexture!: GPUTexture;   // The original, undisturbed image
    private depthTexture!: GPUTexture;     // For depth data
    
    // --- Resources for Stateful Ping-Pong ---
    private stateTextureA!: GPUTexture;
    private stateTextureB!: GPUTexture;
    private computeBindGroupA!: GPUBindGroup;
    private computeBindGroupB!: GPUBindGroup;
    private displayBindGroupA!: GPUBindGroup;
    private displayBindGroupB!: GPUBindGroup;
    private frameCount = 0;

    private linearSampler!: GPUSampler;
    private nearestSampler!: GPUSampler;
    private imageUrls: string[] = [];
    private uniforms = new Float32Array(256);
    private ripplePoints: { x: number, y: number, startTime: number }[] = [];
    private readonly MAX_RIPPLES = 50;

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
            alphaMode: 'premultiplied'
        });

        await this.createUniversalResources();
        await this.fetchImageUrls();
        await this.loadRandomImage();
        return true;
    }

    private async createUniversalResources(): Promise<void> {
        this.uniformBuffer = this.device.createBuffer({
            size: this.uniforms.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.linearSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nearestSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

        const stateTextureDesc: GPUTextureDescriptor = {
            size: [this.canvas.width, this.canvas.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
        };
        this.stateTextureA = this.device.createTexture(stateTextureDesc);
        this.stateTextureB = this.device.createTexture(stateTextureDesc);

        this.primaryTexture = this.device.createTexture({ ...stateTextureDesc, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
        this.depthTexture = this.device.createTexture({ size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        
        // --- THIS IS THE CORRECTED PART ---
        this.universalBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, texture: {} }, // Primary Texture (Made visible to fragment)
                { binding: 3, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, texture: {} }, // Read/Display Texture (Made visible to fragment)
                { binding: 4, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, texture: {} }, // Depth Texture (Made visible to fragment)
                { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } }, // Write Texture
                { binding: 6, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } },
            ]
        });

        const displayShaderModule = this.device.createShaderModule({ code: `
            @group(0) @binding(0) var u_sampler: sampler;
            @group(0) @binding(3) var u_texture: texture_2d<f32>; // Display from binding 3
            @vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
                let pos = array<vec2<f32>, 4>(vec2(-1, 1), vec2(1, 1), vec2(-1, -1), vec2(1, -1));
                return vec4(pos[i], 0, 1);
            }
            @fragment fn fs_main(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
                return textureSample(u_texture, u_sampler, p.xy * vec2(0.5, -0.5) + 0.5);
            }`
        });

        this.displayPipeline = await this.device.createRenderPipelineAsync({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.universalBindGroupLayout] }),
            vertex: { module: displayShaderModule, entryPoint: 'vs_main' },
            fragment: { module: displayShaderModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
            primitive: { topology: 'triangle-strip' },
        });

        this.createOrUpdateBindGroups();
    }
    
    public async loadEffect(shaderUrl: string): Promise<void> {
        this.activePipeline = null;
        try {
            const shaderCode = await fetch(shaderUrl).then(res => res.text());
            const shaderModule = this.device.createShaderModule({ code: shaderCode });
            this.activePipeline = await this.device.createComputePipelineAsync({
                layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.universalBindGroupLayout] }),
                compute: { module: shaderModule, entryPoint: 'main' }
            });
            console.log(`Successfully loaded compute effect: ${shaderUrl}`);
        } catch (e) {
            console.error(`Failed to load shader:`, e);
        }
    }

    private createOrUpdateBindGroups(): void {
        const commonEntries = [
            { binding: 0, resource: this.linearSampler },
            { binding: 1, resource: { buffer: this.uniformBuffer } },
            { binding: 2, resource: this.primaryTexture.createView() },
            { binding: 4, resource: this.depthTexture.createView() },
            { binding: 6, resource: this.nearestSampler },
        ];

        this.computeBindGroupA = this.device.createBindGroup({
            layout: this.universalBindGroupLayout,
            entries: [ ...commonEntries,
                { binding: 3, resource: this.stateTextureA.createView() }, // Read
                { binding: 5, resource: this.stateTextureB.createView() }, // Write
            ],
        });

        this.computeBindGroupB = this.device.createBindGroup({
            layout: this.universalBindGroupLayout,
            entries: [ ...commonEntries,
                { binding: 3, resource: this.stateTextureB.createView() }, // Read
                { binding: 5, resource: this.stateTextureA.createView() }, // Write
            ],
        });
        
        this.displayBindGroupA = this.device.createBindGroup({
            layout: this.universalBindGroupLayout,
            entries: [ ...commonEntries,
                { binding: 3, resource: this.stateTextureA.createView() },
                { binding: 5, resource: this.stateTextureB.createView() },
            ],
        });

        this.displayBindGroupB = this.device.createBindGroup({
            layout: this.universalBindGroupLayout,
            entries: [ ...commonEntries,
                { binding: 3, resource: this.stateTextureB.createView() },
                { binding: 5, resource: this.stateTextureA.createView() },
            ],
        });
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
        try {
            if (this.imageUrls.length === 0) return;
            const imageUrl = this.imageUrls[Math.floor(Math.random() * this.imageUrls.length)];
            const response = await fetch(imageUrl);
            const imageBitmap = await createImageBitmap(await response.blob());
            
            if(this.primaryTexture) this.primaryTexture.destroy();
            this.primaryTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.primaryTexture }, [imageBitmap.width, imageBitmap.height]);

            const commandEncoder = this.device.createCommandEncoder();
            commandEncoder.copyTextureToTexture(
                { texture: this.primaryTexture },
                { texture: this.stateTextureA },
                [imageBitmap.width, imageBitmap.height]
            );
            this.device.queue.submit([commandEncoder.finish()]);

            this.createOrUpdateBindGroups();
            return imageUrl;
        } catch (e) {
            console.error("Failed to load image:", e);
            return undefined;
        }
    }
    
    public updateUniforms(values: Float32Array, offset: number = 0) { this.uniforms.set(values, offset); }
    public addRipplePoint(x: number, y: number) {
        this.ripplePoints.push({ x, y, startTime: performance.now() / 1000.0 });
        if (this.ripplePoints.length > this.MAX_RIPPLES) this.ripplePoints.shift();
    }

    public updateDepthMap(data: Float32Array, width: number, height: number): void {
        if (this.depthTexture) this.depthTexture.destroy();
        this.depthTexture = this.device.createTexture({
            size: [width, height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        this.device.queue.writeTexture( { texture: this.depthTexture }, data, { bytesPerRow: width * 4 }, [width, height]);
        this.createOrUpdateBindGroups();
    }
    
    public render(): void {
        if (!this.activePipeline) return;

        const currentTime = performance.now() / 1000.0;
        this.uniforms[0] = currentTime;
        this.uniforms[4] = this.canvas.width;
        this.uniforms[5] = this.canvas.height;
        this.ripplePoints = this.ripplePoints.filter(p => (currentTime - p.startTime) < 4.0);
        this.uniforms[10] = this.ripplePoints.length; 
        const rippleData = new Float32Array(this.MAX_RIPPLES * 4);
        this.ripplePoints.forEach((p, i) => rippleData.set([p.x, p.y, p.startTime], i * 4));
        this.uniforms.set(rippleData, 12);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);

        const commandEncoder = this.device.createCommandEncoder();
        
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.activePipeline);
        if (this.frameCount % 2 === 0) {
            computePass.setBindGroup(0, this.computeBindGroupA); // Reads A, Writes B
        } else {
            computePass.setBindGroup(0, this.computeBindGroupB); // Reads B, Writes A
        }
        computePass.dispatchWorkgroups(Math.ceil(this.canvas.width / 8), Math.ceil(this.canvas.height / 8));
        computePass.end();

        const textureView = this.context.getCurrentTexture().createView();
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{ view: textureView, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,1] }]
        });
        renderPass.setPipeline(this.displayPipeline);
        if (this.frameCount % 2 === 0) {
            renderPass.setBindGroup(0, this.displayBindGroupB); // Display B
        } else {
            renderPass.setBindGroup(0, this.displayBindGroupA); // Display A
        }
        renderPass.draw(4);
        renderPass.end();
        
        this.device.queue.submit([commandEncoder.finish()]);
        this.frameCount++;
    }
}
