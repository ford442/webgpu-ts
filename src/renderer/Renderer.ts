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
            // Check WebGPU support
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

            // Create sampler
            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            // Create texture (will be updated with source)
            this.texture = this.device.createTexture({
                size: [this.canvas.width, this.canvas.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | 
                       GPUTextureUsage.COPY_DST | 
                       GPUTextureUsage.RENDER_ATTACHMENT,
            });

            await this.createPipeline();

            console.log('WebGPU Renderer initialized');
            return true;
        } catch (e) {
            console.error('Failed to initialize WebGPU:', e);
            return false;
        }
    }

    private async createPipeline(): Promise<void> {
        // Load shader code
        const shaderCode = await fetch('/shaders/texture.wgsl').then(r => r.text());

        const shaderModule = this.device.createShaderModule({
            code: shaderCode,
        });

        // Create bind group layout
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

        // Create pipeline layout
        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout],
        });

        // Create render pipeline
        this.pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: this.presentationFormat,
                }],
            },
            primitive: {
                topology: 'triangle-strip',
            },
        });

        // Create bind group
        this.bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.sampler,
                },
                {
                    binding: 1,
                    resource: this.texture.createView(),
                },
            ],
        });
    }

    public renderStreetView(mode: RenderMode, source: CanvasImageSource): void {
        if (!this.device || !source) return;

        try {
            // Update texture with source
            this.device.queue.copyExternalImageToTexture(
                { source: source },
                { texture: this.texture },
                [this.canvas.width, this.canvas.height]
            );

            // Render
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
            console.error('Error rendering:', e);
        }
    }
}
