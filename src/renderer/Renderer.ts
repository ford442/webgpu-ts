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
    private v2ComputeUniformBuffer!: GPUBuffer;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;

    private depthTextureRead!: GPUTexture;
    private depthTextureWrite!: GPUTexture;
    private staticDepthTexture!: GPUTexture; // Add this new texture property

    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

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
          this.staticDepthTexture.destroy(); // Destroy the old static texture too
      }

      if (!this.depthTextureRead || this.depthTextureRead.width !== width || this.depthTextureRead.height !== height) {
          const depthTextureDescriptor: GPUTextureDescriptor = {
              size: [width, height],
              format: 'r32float',
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
          };
          this.depthTextureRead = this.device.createTexture(depthTextureDescriptor);
          this.depthTextureWrite = this.device.createTexture(depthTextureDescriptor);
          this.staticDepthTexture = this.device.createTexture(depthTextureDescriptor); // Create the new static texture
      }

      // Write the initial depth data to all three textures
      this.device.queue.writeTexture({ texture: this.depthTextureRead }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
      this.device.queue.writeTexture({ texture: this.depthTextureWrite }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
      this.device.queue.writeTexture({ texture: this.staticDepthTexture }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);

      this.createBindGroups();
  }

    private async createResources(): Promise<void> {
        const { width, height } = this.canvas;
        this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        this.nonFilteringSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

        this.v2ComputeUniformBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        const placeholderDepthDescriptor: GPUTextureDescriptor = {
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
        };
        this.depthTextureRead = this.device.createTexture(placeholderDepthDescriptor);
        this.depthTextureWrite = this.device.createTexture(placeholderDepthDescriptor);
        this.staticDepthTexture = this.device.createTexture(placeholderDepthDescriptor); // Create placeholder

        const placeholderData = new Float32Array([0.0]);
        this.device.queue.writeTexture({ texture: this.depthTextureRead }, placeholderData, { bytesPerRow: 4 }, [1, 1]);
        this.device.queue.writeTexture({ texture: this.depthTextureWrite }, placeholderData, { bytesPerRow: 4 }, [1, 1]);
        this.device.queue.writeTexture({ texture: this.staticDepthTexture }, placeholderData, { bytesPerRow: 4 }, [1, 1]);

        this.writeTexture = this.device.createTexture({
            size: [width, height],
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
    if (!this.imageTexture || !this.nonFilteringSampler || !this.depthTextureRead || !this.depthTextureWrite) return;

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
                { binding: 4, resource: this.depthTextureRead.createView() },
                { binding: 5, resource: this.nonFilteringSampler },
                { binding: 6, resource: this.depthTextureWrite.createView() },
                { binding: 7, resource: this.staticDepthTexture.createView() }, // The missing entry
            ]
        }));
    }
}

    private swapDepthTextures() {
        const temp = this.depthTextureRead;
        this.depthTextureRead = this.depthTextureWrite;
        this.depthTextureWrite = temp;
    }

    public render(mode: RenderMode, zoom: number, panX: number, panY: number, farthestPoint: { x: number, y: number }, depthThreshold: number): void {
        if (!this.device || !this.imageTexture) return;
        const currentTime = performance.now() / 1000.0;

    const commandEncoder = this.device.createCommandEncoder();

    if (mode === '3d-zoom') {
        const computePass = commandEncoder.beginComputePass();
        const computeZoomBG = this.bindGroups.get('computeZoom');

        if (computeZoomBG) {
            const uniformArray = new Float32Array(8);
            uniformArray.set([currentTime, 0, this.canvas.width, this.canvas.height], 0);
            uniformArray.set([currentTime, farthestPoint.x, farthestPoint.y, depthThreshold], 4);
            this.device.queue.writeBuffer(this.v2ComputeUniformBuffer, 0, uniformArray);

            computePass.setPipeline(this.pipelines.get('computeZoom') as GPUComputePipeline);
            computePass.setBindGroup(0, computeZoomBG);
            computePass.dispatchWorkgroups(this.canvas.width / 8, this.canvas.height / 8, 1);
        }
        computePass.end();
        this.swapDepthTextures();
    }

    const textureView = this.context.getCurrentTexture().createView();
    const renderPassDescriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: textureView, clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, loadOp: 'clear' as GPULoadOp, storeOp: 'store' as GPUStoreOp }] };
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
