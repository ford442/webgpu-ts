/**
 * A modular WebGPU renderer that can load and run shader effects dynamically.
 * It uses a standardized binding layout to decouple the renderer from the shaders.
 */
export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;

    // --- Core Modular Components ---
    private activePipeline: GPURenderPipeline | GPUComputePipeline | null = null;
    private displayPipeline!: GPURenderPipeline; // A simple pipeline to display the output of compute shaders
    private universalBindGroupLayout!: GPUBindGroupLayout;
    private universalBindGroup!: GPUBindGroup;
    private uniformBuffer!: GPUBuffer;

    // --- Universal Resources ---
    private primaryTexture!: GPUTexture;   // The main input image/video
    private utilityTexture1!: GPUTexture;  // For data like depth maps
    private utilityTexture2!: GPUTexture;  // For ping-ponging or other data
    private storageTexture!: GPUTexture;   // Writable texture for compute shaders
    private linearSampler!: GPUSampler;
    private nearestSampler!: GPUSampler;

    // --- State & Parameters ---
    private imageUrls: string[] = [];
    private uniforms = new Float32Array(64); // A large, generic array for shader parameters
    private isComputeEffect: boolean = false;
    private frameCount = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    /**
     * Initializes the WebGPU device, context, and all universal resources.
     */
    public async init(): Promise<boolean> {
        if (!navigator.gpu) {
            console.error("WebGPU not supported on this browser.");
            return false;
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.error("Failed to get GPU adapter.");
            return false;
        }

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
        await this.loadRandomImage(); // Load an initial image

        return true;
    }

    /**
     * Creates all the long-lived resources that any shader can use.
     */
    private async createUniversalResources(): Promise<void> {
        // Create a single, large uniform buffer for all shader parameters.
        this.uniformBuffer = this.device.createBuffer({
            size: this.uniforms.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create standard samplers.
        this.linearSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nearestSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

        // Create placeholder textures. These will be replaced by actual data later.
        const placeholder = { size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING };
        this.primaryTexture = this.device.createTexture(placeholder);
        this.utilityTexture1 = this.device.createTexture(placeholder);
        this.utilityTexture2 = this.device.createTexture(placeholder);

        // The storage texture needs to be sized to the canvas.
        this.storageTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'rgba8unorm', // A common format for storage textures
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        
        // Define the standardized layout that all shaders MUST follow.
        this.universalBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} },
                { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} },
                { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: {} },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
            ]
        });

        // Create a simple pipeline just to draw the result of a compute shader to the screen.
        const displayShaderModule = this.device.createShaderModule({
            code: `
                @group(0) @binding(0) var u_sampler: sampler;
                @group(0) @binding(2) var u_texture: texture_2d<f32>; // Samples from the storage texture

                @vertex
                fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
                    let x = f32((in_vertex_index & 1u) * 2u) - 1.0;
                    let y = f32((in_vertex_index & 2u)) - 1.0;
                    return vec4<f32>(x, -y, 0.0, 1.0);
                }

                @fragment
                fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
                    return textureSample(u_texture, u_sampler, position.xy * 0.5 + 0.5);
                }
            `,
        });
        this.displayPipeline = await this.device.createRenderPipelineAsync({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.universalBindGroupLayout] }),
            vertex: { module: displayShaderModule, entryPoint: 'vs_main' },
            fragment: { module: displayShaderModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
            primitive: { topology: 'triangle-strip' },
        });

        // Create the initial bind group with placeholder textures.
        this.createOrUpdateBindGroup();
    }
    
    /**
     * Dynamically loads a shader, creates a pipeline, and sets it as the active effect.
     * @param shaderUrl The URL of the .wgsl file to load.
     * @param effectType Whether this is a 'render' or 'compute' effect.
     */
    public async loadEffect(shaderUrl: string, effectType: 'render' | 'compute'): Promise<void> {
        this.activePipeline = null;
        try {
            const shaderCode = await fetch(shaderUrl).then(res => res.text());
            const shaderModule = this.device.createShaderModule({ code: shaderCode });
            const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.universalBindGroupLayout] });

            if (effectType === 'render') {
                this.activePipeline = await this.device.createRenderPipelineAsync({
                    layout,
                    vertex: { module: shaderModule, entryPoint: 'vs_main' },
                    fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
                    primitive: { topology: 'triangle-strip' }
                });
                this.isComputeEffect = false;
            } else { // 'compute'
                this.activePipeline = await this.device.createComputePipelineAsync({
                    layout,
                    compute: { module: shaderModule, entryPoint: 'main' }
                });
                this.isComputeEffect = true;
            }
            console.log(`Successfully loaded ${effectType} effect: ${shaderUrl}`);
        } catch (e) {
            console.error(`Failed to load shader from ${shaderUrl}:`, e);
        }
    }
    
public addRipplePoint(x: number, y: number) {
        this.ripplePoints.push({ x, y, startTime: performance.now() / 1000.0 });
        if (this.ripplePoints.length > this.MAX_RIPPLES) {
            this.ripplePoints.shift(); // Remove the oldest ripple
        }
    }
    
    /**
     * Assembles the universal bind group from the current state of the resources.
     * This should be called whenever a key texture (like primaryTexture) is replaced.
     */
    private createOrUpdateBindGroup(): void {
        this.universalBindGroup = this.device.createBindGroup({
            layout: this.universalBindGroupLayout,
            entries: [
                { binding: 0, resource: this.linearSampler },
                { binding: 1, resource: { buffer: this.uniformBuffer } },
                { binding: 2, resource: this.primaryTexture.createView() },
                { binding: 3, resource: this.utilityTexture1.createView() },
                { binding: 4, resource: this.utilityTexture2.createView() },
                { binding: 5, resource: this.storageTexture.createView() },
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
    
    /**
     * Loads a new primary image, creates a texture, and updates the bind group.
     */
    public async loadRandomImage(): Promise<string | undefined> {
        // ... (fetchImageUrls logic remains the same)
        try {
            if (this.imageUrls.length === 0) return;
            const imageUrl = this.imageUrls[Math.floor(Math.random() * this.imageUrls.length)];
            const response = await fetch(imageUrl);
            const imageBitmap = await createImageBitmap(await response.blob());

            if (this.primaryTexture) this.primaryTexture.destroy();
            this.primaryTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.primaryTexture }, [imageBitmap.width, imageBitmap.height]);
            
            // Crucially, we update the bind group so the new texture is used.
            this.createOrUpdateBindGroup();
            return imageUrl;
        } catch (e) {
            console.error("Failed to load image:", e);
            return undefined;
        }
    }
    
    /**
     * Updates a specific range of the uniform buffer.
     * @param values The Float32Array of values to write.
     * @param offset The starting index (not byte offset) in the uniform array.
     */
    public updateUniforms(values: Float32Array, offset: number = 0) {
        this.uniforms.set(values, offset);
    }

    public updateDepthMap(data: Float32Array, width: number, height: number): void {
        if (!this.device) return;
        if (this.depthTextureRead && (this.depthTextureRead.width !== width || this.depthTextureRead.height !== height)) {
            this.depthTextureRead.destroy();
            this.depthTextureWrite.destroy();
        }
        if (!this.depthTextureRead || this.depthTextureRead.width !== width || this.depthTextureRead.height !== height) {
            const depthTextureDescriptor: GPUTextureDescriptor = {
                size: [width, height],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
            };
            this.depthTextureRead = this.device.createTexture(depthTextureDescriptor);
            this.depthTextureWrite = this.device.createTexture(depthTextureDescriptor);
        }
        this.device.queue.writeTexture({ texture: this.depthTextureRead }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
        this.device.queue.writeTexture({ texture: this.depthTextureWrite }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
        this.createBindGroups();
    }
    
    /**
     * The main render loop, called every frame.
     */
    public render(): void {
        if (!this.device || !this.activePipeline || !this.universalBindGroup) return;

        const currentTime = performance.now() / 1000.0;
        
        // --- Update Uniforms ---
        this.uniforms[0] = currentTime; // time
        
        // --- Ripple Data Logic ---
        // Filter out old ripples
        this.ripplePoints = this.ripplePoints.filter(p => (currentTime - p.startTime) < 4.0);
        this.uniforms[10] = this.ripplePoints.length; // Store ripple count at index 10
        
        const rippleData = new Float32Array(this.MAX_RIPPLES * 4);
        this.ripplePoints.forEach((p, i) => {
            rippleData.set([p.x, p.y, p.startTime], i * 4);
        });
        
        // Write ripple data to a specific part of the uniform buffer
        this.uniforms.set(rippleData, 12); // Start writing at index 12

        // Write all uniform data to the GPU
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);

        const commandEncoder = this.device.createCommandEncoder();

        if (this.isComputeEffect) {
            // --- COMPUTE PASS ---
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(this.activePipeline as GPUComputePipeline);
            computePass.setBindGroup(0, this.universalBindGroup);
            // Dynamic dispatch size based on canvas/texture dimensions
            const workgroupSize = 8; // Assuming 8x8 workgroups in WGSL
            computePass.dispatchWorkgroups(
                Math.ceil(this.canvas.width / workgroupSize),
                Math.ceil(this.canvas.height / workgroupSize)
            );
            computePass.end();

            // --- RENDER PASS (to display compute result) ---
            const textureView = this.context.getCurrentTexture().createView();
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{ view: textureView, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,1] }]
            });
            renderPass.setPipeline(this.displayPipeline);
            // We need a specific bind group for the display shader
            // that correctly binds the storageTexture to binding 2 for sampling.
            const displayBindGroup = this.device.createBindGroup({
                layout: this.universalBindGroupLayout,
                entries: [
                    { binding: 0, resource: this.linearSampler },
                    { binding: 1, resource: { buffer: this.uniformBuffer } },
                    { binding: 2, resource: this.storageTexture.createView() }, // The key difference!
                    { binding: 3, resource: this.utilityTexture1.createView() },
                    { binding: 4, resource: this.utilityTexture2.createView() },
                    { binding: 5, resource: this.storageTexture.createView() },
                ],
            });
            renderPass.setBindGroup(0, displayBindGroup);
            renderPass.draw(4);
            renderPass.end();

        } else {
            // --- RENDER PASS (for fragment shader effects) ---
            const textureView = this.context.getCurrentTexture().createView();
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{ view: textureView, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,1] }]
            });
            renderPass.setPipeline(this.activePipeline as GPURenderPipeline);
            renderPass.setBindGroup(0, this.universalBindGroup);
            renderPass.draw(4); // Draw a full-screen quad
            renderPass.end();
        }

        this.device.queue.submit([commandEncoder.finish()]);
        this.frameCount++;
    }

}
