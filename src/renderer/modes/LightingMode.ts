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

        // 1. Create Pipeline
        const lightingCode = await fetch('shaders/lighting.wgsl').then(res => res.text());
        const lightingModule = this.device.createShaderModule({ code: lightingCode });
        this.pipeline = await this.device.createComputePipelineAsync({
            layout: 'auto',
            compute: { module: lightingModule, entryPoint: 'main' }
        });

        // 2. Create Bind Group
        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
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
        // Update the uniform buffer with the latest data
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

        // Run the compute pass
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.pipeline);
        computePass.setBindGroup(0, this.bindGroup);
        // Assuming canvas size, ideally we'd get this from the uniform data
        const canvasWidth = uniformData[0];
        const canvasHeight = uniformData[1];
        computePass.dispatchWorkgroups(Math.ceil(canvasWidth / 8), Math.ceil(canvasHeight / 8), 1);
        computePass.end();
    }
}
