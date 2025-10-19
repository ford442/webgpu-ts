import { RenderMode } from './types';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();
    private filteringSampler!: GPUSampler;
    private nonFilteringSampler!: GPUSampler;
    private imageUrls: string[] = [];
    private ripplePoints: { x: number, y: number, startTime: number }[] = [];
    private MAX_RIPPLES = 50;
    private computeUniformBuffer!: GPUBuffer; // Renamed from v2ComputeUniformBuffer
    private imageVideoUniformBuffer!: GPUBuffer;
    private galaxyUniformBuffer!: GPUBuffer;
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;
    private depthTextureRead!: GPUTexture;
    private depthTextureWrite!: GPUTexture;
    private dataTexture!: GPUTexture; // ADDED
    private extraBuffer!: GPUBuffer; // ADDED
    private fgSpeed: number = 0.05;
    private bgSpeed: number = 0.01;
    private parallaxStrength: number = 2.0;
    private fogDensity: number = 0.7;
    private shaderBaseUrl: string = 'https://glsl.1ink.us/effects/';
    
    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public addRipplePoint(x: number, y: number) {
        this.ripplePoints.push({ x, y, startTime: performance.now() / 1000.0 });
    }
    
    public updateZoomParams(params: { 
        fgSpeed?: number, 
        bgSpeed?: number, 
        parallaxStrength?: number, 
        fogDensity?: number 
    }): void {
        if (params.fgSpeed !== undefined) this.fgSpeed = params.fgSpeed;
        if (params.bgSpeed !== undefined) this.bgSpeed = params.bgSpeed;
        if (params.parallaxStrength !== undefined) this.parallaxStrength = params.parallaxStrength;
        if (params.fogDensity !== undefined) this.fogDensity = params.fogDensity;
    }
    
    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        const requiredFeatures: GPUFeatureName[] = [];
        if (adapter.features.has('float32-filterable')) {
            requiredFeatures.push('float32-filterable');
        } else {
            console.log("Device does not support 'float32-filterable', using two-sampler workaround.");
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
            if (this.imageTexture) this.imageTexture.destroy();
            this.imageTexture = this.device.createTexture({
                size: [imageBitmap.width, imageBitmap.height],
                format: 'rgba32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
            });
            this.device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: this.imageTexture }, [imageBitmap.width, imageBitmap.height]);
            this.createBindGroups();
            return imageUrl;
        } catch (e) {
            console.error("Failed to load image:", e);
            return undefined;
        }
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

    private async createResources(): Promise<void> {
        const { width, height } = this.canvas;
        this.filteringSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });
        this.nonFilteringSampler = this.device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });
        this.galaxyUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.imageVideoUniformBuffer = this.device.createBuffer({ size: 32 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.computeUniformBuffer = this.device.createBuffer({ 
            size: 48 + (this.MAX_RIPPLES * 16), // 3*vec4 + 50*vec4 = 848 bytes
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
        });
        const placeholderDepthDescriptor: GPUTextureDescriptor = {
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
        };
        this.depthTextureRead = this.device.createTexture(placeholderDepthDescriptor);
        this.depthTextureWrite = this.device.createTexture(placeholderDepthDescriptor);
        this.device.queue.writeTexture({ texture: this.depthTextureRead }, new Float32Array([0.0]), { bytesPerRow: 4 }, [1, 1]);
        this.device.queue.writeTexture({ texture: this.depthTextureWrite }, new Float32Array([0.0]), { bytesPerRow: 4 }, [1, 1]);
        this.writeTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba32float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.dataTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba32float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        // Create a 1KB storage buffer as an example
        const initialExtraData = new Float32Array(256); // 256 floats * 4 bytes/float = 1024 bytes
        this.extraBuffer = this.device.createBuffer({
            size: initialExtraData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Float32Array(this.extraBuffer.getMappedRange()).set(initialExtraData);
        this.extraBuffer.unmap();
        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> {
        const shaderNames = [
            'galaxy.wgsl', 'imageVideo.wgsl', 'liquid-v1.wgsl', 'liquid.wgsl',
            'liquid-zoom.wgsl', 'texture.wgsl', 'liquid-perspective.wgsl', 'vortex.wgsl'
        ];

        const shaderCodes = await Promise.all(
            shaderNames.map(name => fetch(`${this.shaderBaseUrl}${name}`).then(res => res.text()))
        );

        const [galaxyCode, imageVideoCode, liquidV1Code, liquidCode, liquidZoomCode, textureCode, liquidPerspectiveCode, vortexCode] = shaderCodes;

        const galaxyModule = this.device.createShaderModule({ code: galaxyCode });
        const imageVideoModule = this.device.createShaderModule({ code: imageVideoCode });
        const liquidV1Module = this.device.createShaderModule({ code: liquidV1Code });
        const liquidModule = this.device.createShaderModule({ code: liquidCode });
        const liquidZoomModule = this.device.createShaderModule({ code: liquidZoomCode });
        const textureModule = this.device.createShaderModule({ code: textureCode });
        const liquidPerspectiveModule = this.device.createShaderModule({ code: liquidPerspectiveCode });
        const vortexModule = this.device.createShaderModule({ code: vortexCode });
        const commonConfig = { vertex: { module: imageVideoModule, entryPoint: 'vs_main' }, fragment: { targets: [{ format: this.presentationFormat }] }, primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology } };
        
        const [
            galaxyPipeline, imageVideoPipeline, liquidPipeline,
            computeV1, compute, computeZoom,
            computePerspective, computeVortex
        ] = await Promise.all([
            this.device.createRenderPipelineAsync({ layout: 'auto', ...commonConfig, vertex: { module: galaxyModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: galaxyModule, entryPoint: 'fs_main' }, primitive: { topology: 'triangle-list' as GPUPrimitiveTopology } }),
            this.device.createRenderPipelineAsync({ layout: 'auto', ...commonConfig, fragment: { ...commonConfig.fragment, module: imageVideoModule, entryPoint: 'fs_main' } }),
            this.device.createRenderPipelineAsync({ layout: 'auto', ...commonConfig, vertex: { module: textureModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: textureModule, entryPoint: 'fs_main' } }),
            this.device.createComputePipelineAsync({ layout: computePipelineLayout, compute: { module: liquidV1Module, entryPoint: 'main' } }),
            this.device.createComputePipelineAsync({ layout: computePipelineLayout, compute: { module: liquidModule, entryPoint: 'main' } }),
            this.device.createComputePipelineAsync({ layout: computePipelineLayout, compute: { module: liquidZoomModule, entryPoint: 'main' } }),
            this.device.createComputePipelineAsync({ layout: computePipelineLayout, compute: { module: liquidPerspectiveModule, entryPoint: 'main' } }),
            this.device.createComputePipelineAsync({ layout: computePipelineLayout, compute: { module: vortexModule, entryPoint: 'main' } })
        ]);

        this.pipelines.set('galaxy', galaxyPipeline);
        this.pipelines.set('imageVideo', imageVideoPipeline);
        this.pipelines.set('liquid', liquidPipeline);
        this.pipelines.set('computeV1', computeV1);
        this.pipelines.set('compute', compute);
        this.pipelines.set('computeZoom', computeZoom);
        this.pipelines.set('computePerspective', computePerspective);
        this.pipelines.set('computeVortex', computeVortex);
    }

    private createBindGroups(): void {
if (!this.imageTexture || !this.nonFilteringSampler || !this.depthTextureRead || !this.depthTextureWrite || !this.dataTexture || !this.extraBuffer || !this.computeUniformBuffer) return;
        if (this.videoTexture) {
            this.bindGroups.set('galaxy', this.device.createBindGroup({ layout: this.pipelines.get('galaxy')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.galaxyUniformBuffer } }, { binding: 1, resource: this.filteringSampler }, { binding: 2, resource: this.videoTexture.createView() }] }));
            this.bindGroups.set('video', this.device.createBindGroup({ layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.filteringSampler }, { binding: 1, resource: this.videoTexture.createView() }, { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }] }));
        }
        this.bindGroups.set('image', this.device.createBindGroup({ layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.filteringSampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }] }));
        this.bindGroups.set('liquid', this.device.createBindGroup({ layout: this.pipelines.get('liquid')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.filteringSampler }, { binding: 1, resource: this.writeTexture.createView() }] }));
       const computePipeline = this.pipelines.get('compute'); // Get any compute pipeline
        if (!computePipeline) return; // Pipelines not ready
        
        const computeBindGroup = this.device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0), // Get layout from any
            entries: [
                { binding: 0, resource: this.filteringSampler },
                { binding: 1, resource: this.imageTexture.createView() },
                { binding: 2, resource: this.writeTexture.createView() },
                { binding: 3, resource: { buffer: this.computeUniformBuffer } }, // The new unified buffer
                { binding: 4, resource: this.depthTextureRead.createView() },
                { binding: 5, resource: this.nonFilteringSampler },
                { binding: 6, resource: this.depthTextureWrite.createView() },
                { binding: 7, resource: this.dataTexture.createView() }, // New
                { binding: 8, resource: { buffer: this.extraBuffer } }, // New
            ],
        });
        
        this.bindGroups.set('compute', computeBindGroup);
        
        const computeZoomPipeline = this.pipelines.get('computeZoom');
        if (computeZoomPipeline) {
            // THIS IS THE FIX: Filter out binding 0 specifically for the zoom shader.
            const computeZoomEntries = computeEntries.filter(entry => entry.binding !== 0);
            this.bindGroups.set('computeZoom', this.device.createBindGroup({
                layout: computeZoomPipeline.getBindGroupLayout(0),
                entries: computeZoomEntries
            }));
        }

        const computePerspectivePipeline = this.pipelines.get('computePerspective');
        if (computePerspectivePipeline) {
            this.bindGroups.set('computePerspective', this.device.createBindGroup({
                layout: computePerspectivePipeline.getBindGroupLayout(0),
                entries: computeEntries
            }));
        }

        const computeVortexPipeline = this.pipelines.get('computeVortex');
        if (computeVortexPipeline) {
            this.bindGroups.set('computeVortex', this.device.createBindGroup({
                layout: computeVortexPipeline.getBindGroupLayout(0),
                entries: computeEntries
            }));
        }
    }

    private swapDepthTextures() {
        const temp = this.depthTextureRead;
        this.depthTextureRead = this.depthTextureWrite;
        this.depthTextureWrite = temp;
    }

    public render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number, farthestPoint: { x: number, y: number }, mousePosition: { x: number, y: number }, isMouseDown: boolean): void {
        if (!this.device || !this.imageTexture) return;
        const currentTime = performance.now() / 1000.0;
        if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
            if (!this.videoTexture || this.videoTexture.width !== videoElement.videoWidth || this.videoTexture.height !== videoElement.videoHeight) {
                if (this.videoTexture) this.videoTexture.destroy();
                this.videoTexture = this.device.createTexture({ size: [videoElement.videoWidth, videoElement.videoHeight], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
                this.createBindGroups();
            }
            this.device.queue.copyExternalImageToTexture({ source: videoElement }, { texture: this.videoTexture }, [videoElement.videoWidth, videoElement.videoHeight]);
        }
        const commandEncoder = this.device.createCommandEncoder();
        if (mode.startsWith('liquid') || mode === 'vortex') {
            const computePass = commandEncoder.beginComputePass();
            const computeBG = this.bindGroups.get('compute'); // Get the ONE bind group

            if (computeBG) {
                // --- 1. Uniform Buffer Updates ---
                if (mode === 'liquid-v1') {
                    // liquid-v1 only needs config: [time, 0, resX, resY]
                    const configData = new Float32Array([
                        currentTime, 0, this.canvas.width, this.canvas.height
                    ]);
                    // Write only the first vec4 (16 bytes)
                    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, configData, 0, 4);
                } else {
                    // All other compute shaders use the full uniform struct
                    this.ripplePoints = this.ripplePoints.filter(p => (currentTime - p.startTime) < 4.0);
                    if (this.ripplePoints.length > this.MAX_RIPPLES) this.ripplePoints.splice(0, this.ripplePoints.length - this.MAX_RIPPLES);
                    
                    const rippleDataArr = new Float32Array(this.MAX_RIPPLES * 4);
                    for (let i = 0; i < this.ripplePoints.length; i++) {
                        const point = this.ripplePoints[i];
                        rippleDataArr.set([point.x, point.y, point.startTime], i * 4);
                    }
                    
                    // Create the full 848-byte array
                    const uniformArray = new Float32Array(12 + this.MAX_RIPPLES * 4);
                    
                    // config (offset 0)
                    uniformArray.set([currentTime, this.ripplePoints.length, this.canvas.width, this.canvas.height], 0);
                    
                    // zoom_config (offset 4)
                    uniformArray.set([currentTime, farthestPoint.x, farthestPoint.y, 0], 4);

                    // zoom_params (offset 8) - Use class properties
                    const zoomParams = new Float32Array([
                        this.fgSpeed,
                        this.bgSpeed,
                        this.parallaxStrength,
                        this.fogDensity
                    ]);
                    uniformArray.set(zoomParams, 8);
                    
                    // ripples (offset 12)
                    uniformArray.set(rippleDataArr, 12);

                    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, uniformArray);
                }

                // --- 2. Set Bind Group ONCE ---
                computePass.setBindGroup(0, computeBG);

                // --- 3. Switch Pipeline ---
                if (mode === 'liquid-v1') {
                    computePass.setPipeline(this.pipelines.get('computeV1') as GPUComputePipeline);
                } else if (mode === 'vortex') {
                    computePass.setPipeline(this.pipelines.get('computeVortex') as GPUComputePipeline);
                } else if (mode === 'liquid-zoom' || mode === 'liquid-vortex') {
                    computePass.setPipeline(this.pipelines.get('computeZoom') as GPUComputePipeline);
                } else if (mode === 'liquid-perspective') {
                    computePass.setPipeline(this.pipelines.get('computePerspective') as GPUComputePipeline);
                } else { // 'liquid'
                    computePass.setPipeline(this.pipelines.get('compute') as GPUComputePipeline);
                }
                
                // --- 4. Dispatch ---
                computePass.dispatchWorkgroups(this.canvas.width / 8, this.canvas.height / 8, 1);
            }
            computePass.end();

            // swapDepthTextures logic is unchanged
            if (mode === 'liquid' || mode === 'liquid-zoom' || mode === 'liquid-vortex' || mode === 'liquid-perspective' || mode === 'vortex') {
                this.swapDepthTextures();
            }
        }
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: textureView, clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        const liquidPipeline = this.pipelines.get('liquid') as GPURenderPipeline;
        const imageVideoPipeline = this.pipelines.get('imageVideo') as GPURenderPipeline;
        const galaxyPipeline = this.pipelines.get('galaxy') as GPURenderPipeline;
        switch (mode) {
            case 'shader':
                if (galaxyPipeline && this.bindGroups.has('galaxy')) {
                    this.device.queue.writeBuffer(this.galaxyUniformBuffer, 0, new Float32Array([currentTime, zoom, panX, panY]));
                    passEncoder.setPipeline(galaxyPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('galaxy')!);
                    passEncoder.draw(6);
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
            case 'video':
                if (imageVideoPipeline && this.bindGroups.has('video')) {
                    const uniformArray = new Float32Array(8);
                    uniformArray.set([this.canvas.width, this.canvas.height, this.videoTexture.width, this.videoTexture.height], 0);
                    uniformArray.set([currentTime, 0, 0, 0], 4);
                    this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, uniformArray);
                    passEncoder.setPipeline(imageVideoPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('video')!);
                    passEncoder.draw(4);
                }
                break;
            case 'liquid-v1':
            case 'liquid':
            case 'liquid-zoom':
            case 'liquid-vortex':
            case 'liquid-perspective':
            case 'vortex':
                if (liquidPipeline && this.bindGroups.has('liquid')) {
                    passEncoder.setPipeline(liquidPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('liquid')!);
                    passEncoder.draw(4);
                }
                break;
        }
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
