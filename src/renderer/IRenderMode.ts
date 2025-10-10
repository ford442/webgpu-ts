/**
 * Defines the contract for a self-contained render mode.
 * Each mode is responsible for its own pipelines, bindings, and render logic.
 */
export interface IRenderMode {
    // Called once to initialize the mode's specific resources (pipelines, buffers)
    init(
        device: GPUDevice,
        presentationFormat: GPUTextureFormat,
        sampler: GPUSampler,
        nonFilteringSampler: GPUSampler,
        imageTexture: GPUTexture,
        depthTextureRead: GPUTexture,
        writeTexture: GPUTexture,
        uniformBuffer: GPUBuffer,
    ): Promise<void>;

    // Called on every frame to execute the mode's logic
    render(
        commandEncoder: GPUCommandEncoder,
        uniformData: Float32Array
    ): void;

    // Optional: Called when the mode is switched away from, to clean up resources
    destroy?(): void;
}
