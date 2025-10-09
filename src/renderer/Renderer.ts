import { RenderMode } from './types';

const GRID_SIZE = 1024;

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
    private uniformBuffer!: GPUBuffer; // Combined uniform buffer
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture; // For compute shader
    private staticDepthTexture!: GPUTexture;
    public imageDimensions = { width: 1, height: 1 };
    
    // --- State for 3D Parallax Mode ---
    private mouseState = { x: 0.5, y: 0.5 };
    private cameraState = {
        rotationX: 0.5, rotationY: 0, zoom: 1.0,
        isDragging: false, lastMouseX: 0, lastMouseY: 0,
    };
    private parallaxParams = { displacementScale: 0.3, ambient: 0.3, smoothness: 1.0, pointSize: 3.0 };
    private blitPipeline!: GPURenderPipeline;

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    // --- New Public Methods for Parallax Control ---
    public updateParallaxParams(params: any) { this.parallaxParams = params; }
    public updateMouse(x: number, y: number, isDragging: boolean) {
        this.mouseState.x = x / this.canvas.width;
        this.mouseState.y = y / this.canvas.height;
        if (isDragging) {
            if (!this.cameraState.isDragging) {
                this.cameraState.isDragging = true;
                this.cameraState.lastMouseX = x; this.cameraState.lastMouseY = y;
            } else {
                const dx = x - this.cameraState.lastMouseX;
                const dy = y - this.cameraState.lastMouseY;
                this.cameraState.rotationY += dx * 0.01;
                this.cameraState.rotationX += dy * 0.01;
                this.cameraState.rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.cameraState.rotationX));
                this.cameraState.lastMouseX = x; this.cameraState.lastMouseY = y;
            }
        }
    }
    public stopMouseDrag() { this.cameraState.isDragging = false; }
    public updateZoom(deltaY: number) {
        this.cameraState.zoom += deltaY * 0.001;
        this.cameraState.zoom = Math.max(0.2, Math.min(5.0, this.cameraState.zoom));
    }
    
    private hexToRgb(hex: string): [number, number, number] {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [ parseInt(result[1], 16)/255, parseInt(result[2], 16)/255, parseInt(result[3], 16)/255 ] : [0,0,0];
    }
    
    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        const requiredFeatures: GPUFeatureName[] = [];
        if (adapter.features.has('float32-filterable')) requiredFeatures.push('float32-filterable');
        this.device = await adapter.requestDevice({ requiredFeatures });
        this.context = this.canvas.getContext('webgpu')!;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: this.device, format: this.presentationFormat, alphaMode: 'premultiplied' });
        await this.fetchImageUrls();
        await this.createResources();
        await this.createPipelines();
        return true;
    }

    private async createResources(): Promise<void> {
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
        this.nonFilteringSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
        this.uniformBuffer = this.device.createBuffer({
            size: 96, // Large enough for all modes
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const placeholderDesc: GPUTextureDescriptor = {
            size: [1, 1], format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        };
        this.staticDepthTexture = this.device.createTexture(placeholderDesc);
        this.device.queue.writeTexture({texture: this.staticDepthTexture}, new Float32Array([0.0]), {bytesPerRow: 4}, [1,1]);

        this.writeTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height], format: 'rgba16float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        await this.loadRandomImage();
    }
    
   private async createPipelines(): Promise<void> {
        const [zoomCode, textureCode, parallaxCode, blitCode] = await Promise.all([
            fetch('shaders/3d-zoom.wgsl').then(r => r.text()),
            fetch('shaders/texture.wgsl').then(r => r.text()),
            fetch('shaders/parallax.wgsl').then(r => r.text()),
            fetch('shaders/blit.wgsl').then(r => r.text()),
        ]);

        const zoomModule = this.device.createShaderModule({ code: zoomCode });
        const textureModule = this.device.createShaderModule({ code: textureCode });
        const parallaxModule = this.device.createShaderModule({ code: parallaxCode });
        const blitModule = this.device.createShaderModule({ code: blitCode });

        const presentPipelineDesc: GPURenderPipelineDescriptor = {
            layout: 'auto',
            vertex: { module: textureModule, entryPoint: 'vs_main' },
            fragment: { module: textureModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
            primitive: { topology: 'triangle-strip' },
        };
        this.pipelines.set('present', this.device.createRenderPipeline(presentPipelineDesc));
        this.pipelines.set('computeZoom', this.device.createComputePipeline({ layout: 'auto', compute: { module: zoomModule, entryPoint: 'main' } }));
        this.pipelines.set('3d-parallax', this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: parallaxModule, entryPoint: 'vs_main' },
            fragment: { module: parallaxModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
            primitive: { topology: 'triangle-strip' }
        }));

        this.blitPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: blitModule, entryPoint: 'vs_main' },
            fragment: { 
                module: blitModule, 
                entryPoint: 'fs_main', 
                targets: [{ format: 'rgba16float' as GPUTextureFormat }] 
            },
            primitive: { topology: 'triangle-strip' },
        });
    }

    public createBindGroups(): void {
        if (!this.imageTexture || !this.staticDepthTexture) return;

        // Bind group for compute shader (3d-zoom)
        const computeZoomPipeline = this.pipelines.get('computeZoom');
        if (computeZoomPipeline) {
            this.bindGroups.set('computeZoom', this.device.createBindGroup({
                layout: computeZoomPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: this.imageTexture.createView() },
                    { binding: 2, resource: this.writeTexture.createView() },
                    { binding: 3, resource: { buffer: this.uniformBuffer } },
                    { binding: 4, resource: this.nonFilteringSampler },
                    { binding: 5, resource: this.staticDepthTexture.createView() },
                ]
            }));
        }
        
        // Bind group for parallax render pipeline
        const parallaxPipeline = this.pipelines.get('3d-parallax');
        if(parallaxPipeline) {
            this.bindGroups.set('3d-parallax', this.device.createBindGroup({
                layout: parallaxPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: this.imageTexture.createView() },
                    { binding: 2, resource: this.staticDepthTexture.createView() },
                    { binding: 3, resource: { buffer: this.uniformBuffer } },
                ]
            }));
        }

        // Bind group for presenting the compute shader's output texture
        const presentPipeline = this.pipelines.get('present');
        if(presentPipeline) {
            this.bindGroups.set('present', this.device.createBindGroup({
                layout: presentPipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.writeTexture.createView() }]
            }));
        }
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
            this.imageDimensions = { width: imageBitmap.width, height: imageBitmap.height };

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

  public handleResize(): void {
    if (!this.device || !this.canvas.parentElement) return;

    // Get the current size of the container
    const containerWidth = this.canvas.parentElement.clientWidth;
    const containerHeight = this.canvas.parentElement.clientHeight;
    
    const imageAspect = this.imageDimensions.width / this.imageDimensions.height;
    
    let newCanvasWidth = containerWidth;
    let newCanvasHeight = Math.round(containerWidth / imageAspect);

    if (newCanvasHeight > containerHeight) {
        newCanvasHeight = containerHeight;
        newCanvasWidth = Math.round(containerHeight * imageAspect);
    }
    
    // Only resize if there's a meaningful change to avoid unnecessary re-creations
    if (this.canvas.width !== newCanvasWidth || this.canvas.height !== newCanvasHeight) {
        this.canvas.style.width = newCanvasWidth + 'px';
        this.canvas.style.height = newCanvasHeight + 'px';
        this.canvas.width = newCanvasWidth;
        this.canvas.height = newCanvasHeight;

        this.context.configure({device: this.device, format: this.presentationFormat, alphaMode: 'premultiplied'});

        if (this.writeTexture) this.writeTexture.destroy();
        this.writeTexture = this.device.createTexture({
            size: [newCanvasWidth, newCanvasHeight],
            format: 'rgba16float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.createBindGroups();
    }
}
    
    public updateDepthMap(data: Float32Array, width: number, height: number): void {
        if (!this.device) return;
        if (this.staticDepthTexture && (this.staticDepthTexture.width !== width || this.staticDepthTexture.height !== height)) {
            this.staticDepthTexture.destroy();
        }

        if (!this.staticDepthTexture || this.staticDepthTexture.width !== width || this.staticDepthTexture.height !== height) {
            const depthTextureDescriptor: GPUTextureDescriptor = {
                size: [width, height],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            };
            this.staticDepthTexture = this.device.createTexture(depthTextureDescriptor);
        }

        this.device.queue.writeTexture({ texture: this.staticDepthTexture }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
        this.createBindGroups();
    }

    private async generateMipmaps(texture: GPUTexture): Promise<void> {
        const blitSampler = this.device.createSampler({ magFilter: 'linear' });
        const commandEncoder = this.device.createCommandEncoder();
        let srcView = texture.createView({ baseMipLevel: 0, mipLevelCount: 1 });
        for (let i = 1; i < texture.mipLevelCount; i++) {
            const dstView = texture.createView({ baseMipLevel: i, mipLevelCount: 1 });
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{ view: dstView, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,0] }],
            });
            const bindGroup = this.device.createBindGroup({
                layout: this.blitPipeline.getBindGroupLayout(0),
                entries: [ { binding: 0, resource: blitSampler }, { binding: 1, resource: srcView } ],
            });
            passEncoder.setPipeline(this.blitPipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.draw(4);
            passEncoder.end();
            srcView = dstView;
        }
        this.device.queue.submit([commandEncoder.finish()]);
    }

    
    public getImageDimensions(): { width: number, height: number } {
        return this.imageDimensions;
    }
    
    public render(
        mode: RenderMode, 
        farthestPoint: { x: number, y: number }, 
        depthThreshold: number, 
        edgeHardness: number, 
        imageDimensions: {width: number, height: number}, 
        depthLevels: number, 
        depthDimensions: {width: number, height: number}, 
        fogColor: string, 
        fogDensity: number, 
        parallaxStrength: number
    ): void {
        if (!this.device || !this.context) return;
        const commandEncoder = this.device.createCommandEncoder();

        if (mode === '3d-zoom') {
            const computePass = commandEncoder.beginComputePass();
            const bg = this.bindGroups.get('computeZoom');
            if (bg) {
                const uniforms = new Float32Array(24);
                uniforms.set([this.canvas.width, this.canvas.height, imageDimensions.width, imageDimensions.height], 0);
                uniforms.set([performance.now()/1000.0, farthestPoint.x, farthestPoint.y], 4);
                const parsedFogColor = this.hexToRgb(fogColor);
                uniforms.set([...parsedFogColor, fogDensity], 8);
                uniforms.set([depthDimensions.width, depthDimensions.height], 12);
                uniforms.set([imageDimensions.width, imageDimensions.height], 16);
                uniforms.set([parallaxStrength, depthThreshold, edgeHardness, depthLevels], 20); // Re-packing params
                this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
                
                computePass.setPipeline(this.pipelines.get('computeZoom') as GPUComputePipeline);
                computePass.setBindGroup(0, bg);
                computePass.dispatchWorkgroups(Math.ceil(this.canvas.width / 8), Math.ceil(this.canvas.height / 8), 1);
            }
            computePass.end();

            const textureView = this.context.getCurrentTexture().createView();
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{ view: textureView, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,1] }]
            });
            const presentBG = this.bindGroups.get('present');
            if (presentBG) {
                passEncoder.setPipeline(this.pipelines.get('present') as GPURenderPipeline);
                passEncoder.setBindGroup(0, presentBG);
                passEncoder.draw(4);
            }
            passEncoder.end();

        } else if (mode === '3d-parallax') {
            const textureView = this.context.getCurrentTexture().createView();
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{ view: textureView, loadOp: 'clear', storeOp: 'store', clearValue: [0.1, 0.1, 0.1, 1] }]
            });
            const parallaxBG = this.bindGroups.get('3d-parallax');
            if (parallaxBG) {
                this.device.queue.writeBuffer(
                    this.uniformBuffer, 0,
                    new Float32Array([
                        this.cameraState.rotationX, this.cameraState.rotationY,
                        this.cameraState.zoom,
                        this.parallaxParams.displacementScale,
                        this.parallaxParams.ambient,
                        this.parallaxParams.smoothness,
                        this.mouseState.x, this.mouseState.y,
                        this.parallaxParams.pointSize
                    ])
                );
                passEncoder.setPipeline(this.pipelines.get('3d-parallax') as GPURenderPipeline);
                passEncoder.setBindGroup(0, parallaxBG);
                passEncoder.draw(GRID_SIZE * GRID_SIZE * 4);
            }
            passEncoder.end();
        }
        
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
