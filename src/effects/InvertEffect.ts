import { Effect } from './Effect';

export class InvertEffect implements Effect {
    public name = 'Invert Colors';
    private pipeline!: GPURenderPipeline;
    private bindGroup!: GPUBindGroup;

    public async init(device: GPUDevice, presentationFormat: GPUTextureFormat): Promise<void> {
        const shaderCode = await (await fetch('shaders/invert.wgsl')).text();
        const shaderModule = device.createShaderModule({ code: shaderCode });

        this.pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: presentationFormat }],
            },
            primitive: { topology: 'triangle-strip' },
        });
    }

    public render(
        device: GPUDevice,
        passEncoder: GPURenderPassEncoder,
        sampler: GPUSampler,
        texture: GPUTexture,
        uniformBuffer: GPUBuffer,
    ): void {
        this.bindGroup = device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: texture.createView() },
            ],
        });

        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.draw(4);
    }
}
