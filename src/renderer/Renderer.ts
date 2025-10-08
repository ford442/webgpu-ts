import { RenderMode } from './types';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();
    private sampler!: GPUSampler;
    private nonFilteringSampler!: GPUSampler; 
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

    private depthTextureRead!: GPUTexture;
    private depthTextureWrite!: GPUTexture;

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public addRipplePoint(x: number, y: number) {
        this.ripplePoints.push({ x, y, startTime: performance.now() / 1000.0 });
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
        format: 'rgba16float',
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
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nonFilteringSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

        this.galaxyUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.imageVideoUniformBuffer = this.device.createBuffer({ size: 32 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v1ComputeUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        
        this.v2ComputeUniformBuffer = this.device.createBuffer({ size: 32 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    
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
            format: 'rgba16float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });

        await this.loadRandomImage();
    }

private async createPipelines(): Promise<void> {
    const [galaxyCode, imageVideoCode, liquidV1Code, liquidCode, liquidZoomCode, textureCode, liquidPerspectiveCode] = await Promise.all([ // MODIFIED
        fetch('shaders/galaxy.wgsl').then(res => res.text()),
        fetch('shaders/imageVideo.wgsl').then(res => res.text()),
        fetch('shaders/liquid-v1.wgsl').then(res => res.text()),
        fetch('shaders/liquid.wgsl').then(res => res.text()),
        fetch('shaders/liquid-zoom.wgsl').then(res => res.text()),
        fetch('shaders/texture.wgsl').then(res => res.text()),
        fetch('shaders/liquid-perspective.wgsl').then(res => res.text()), // MODIFIED: Added this line
    ]);

    const galaxyModule = this.device.createShaderModule({ code: galaxyCode });
    const imageVideoModule = this.device.createShaderModule({ code: imageVideoCode });
    const liquidV1Module = this.device.createShaderModule({ code: liquidV1Code });
    const liquidModule = this.device.createShaderModule({ code: liquidCode });
    const liquidZoomModule = this.device.createShaderModule({ code: liquidZoomCode });
    const textureModule = this.device.createShaderModule({ code: textureCode });
    const liquidPerspectiveModule = this.device.createShaderModule({ code: liquidPerspectiveCode }); // MODIFIED: Added this line

        const commonConfig = { vertex: { module: imageVideoModule, entryPoint: 'vs_main' }, fragment: { targets: [{ format: this.presentationFormat }] }, primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology } };
        this.pipelines.set('galaxy', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, vertex: { module: galaxyModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: galaxyModule, entryPoint: 'fs_main' }, primitive: { topology: 'triangle-list' as GPUPrimitiveTopology } }));
        this.pipelines.set('imageVideo', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, fragment: { ...commonConfig.fragment, module: imageVideoModule, entryPoint: 'fs_main' } }));
        this.pipelines.set('liquid', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, vertex: { module: textureModule, entryPoint: 'vs_main' }, fragment: { ...commonConfig.fragment, module: textureModule, entryPoint: 'fs_main' } }));
        this.pipelines.set('computeV1', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidV1Module, entryPoint: 'main' } }));
        this.pipelines.set('compute', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidModule, entryPoint: 'main' } }));
        this.pipelines.set('computeZoom', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidZoomModule, entryPoint: 'main' } }));
        this.pipelines.set('computePerspective', this.device.createComputePipeline({ layout: 'auto', compute: { module: liquidPerspectiveModule, entryPoint: 'main' } }));
}

   private createBindGroups(): void {
    if (!this.imageTexture || !this.nonFilteringSampler || !this.depthTextureRead || !this.depthTextureWrite) return;

    if (this.videoTexture) {
        this.bindGroups.set('galaxy', this.device.createBindGroup({ layout: this.pipelines.get('galaxy')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.galaxyUniformBuffer } }, { binding: 1, resource: this.sampler }, { binding: 2, resource: this.videoTexture.createView() }] }));
        this.bindGroups.set('video', this.device.createBindGroup({ layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.videoTexture.createView() }, { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }] }));
    }

    this.bindGroups.set('image', this.device.createBindGroup({ layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.imageTexture.createView() }, { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }] }));
    this.bindGroups.set('liquid', this.device.createBindGroup({ layout: this.pipelines.get('liquid')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.writeTexture.createView() }] }));
    this.bindGroups.set('computeV1', this.device.createBindGroup({ 
        layout: this.pipelines.get('computeV1')!.getBindGroupLayout(0), 
        entries: [
            { binding: 0, resource: this.sampler }, 
            { binding: 1, resource: this.imageTexture.createView() }, 
            { binding: 2, resource: this.writeTexture.createView() },
            { binding: 3, resource: { buffer: this.v1ComputeUniformBuffer } }
        ] 
    }));

    const computeLayout = this.pipelines.get('compute')!.getBindGroupLayout(0);
    const computeEntries = [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.imageTexture.createView() },
        { binding: 2, resource: this.writeTexture.createView() },
        { binding: 3, resource: { buffer: this.v2ComputeUniformBuffer } },
        { binding: 4, resource: this.depthTextureRead.createView() },
        { binding: 5, resource: this.nonFilteringSampler },
        { binding: 6, resource: this.depthTextureWrite.createView() },
    ];
    this.bindGroups.set('compute', this.device.createBindGroup({ layout: computeLayout, entries: computeEntries }));

    const computeZoomPipeline = this.pipelines.get('computeZoom');
    if (computeZoomPipeline) {
        this.bindGroups.set('computeZoom', this.device.createBindGroup({
            layout: computeZoomPipeline.getBindGroupLayout(0),
            entries: computeEntries
        }));
    }

    const computePerspectivePipeline = this.pipelines.get('computePerspective');
    if (computePerspectivePipeline) {
        this.bindGroups.set('computePerspective', this.device.createBindGroup({
            layout: computePerspectivePipeline.getBindGroupLayout(0),
            entries: computeEntries
        }));
    }
}
    
    private swapDepthTextures() {
        const temp = this.depthTextureRead;
        this.depthTextureRead = this.depthTextureWrite;
        this.depthTextureWrite = temp;
    }

    public render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number, farthestPoint: { x: number, y: number }): void {
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

        if (mode.startsWith('liquid')) {
            this.createBindGroups();

            const computePass = commandEncoder.beginComputePass();
            const computeV1BG = this.bindGroups.get('computeV1');
            const computeBG = this.bindGroups.get('compute');
            const computeZoomBG = this.bindGroups.get('computeZoom');
            const computePerspectiveBG = this.bindGroups.get('computePerspective'); // MODIFIED: Added this line

            if (mode === 'liquid-v1' && computeV1BG) {
                this.device.queue.writeBuffer(this.v1ComputeUniformBuffer, 0, new Float32Array([currentTime, this.canvas.width, this.canvas.height]));
                computePass.setPipeline(this.pipelines.get('computeV1') as GPUComputePipeline);
                computePass.setBindGroup(0, computeV1BG);
                computePass.dispatchWorkgroups(this.canvas.width / 8, this.canvas.height / 8, 1);
            } else if ((mode === 'liquid' || mode === 'liquid-zoom' || mode === 'liquid-vortex' || mode === 'liquid-perspective') && computeBG) { // MODIFIED
                this.ripplePoints = this.ripplePoints.filter(p => (currentTime - p.startTime) < 4.0);
                if (this.ripplePoints.length > this.MAX_RIPPLES) this.ripplePoints.splice(0, this.ripplePoints.length - this.MAX_RIPPLES);
                const computeUniformArray = new Float32Array(8 + this.MAX_RIPPLES * 4);
                computeUniformArray.set([currentTime, this.ripplePoints.length, this.canvas.width, this.canvas.height], 0);
                // --- MODIFIED: Start of changes ---
                // Write zoomTime and the farthest point coordinates
                computeUniformArray.set([currentTime, farthestPoint.x, 0.5, 0], 4);
                // --- MODIFIED: End of changes ---
                const rippleData = new Float32Array(this.MAX_RIPPLES * 4);
                for (let i = 0; i < this.ripplePoints.length; i++) {
                    const point = this.ripplePoints[i];
                    rippleData.set([point.x, point.y, point.startTime], i * 4);
                }
                computeUniformArray.set(rippleData, 8);
                this.device.queue.writeBuffer(this.v2ComputeUniformBuffer, 0, computeUniformArray);
                
                if ((mode === 'liquid-zoom' || mode === 'liquid-vortex') && computeZoomBG) {
                    computePass.setPipeline(this.pipelines.get('computeZoom') as GPUComputePipeline);
                    computePass.setBindGroup(0, computeZoomBG);
                } else if (mode === 'liquid-perspective' && computePerspectiveBG) { // MODIFIED: Added this else if block
                    computePass.setPipeline(this.pipelines.get('computePerspective') as GPUComputePipeline);
                    computePass.setBindGroup(0, computePerspectiveBG);
                } else {
                    computePass.setPipeline(this.pipelines.get('compute') as GPUComputePipeline);
                    computePass.setBindGroup(0, computeBG);
                }
                computePass.dispatchWorkgroups(this.canvas.width / 8, this.canvas.height / 8, 1);
            }
            computePass.end();
            if (mode === 'liquid' || mode === 'liquid-zoom' || mode === 'liquid-vortex' || mode === 'liquid-perspective') { // MODIFIED
                this.swapDepthTextures();
            }
        }

        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: textureView, clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        const liquidPipeline = this.pipelines.get('liquid') as GPURenderPipeline;
        const imageVideoPipeline = this.pipelines.get('imageVideo') as GPURenderPipeline;
        const galaxyPipeline = this.pipelines.get('galaxy') as GPURenderPipeline;

        const computePerspectivePipeline = this.pipelines.get('computePerspective');
        if (computePerspectivePipeline) {
            this.bindGroups.set('computePerspective', this.device.createBindGroup({
            layout: computePerspectivePipeline.getBindGroupLayout(0),
            entries: computeEntries
            }));
        }
        
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
            case 'liquid-perspective': // MODIFIED: Added this line
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
