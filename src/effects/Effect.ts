export interface Effect {
    name: string;
    init(device: GPUDevice, presentationFormat: GPUTextureFormat): Promise<void>;
    render(
        device: GPUDevice,
        passEncoder: GPURenderPassEncoder,
        sampler: GPUSampler,
        texture: GPUTexture,
        uniformBuffer: GPUBuffer,
        canvas: HTMLCanvasElement,
        videoElement: HTMLVideoElement
    ): void;
}
