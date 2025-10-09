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
    private uniformBuffer!: GPUBuffer;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;
    private staticDepthTexture!: GPUTexture;
    public imageDimensions = { width: 1, height: 1 };
    private maxTextureSize = 8192;
    private isDeviceLost = false;

    private mouseState = { x: 0.5, y: 0.5 };
    private cameraState = {
        rotationX: 0.5,
        rotationY: 0,
        zoom: 1.0,
        isDragging: false,
        lastMouseX: 0,
        lastMouseY: 0,
    };
    
    private parallaxParams = { displacementScale: 0.3, ambient: 0.3, smoothness: 1.0, pointSize: 3.0 };

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public updateParallaxParams(params: any) {
        this.parallaxParams = params;
    }
    
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
    
    public stopMouseDrag() {
        this.cameraState.isDragging = false;
    }
    
    public updateZoom(deltaY: number) {
        this.cameraState.zoom += deltaY * 0.001;
        this.cameraState.zoom = Math.max(0.2, Math.min(5.0, this.cameraState.zoom));
    }
    
    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        const requiredFeatures: GPUFeatureName[] = [];
        if (adapter.features.has('float32-filterable')) {
            requiredFeatures.push('float32-filterable');
        }
        this.device = await adapter.requestDevice({
            requiredFeatures,
            requiredLimits: {
                maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
            },
        });
        this.device.lost.then((info) => {
            console.error(`WebGPU device was lost: ${info.message}`);
            this.isDeviceLost = true;
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
    const containerWidth = this.canvas.parentElement.clientWidth;
    const containerHeight = this.canvas.parentElement.clientHeight;
    const imageAspect = this.imageDimensions.width / this.imageDimensions.height;
    let newCanvasWidth = containerWidth;
    let newCanvasHeight = Math.round(containerWidth / imageAspect);
    if (newCanvasHeight > containerHeight) {
        newCanvasHeight = containerHeight;
        newCanvasWidth = Math.round(containerHeight * imageAspect);
    }
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

    private async createResources(): Promise<void> {
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nonFilteringSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
        this.v2ComputeUniformBuffer = this.device.createBuffer({
      size: 96, // 6 vec4s * 16 bytes/vec4 = 96 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST 
      });
        const placeholderDepthDescriptor: GPUTextureDescriptor = {
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        };
        this.staticDepthTexture = this.device.createTexture(placeholderDepthDescriptor);
        this.device.queue.writeTexture({ texture: this.staticDepthTexture }, new Float32Array([0.0]), { bytesPerRow: 4 }, [1, 1]);
        this.writeTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'rgba16float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> {
        const [zoomCode, textureCode] = await Promise.all([
            fetch('shaders/3d-zoom.wgsl').then(res => res.text()),
            fetch('shaders/texture.wgsl').then(res => res.text()),
        ]);
        const zoomModule = this.device.createShaderModule({ code: zoomCode });
        const textureModule = this.device.createShaderModule({ code: textureCode });
        const commonConfig = { vertex: { module: textureModule, entryPoint: 'vs_main' }, fragment: { targets: [{ format: this.presentationFormat }] }, primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology } };
        this.pipelines.set('present', this.device.createRenderPipeline({ layout: 'auto', ...commonConfig, fragment: { ...commonConfig.fragment, module: textureModule, entryPoint: 'fs_main' } }));
        this.pipelines.set('computeZoom', this.device.createComputePipeline({ layout: 'auto', compute: { module: zoomModule, entryPoint: 'main' } }));
    }

    private createBindGroups(): void {
        if (!this.imageTexture || !this.staticDepthTexture) return;
        this.bindGroups.set('present', this.device.createBindGroup({ layout: this.pipelines.get('present')!.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: this.writeTexture.createView() }] }));
        const computeZoomPipeline = this.pipelines.get('computeZoom');
        if (computeZoomPipeline) {
            this.bindGroups.set('computeZoom', this.device.createBindGroup({
                layout: computeZoomPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: this.imageTexture.createView() },
                    { binding: 2, resource: this.writeTexture.createView() },
                    { binding: 3, resource: { buffer: this.v2ComputeUniformBuffer } },
                    { binding: 4, resource: this.nonFilteringSampler },
                    { binding: 5, resource: this.staticDepthTexture.createView() },
                ]
            }));
        }
    }

    public getImageDimensions(): { width: number, height: number } {
        return this.imageDimensions;
    }

public render(
        mode: RenderMode,
        farthestPoint: { x: number, y: number },
        imageDimensions: {width: number, height: number},
        depthDimensions: {width: number, height: number},
        parallaxStrength: number
    ): void {
    if (!this.device || !this.imageTexture) return;
        const currentTime = performance.now() / 1000.0;
        const commandEncoder = this.device.createCommandEncoder();
        if (mode === '3d-zoom') {
            const computePass = commandEncoder.beginComputePass();
            const computeZoomBG = this.bindGroups.get('computeZoom');
            if (computeZoomBG) {
                const cleanUniforms = new Float32Array(24); 
                // vec4 0 (Offset 0): resolutions
                cleanUniforms.set([this.canvas.width, this.canvas.height, imageDimensions.width, imageDimensions.height], 0);
                // vec4 1 (Offset 4): time_zoom
                cleanUniforms.set([currentTime, farthestPoint.x, farthestPoint.y], 4);
                // vec4 2 (Offset 8): config (fog_color.xyz, fog_density.w)
                const parsedFogColor = this.hexToRgb(fogColor); // Use 'this.hexToRgb'
                cleanUniforms.set([...parsedFogColor, fogDensity], 8);
                // vec4 3 (Offset 12): depth_map_res
                cleanUniforms.set([depthDimensions.width, depthDimensions.height], 12);
                // vec4 4 (Offset 16): color_map_res
                cleanUniforms.set([imageDimensions.width, imageDimensions.height], 16);
                // vec4 5 (Offset 20): effect_params
                cleanUniforms.set([parallaxStrength], 20);
                this.device.queue.writeBuffer(this.v2ComputeUniformBuffer, 0, cleanUniforms);
                computePass.setPipeline(this.pipelines.get('computeZoom') as GPUComputePipeline);
                computePass.setBindGroup(0, computeZoomBG);
                computePass.dispatchWorkgroups(this.canvas.width / 8, this.canvas.height / 8, 1);
            }
            computePass.end();
        }
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp
            }]
        };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        const presentPipeline = this.pipelines.get('present') as GPURenderPipeline;
        if (presentPipeline && this.bindGroups.has('present')) {
            passEncoder.setPipeline(presentPipeline);
            passEncoder.setBindGroup(0, this.bindGroups.get('present')!);
            passEncoder.draw(4);
        }
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
