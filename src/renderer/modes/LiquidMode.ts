import { IRenderMode } from '../IRenderMode';

export class LiquidMode implements IRenderMode {
    private device!: GPUDevice;
    private pipeline!: GPUComputePipeline;
    private bindGroup!: GPUBindGroup;
    private uniformBuffer!: GPUBuffer;
    private ripplePoints: { x: number, y: number, startTime: number }[] = [];
    private readonly MAX_RIPPLES = 50;

    // This mode has a way to receive pointer events
    public onPointerDown(x: number, y: number): void {
        this.ripplePoints.push({ x, y, startTime: performance.now() / 1000.0 });
        if (this.ripplePoints.length > this.MAX_RIPPLES) {
            this.ripplePoints.shift();
        }
    }

    async init(
        device: GPUDevice,
        presentationFormat: GPUTextureFormat,
        sampler: GPUSampler,
        nonFilteringSampler: GPUSampler,
        imageTexture: GPUTexture,
        depthTextureRead: GPUTexture,
        writeTexture: GPUTexture,
        uniformBuffer: GPUBuffer,
    ): Promise<void> {
        this.device = device;
        this.uniformBuffer = uniformBuffer;

        const liquidCode = await fetch('shaders/liquid.wgsl').then(res => res.text());
        const liquidModule = this.device.createShaderModule({ code: liquidCode });

        // This layout is more complex because it includes a writable depth texture
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' as GPUSamplerBindingType } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' as GPUTextureSampleType } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float' as GPUTextureFormat } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' as GPUBufferBindingType, minBindingSize: 816 } }, // Specify buffer size
                { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' as GPUTextureSampleType } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'non-filtering' as GPUSamplerBindingType } },
                // This mode WRITES to the depth texture
                { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'r32float' as GPUTextureFormat } },
            ]
        });

        this.pipeline = await this.device.createComputePipelineAsync({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            compute: { module: liquidModule, entryPoint: 'main' }
        });

        // Note: The bind group for this mode will be created on every frame in the Renderer,
        // because it needs to ping-pong between the read and write depth textures.
    }

    render(commandEncoder: GPUCommandEncoder, uniformData: Float32Array): void {
        // This mode gets more complex data, including ripples
        const fullUniformData = new Float32Array(4 + this.MAX_RIPPLES * 4);
        
        // General config
        fullUniformData[0] = performance.now() / 1000.0; // time
        fullUniformData[1] = this.ripplePoints.length;   // rippleCount
        fullUniformData[2] = uniformData[0];             // resolutionX
        fullUniformData[3] = uniformData[1];             // resolutionY

        // Ripple data
        for (let i = 0; i < this.ripplePoints.length; i++) {
            const point = this.ripplePoints[i];
            fullUniformData.set([point.x, point.y, point.startTime], 4 + i * 4);
        }

        this.device.queue.writeBuffer(this.uniformBuffer, 0, fullUniformData);

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.pipeline);
        // The bind group is set in the main renderer for this mode
        // computePass.setBindGroup(0, this.bindGroup); 
        computePass.dispatchWorkgroups(Math.ceil(uniformData[0] / 8), Math.ceil(uniformData[1] / 8), 1);
        computePass.end();
    }
}
