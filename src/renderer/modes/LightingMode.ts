import { IRenderMode } from '../IRenderMode';

export class LightingMode implements IRenderMode {
    private device!: GPUDevice;
    private pipeline!: GPUComputePipeline;
    private bindGroup!: GPUBindGroup;
    private uniformBuffer!: GPUBuffer;

    async init(
        device: GPUDevice,
        presentationFormat: GPUTextureFormat,
        sampler: GPUSampler,
        nonFilteringSampler: GPUSampler,
        imageTexture: GPUTexture,
        depthTextureRead: GPUTexture,
        writeTexture: GPUTexture,
        uniformBuffer: GPUBuffer
    ): Promise<void> {
        this.device = device;
        this.uniformBuffer = uniformBuffer;

        const lightingCode = await fetch('shaders/lighting.wgsl').then(res => res.text());
        const lightingModule = this.device.createShaderModule({ code: lightingCode });

        // --- MODIFIED: Start of Changes ---
        // 1. Create an explicit Bind Group Layout
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                // This is the key change: explicitly state the texture is an unfilterable float
                { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'non-filtering' } },
            ]
        });

        // 2. Create a Pipeline Layout from the Bind Group Layout
        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        // 3. Create the pipeline using the explicit layout
        this.pipeline = await this.device.createComputePipelineAsync({
            layout: pipelineLayout, // Use the explicit layout instead of 'auto'
            compute: { module: lightingModule, entryPoint: 'main' }
        });
        // --- MODIFIED: End of Changes ---

        this.bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout, // Use the same layout here
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: imageTexture.createView() },
                { binding: 2, resource: writeTexture.createView() },
                { binding: 3, resource: { buffer: this.uniformBuffer } },
                { binding: 4, resource: depthTextureRead.createView() },
                { binding: 5, resource: nonFilteringSampler },
            ]
        });
    }

    render(commandEncoder: GPUCommandEncoder, uniformData: Float32Array): void {
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.pipeline);
        computePass.setBindGroup(0, this.bindGroup);
        const canvasWidth = uniformData[0];
        const canvasHeight = uniformData[1];
        computePass.dispatchWorkgroups(Math.ceil(canvasWidth / 8), Math.ceil(canvasHeight / 8), 1);
        computePass.end();
    }
}
