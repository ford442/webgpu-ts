import galaxyShader from './shaders/galaxy.wgsl';
import imageVideoShader from './shaders/imageVideo.wgsl';

export type RenderMode = 'shader' | 'image' | 'video';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;

    // Pipelines
    private galaxyPipeline!: GPURenderPipeline;
    private imageVideoPipeline!: GPURenderPipeline;

    // Resources
    private uniformBuffer!: GPUBuffer;
    private sampler!: GPUSampler;
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture;
    
    // Bind Groups
    private galaxyBindGroup!: GPUBindGroup;
    private videoBindG
