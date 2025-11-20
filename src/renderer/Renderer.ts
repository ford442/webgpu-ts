import { RenderMode } from './types';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipeline!: GPURenderPipeline;
    private bindGroup!: GPUBindGroup;
    private sampler!: GPUSampler;
    private texture!: GPUTexture;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    public async init(): Promise<boolean> {
        try {
            if (!navigator.gpu) {
                console.error('WebGPU not supported');
                return false;
            }

            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.error('No WebGPU adapter found');
                return false;
            }

            this.device = await adapter.requestDevice();
            const context = this.canvas.getContext('webgpu');
            if (!context) {
                console.error('Could not get WebGPU context');
                return false;
            }

            this.context = context;
            this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({
                device: this.device,
                format: this.presentationFormat,
                alphaMode: 'opaque',
            });

            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            // Initialize with a 1x1 placeholder to prevent null errors before first frame
            this.createTexture(1, 1);
            
            await this.createPipeline();

            console.log('WebGPU Renderer initialized');
            return true;
        } catch (e) {
            console.error('Failed to initialize WebGPU:', e);
            return false;
        }
    }

    // Helper to create/recreate texture
    private createTexture(width: number, height: number) {
        if (this.texture) this.texture.destroy();

        this.texture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | 
                   GPUTextureUsage.COPY_DST | 
                   GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    // Helper to update bind group when texture changes
    private updateBindGroup() {
        if (!this.pipeline || !this.texture) return;

        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: this.texture.createView() },
            ],
        });
    }

    private async createPipeline(): Promise<void> {
        const shaderCode = await fetch('./shaders/texture.wgsl').then(r => r.text());

        const shaderModule = this.device.createShaderModule({
            code: shaderCode,
        });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' as GPUSamplerBindingType },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' as GPUTextureSampleType },
                },
            ],
        });

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });

        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.presentationFormat }],
            },
            primitive: { topology: 'triangle-strip' },
        });

        this.updateBindGroup();
    }

    public renderStreetView(mode: RenderMode, source: CanvasImageSource): void {
        if (!this.device || !source || !this.pipeline) return;

        // 1. Determine Source Dimensions safely
        let srcWidth = 0;
        let srcHeight = 0;

        if (source instanceof HTMLCanvasElement) {
            srcWidth = source.width;
            srcHeight = source.height;
        } else if (source instanceof HTMLVideoElement) {
            srcWidth = source.videoWidth;
            srcHeight = source.videoHeight;
        }

        // 2. Safety check: Don't render if source is invalid or empty
        if (srcWidth === 0 || srcHeight === 0) return;

        // 3. Resize texture if dimensions differ (fixes the "Copy rect out of bounds" crash)
        if (this.texture.width !== srcWidth || this.texture.height !== srcHeight) {
            this.createTexture(srcWidth, srcHeight);
            this.updateBindGroup();
        }

        try {
            // 4. Copy Image
            this.device.queue.copyExternalImageToTexture(
                { source: source },
                { texture: this.texture },
                [srcWidth, srcHeight]
            );

            // 5. Render
            const commandEncoder = this.device.createCommandEncoder();
            const textureView = this.context.getCurrentTexture().createView();

            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: textureView,
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                }],
            });

            renderPass.setPipeline(this.pipeline);
            renderPass.setBindGroup(0, this.bindGroup);
            renderPass.draw(4, 1, 0, 0);
            renderPass.end();

            this.device.queue.submit([commandEncoder.finish()]);
        } catch (e) {
            // Suppress sporadic frame errors to avoid console spam
        }
    }
}
