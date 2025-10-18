import { RenderMode } from './types';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();
    private filteringSampler!: GPUSampler;
    private nonFilteringSampler!: GPUSampler;
    private imageUrls: string[] = [];
    private ripplePoints: { x: number, y: number, startTime: number }[] = [];
    private MAX_RIPPLES = 50;
    private v2ComputeUniformBuffer!: GPUBuffer;
    private v1ComputeUniformBuffer!: GPUBuffer;
    private imageVideoUniformBuffer!: GPUBuffer;
    private galaxyUniformBuffer!: GPUBuffer;
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;
    private depthTextureRead!: GPUTexture;
    private depthTextureWrite!: GPUTexture;
    private fgSpeed: number = 0.05;
    private bgSpeed: number = 0.01;
    private parallaxStrength: number = 2.0;
    private fogDensity: number = 0.7;
    private shaderBaseUrl: string = 'https://glsl.1ink.us/effects/';
    private currentComputePipelineKey: string = ''; // Add this property to track the active compute shader
    
    constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; }

    public addRipplePoint(x: number, y: number) {
        this.ripplePoints.push({ x, y, startTime: performance.now() / 1000.0 });
    }
    
    public updateZoomParams(params: { 
        fgSpeed?: number, 
        bgSpeed?: number, 
        parallaxStrength?: number, 
        fogDensity?: number 
    }): void {
        if (params.fgSpeed !== undefined) this.fgSpeed = params.fgSpeed;
        if (params.bgSpeed !== undefined) this.bgSpeed = params.bgSpeed;
        if (params.parallaxStrength !== undefined) this.parallaxStrength = params.parallaxStrength;
        if (params.fogDensity !== undefined) this.fogDensity = params.fogDensity;
    }
    
    public async init(): Promise<boolean> {
        if (!navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        const requiredFeatures: GPUFeatureName[] = [];
        if (adapter.features.has('float32-filterable')) {
            requiredFeatures.push('float32-filterable');
        } else {
            console.log("Device does not support 'float32-filterable', using two-sampler workaround.");
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

    public async fetchShaderFiles(): Promise<string[]> {
        try {
            const response = await fetch(this.shaderBaseUrl);
            if (!response.ok) throw new Error(`API error: ${response.status}`);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const links = Array.from(doc.querySelectorAll('a'));
            const shaderFiles = links
                .map(link => link.href)
                .filter(href => href.endsWith('.wgsl'))
                .map(href => href.substring(href.lastIndexOf('/') + 1));
            return shaderFiles;
        } catch (e) {
            console.error("Failed to fetch shader files:", e);
            return [];
        }
    }

    public async loadShader(shaderName: string, mode: RenderMode): Promise<void> {
        // Only load compute shaders dynamically for now
        if (!mode.startsWith('liquid') && mode !== 'vortex') {
             console.log(`Dynamic shader loading not implemented for mode: ${mode}`);
             // Reset to default compute pipeline for the mode if applicable
             this.currentComputePipelineKey = `compute-${mode}`;
             // Ensure default bind groups are ready if needed (optional refinement)
             // this.createBindGroups(); // Consider if defaults need explicit setup
             return;
         }

         // Use a unique key including the shader name
         const pipelineKey = `compute-${shaderName}`;
         this.currentComputePipelineKey = pipelineKey; // Store the key for the active shader

         // Check if pipeline already exists
         if (this.pipelines.has(pipelineKey)) {
             console.log(`Shader ${shaderName} already loaded.`);
             this.createBindGroups(); // Ensure bind groups are updated if needed
             return;
         }

         try {
            // Fetch from the specific shader URL
             const response = await fetch(`${this.shaderBaseUrl}${shaderName}`);
             if (!response.ok) throw new Error(`API error fetching shader: ${response.status}`);
             const code = await response.text();
             const module = this.device.createShaderModule({ code });

             console.log(`Compiling shader: ${shaderName}`);
             const pipeline = await this.device.createComputePipelineAsync({
                label: pipelineKey, // Add label for debugging
                layout: 'auto',
                compute: { module, entryPoint: 'main' },
             });

             // Store using the unique key
             this.pipelines.set(pipelineKey, pipeline);
             console.log(`Shader ${shaderName} loaded and compiled successfully.`);

             // Recreate bind groups as the pipeline layout might be needed
             // (Even if 'auto', recreating ensures the correct layout is referenced)
             this.createBindGroups();

        } catch (e) {
            console.error(`Failed to load or compile shader: ${shaderName}`, e);
             // Fallback or error handling: maybe reset to a default shader for the mode
             this.currentComputePipelineKey = `compute-${mode}`; // Fallback to mode default key
        }
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
                format: 'rgba32float',
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
        }
        if (!this.depthTextureRead || this.depthTextureRead.width !== width || this.depthTextureRead.height !== height) {
            const depthTextureDescriptor: GPUTextureDescriptor = {
                size: [width, height],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
            };
            this.depthTextureRead = this.device.createTexture(depthTextureDescriptor);
            this.depthTextureWrite = this.device.createTexture(depthTextureDescriptor);
        }
        this.device.queue.writeTexture({ texture: this.depthTextureRead }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
        this.device.queue.writeTexture({ texture: this.depthTextureWrite }, data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
        this.createBindGroups();
    }

    private async createResources(): Promise<void> {
        const { width, height } = this.canvas;
        this.filteringSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });
        this.nonFilteringSampler = this.device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });
        this.galaxyUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.imageVideoUniformBuffer = this.device.createBuffer({ size: 32 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v1ComputeUniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.v2ComputeUniformBuffer = this.device.createBuffer({ size: 48 + (this.MAX_RIPPLES * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const placeholderDepthDescriptor: GPUTextureDescriptor = {
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
        };
        this.depthTextureRead = this.device.createTexture(placeholderDepthDescriptor);
        this.depthTextureWrite = this.device.createTexture(placeholderDepthDescriptor);
        this.device.queue.writeTexture({ texture: this.depthTextureRead }, new Float32Array([0.0]), { bytesPerRow: 4 }, [1, 1]);
        this.device.queue.writeTexture({ texture: this.depthTextureWrite }, new Float32Array([0.0]), { bytesPerRow: 4 }, [1, 1]);
        this.writeTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba32float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> {
         const shaderNames = [
             // Your existing list...
             'galaxy.wgsl', 'imageVideo.wgsl', 'liquid-v1.wgsl', 'liquid.wgsl',
             'liquid-zoom.wgsl', 'texture.wgsl', 'liquid-perspective.wgsl', 'vortex.wgsl'
         ];
         const shaderBaseUrl = this.shaderBaseUrl; // Make sure this is accessible or passed

         const shaderCodes = await Promise.all(
             shaderNames.map(name =>
                  fetch(`${shaderBaseUrl}${name}`)
                  .then(res => {
                      if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
                      return res.text();
                  })
                  .catch(e => {
                      console.error(`Error fetching shader ${name}:`, e);
                      return ''; // Return empty string on error
                  })
             )
         );

         // Filter out failed fetches
         const validShaders = shaderNames.filter((_, index) => shaderCodes[index] !== '');
         const validCodes = shaderCodes.filter(code => code !== '');

         const modules = validCodes.map((code, index) => {
             try {
                  return this.device.createShaderModule({ label: validShaders[index], code });
             } catch (e) {
                  console.error(`Error creating shader module for ${validShaders[index]}:`, e);
                  return null;
             }
         }).filter(m => m !== null) as GPUShaderModule[];

         const moduleMap = new Map<string, GPUShaderModule>(
             validShaders.map((name, index) => [name, modules[index]])
         );


        // **Pipeline Creation Logic (Simplified Example)**
        const commonRenderConfig = (module: GPUShaderModule, entryPoint: string = 'vs_main') => ({
            vertex: { module, entryPoint },
            fragment: { targets: [{ format: this.presentationFormat }], module, entryPoint: 'fs_main' },
            primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology }
        });

         const pipelinePromises = [];

         // Render Pipelines
         const galaxyModule = moduleMap.get('galaxy.wgsl');
         if (galaxyModule) pipelinePromises.push(this.device.createRenderPipelineAsync({ layout: 'auto', ...commonRenderConfig(galaxyModule), vertex: { module: galaxyModule, entryPoint: 'vs_main' }, fragment: { targets: [{ format: this.presentationFormat }], module: galaxyModule, entryPoint: 'fs_main'}, primitive: { topology: 'triangle-list'} }).then(p => ({ key: 'galaxy', pipeline: p })));

         const imageVideoModule = moduleMap.get('imageVideo.wgsl');
         if (imageVideoModule) pipelinePromises.push(this.device.createRenderPipelineAsync({ layout: 'auto', ...commonRenderConfig(imageVideoModule) }).then(p => ({ key: 'imageVideo', pipeline: p })));

         const textureModule = moduleMap.get('texture.wgsl');
         if (textureModule) pipelinePromises.push(this.device.createRenderPipelineAsync({ layout: 'auto', ...commonRenderConfig(textureModule, 'vs_main') }).then(p => ({ key: 'liquid', pipeline: p }))); // Used for liquid output

         // Compute Pipelines (Defaults - adjust if needed)
         const computeModules = [
             { name: 'liquid-v1.wgsl', key: 'compute-liquid-v1' }, // Ensure key matches potential mode
             { name: 'liquid.wgsl', key: 'compute-liquid.wgsl' },     // Use full name for default too
             { name: 'liquid-zoom.wgsl', key: 'compute-liquid-zoom.wgsl' },
             { name: 'liquid-perspective.wgsl', key: 'compute-liquid-perspective.wgsl' },
             { name: 'vortex.wgsl', key: 'compute-vortex.wgsl' }
         ];

         for (const { name, key } of computeModules) {
             const module = moduleMap.get(name);
             if (module) {
                 pipelinePromises.push(
                     this.device.createComputePipelineAsync({
                         label: key, // Add label
                         layout: 'auto',
                         compute: { module, entryPoint: 'main' }
                     }).then(p => ({ key, pipeline: p }))
                 );
             }
         }

         // Wait for all pipelines and set them
         try {
            const results = await Promise.all(pipelinePromises);
            results.forEach(({ key, pipeline }) => {
                this.pipelines.set(key, pipeline);
            });
            console.log('Default pipelines created:', Array.from(this.pipelines.keys()));
         } catch(e) {
             console.error("Error creating one or more pipelines:", e);
         }

         // Set initial compute pipeline key based on a default mode (e.g., 'liquid')
         this.currentComputePipelineKey = 'compute-liquid.wgsl'; // Or another default
     }

    private createBindGroups(): void {
        if (!this.device || !this.imageTexture || !this.writeTexture || !this.depthTextureRead || !this.depthTextureWrite || !this.filteringSampler || !this.nonFilteringSampler) {
             console.warn("Cannot create bind groups, resources not ready.");
             return;
        }

        // --- Render Pipeline Bind Groups ---
        const galaxyPipeline = this.pipelines.get('galaxy') as GPURenderPipeline | undefined;
        if (galaxyPipeline && this.galaxyUniformBuffer && this.videoTexture) {
             this.bindGroups.set('galaxy', this.device.createBindGroup({
                label: 'galaxyBindGroup',
                layout: galaxyPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.galaxyUniformBuffer } },
                    { binding: 1, resource: this.filteringSampler },
                    { binding: 2, resource: this.videoTexture.createView() }
                ]
             }));
        } else if (!galaxyPipeline) console.warn("Galaxy pipeline not found for bind group creation.");
          else if (!this.galaxyUniformBuffer) console.warn("Galaxy uniform buffer not found.");
          else if (!this.videoTexture) console.warn("Video texture not found for galaxy bind group.");


        const imageVideoPipeline = this.pipelines.get('imageVideo') as GPURenderPipeline | undefined;
        if (imageVideoPipeline && this.imageVideoUniformBuffer) {
            if (this.videoTexture) {
                this.bindGroups.set('video', this.device.createBindGroup({
                    label: 'videoBindGroup',
                    layout: imageVideoPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: this.filteringSampler },
                        { binding: 1, resource: this.videoTexture.createView() },
                        { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }
                    ]
                }));
            } else console.warn("Video texture not found for video bind group.");

             this.bindGroups.set('image', this.device.createBindGroup({
                label: 'imageBindGroup',
                layout: imageVideoPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.filteringSampler },
                    { binding: 1, resource: this.imageTexture.createView() },
                    { binding: 2, resource: { buffer: this.imageVideoUniformBuffer } }
                ]
             }));
        } else if (!imageVideoPipeline) console.warn("Image/Video pipeline not found.");
          else if (!this.imageVideoUniformBuffer) console.warn("Image/Video uniform buffer not found.");


        const liquidPipeline = this.pipelines.get('liquid') as GPURenderPipeline | undefined; // Output pipeline
         if (liquidPipeline) {
            this.bindGroups.set('liquid', this.device.createBindGroup({
                label: 'liquidOutputBindGroup',
                layout: liquidPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.filteringSampler },
                    { binding: 1, resource: this.writeTexture.createView() } // Reads from writeTexture
                ]
            }));
         } else console.warn("Liquid output pipeline not found.");


        // --- Compute Pipeline Bind Groups ---
        // Only create/update the bind group for the *currently selected* compute pipeline
        const currentComputePipeline = this.pipelines.get(this.currentComputePipelineKey) as GPUComputePipeline | undefined;

         if (currentComputePipeline) {
             const computeEntries = [
                // Binding 0: Sampler (Linear) - Might not be used by all compute shaders
                { binding: 0, resource: this.filteringSampler },
                // Binding 1: Input Texture (Original Image/Video)
                { binding: 1, resource: this.imageTexture.createView() },
                // Binding 2: Output Texture (Result of Compute)
                { binding: 2, resource: this.writeTexture.createView() },
                 // Binding 3: Uniform Buffer (shader-specific uniforms)
                 // Determine which buffer to use based on the key
                 { binding: 3, resource: { buffer: this.v2ComputeUniformBuffer } }, // Assuming v2 for dynamic ones
                 // Binding 4: Input Depth Texture
                { binding: 4, resource: this.depthTextureRead.createView() },
                // Binding 5: Sampler (Nearest)
                { binding: 5, resource: this.nonFilteringSampler },
                // Binding 6: Output Depth Texture
                { binding: 6, resource: this.depthTextureWrite.createView() },
             ];

             // Log entry bindings to verify
             // console.log(`Creating bind group for ${this.currentComputePipelineKey} with bindings:`, computeEntries.map(e => e.binding));

             try {
                 const computeBindGroup = this.device.createBindGroup({
                     label: `${this.currentComputePipelineKey}-BindGroup`,
                     layout: currentComputePipeline.getBindGroupLayout(0),
                     entries: computeEntries
                 });
                 this.bindGroups.set(this.currentComputePipelineKey, computeBindGroup);
                 // console.log(`Successfully created bind group for ${this.currentComputePipelineKey}`);
             } catch (e) {
                  console.error(`Error creating bind group for ${this.currentComputePipelineKey}:`, e);
                  // You might want to inspect the pipeline's expected layout here
                  // console.log("Expected layout:", currentComputePipeline.getBindGroupLayout(0));
             }

         } else {
             console.warn(`Compute pipeline ${this.currentComputePipelineKey} not found when creating bind groups.`);
         }

         // **Important:** Remove old compute bind groups if they are no longer needed
         // This prevents holding references to old layouts if shaders change significantly
         this.bindGroups.forEach((_, key) => {
              if (key.startsWith('compute-') && key !== this.currentComputePipelineKey && !this.pipelines.has(key)) {
                  // console.log(`Deleting old bind group: ${key}`); // Keep if you need to debug deletion
                  this.bindGroups.delete(key);
              }
         });
     }

    private swapDepthTextures() {
        const temp = this.depthTextureRead;
        this.depthTextureRead = this.depthTextureWrite;
        this.depthTextureWrite = temp;
    }

public render(mode: RenderMode, selectedShader: string, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number, farthestPoint: { x: number, y: number }, mousePosition: { x: number, y: number }, isMouseDown: boolean): void {
        if (!this.device || !this.context || !this.imageTexture) return;

         // --- Video Texture Update --- (Keep as is)
         if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
              // ... (video texture update logic remains the same)
              if (!this.videoTexture || this.videoTexture.width !== videoElement.videoWidth || this.videoTexture.height !== videoElement.videoHeight) {
                  if (this.videoTexture) this.videoTexture.destroy();
                  this.videoTexture = this.device.createTexture({ size: [videoElement.videoWidth, videoElement.videoHeight], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
                  this.createBindGroups(); // Recreate BGs if video texture changes
              }
              try {
                   this.device.queue.copyExternalImageToTexture({ source: videoElement }, { texture: this.videoTexture }, [videoElement.videoWidth, videoElement.videoHeight]);
              } catch (e) {
                   console.error("Error copying video frame to texture:", e);
                   // Handle potential errors, e.g., video element not ready or texture invalid
                   return; // Exit render if copy fails
              }
         }

        const currentTime = performance.now() / 1000.0;
        const commandEncoder = this.device.createCommandEncoder();

        // --- Compute Pass ---
         // Determine the correct pipeline key to use for compute
         let computePipelineKey = '';
         let computeBindGroupKey = '';
         if (mode.startsWith('liquid') || mode === 'vortex') {
              // Use the unique key for the selected shader if it exists, otherwise fallback
              const specificPipelineKey = `compute-${selectedShader}`;
              if (this.pipelines.has(specificPipelineKey)) {
                   computePipelineKey = specificPipelineKey;
                   computeBindGroupKey = specificPipelineKey; // Bind group key matches pipeline key
              } else {
                   // Fallback logic if the specific shader hasn't loaded (or failed)
                   // Use the mode-based default key (e.g., 'compute-liquid.wgsl')
                   const defaultKey = `compute-${mode}.wgsl`; // Assuming default shader has mode name
                   if (this.pipelines.has(defaultKey)) {
                        console.warn(`Shader ${selectedShader} not found or loaded, falling back to ${defaultKey}`);
                        computePipelineKey = defaultKey;
                        computeBindGroupKey = defaultKey;
                        this.currentComputePipelineKey = defaultKey; // Update tracked key
                   } else {
                        console.error(`Neither specific shader ${specificPipelineKey} nor default ${defaultKey} pipeline found for mode ${mode}. Skipping compute pass.`);
                   }
              }
         }
         // Add other non-dynamic compute modes if necessary (like liquid-v1)
         else if (mode === 'liquid-v1') {
             computePipelineKey = 'compute-liquid-v1';
             computeBindGroupKey = 'computeV1'; // Uses the specific bind group key set earlier
         }


         // Run compute pass if a valid pipeline key was determined
         if (computePipelineKey && (mode.startsWith('liquid') || mode === 'vortex' || mode === 'liquid-v1')) {
             const computePipeline = this.pipelines.get(computePipelineKey) as GPUComputePipeline | undefined;
             const computeBindGroup = this.bindGroups.get(computeBindGroupKey);

             if (computePipeline && computeBindGroup) {
                  const computePass = commandEncoder.beginComputePass();
                  computePass.setPipeline(computePipeline);
                  computePass.setBindGroup(0, computeBindGroup);

                  // Update Uniforms (simplified - adapt based on which shader is running)
                  if (computePipelineKey === 'compute-liquid-v1') {
                       // Update v1ComputeUniformBuffer
                       this.device.queue.writeBuffer(this.v1ComputeUniformBuffer, 0, new Float32Array([
                            currentTime, this.canvas.width, this.canvas.height, isMouseDown ? 1.0 : 0.0
                       ]));
                  } else {
                       // Update v2ComputeUniformBuffer (for liquid, zoom, vortex, perspective)
                        this.ripplePoints = this.ripplePoints.filter(p => (currentTime - p.startTime) < 4.0);
                       if (this.ripplePoints.length > this.MAX_RIPPLES) this.ripplePoints.splice(0, this.ripplePoints.length - this.MAX_RIPPLES);
                       const rippleDataArr = new Float32Array(this.MAX_RIPPLES * 4);
                       for (let i = 0; i < this.ripplePoints.length; i++) {
                           const point = this.ripplePoints[i];
                           rippleDataArr.set([point.x, point.y, point.startTime], i * 4);
                       }

                       // Base config (time, rippleCount, resolution)
                        const configData = new Float32Array([currentTime, this.ripplePoints.length, this.canvas.width, this.canvas.height]);
                        this.device.queue.writeBuffer(this.v2ComputeUniformBuffer, 0, configData);

                       // Zoom config (zoomTime, farthestX, farthestY) - Offset 16 bytes (4 floats)
                       const zoomConfigData = new Float32Array([currentTime, farthestPoint.x, farthestPoint.y, 0]);
                       this.device.queue.writeBuffer(this.v2ComputeUniformBuffer, 16, zoomConfigData);

                       // Zoom params (fg_speed, bg_speed, parallax_str, fog_density) - Offset 32 bytes
                        const zoomParamsData = new Float32Array([this.fgSpeed, this.bgSpeed, this.parallaxStrength, this.fogDensity]);
                        this.device.queue.writeBuffer(this.v2ComputeUniformBuffer, 32, zoomParamsData);


                       // Ripple data - Offset 48 bytes
                       this.device.queue.writeBuffer(this.v2ComputeUniformBuffer, 48, rippleDataArr);
                  }

                   computePass.dispatchWorkgroups(Math.ceil(this.canvas.width / 8), Math.ceil(this.canvas.height / 8), 1);
                   computePass.end();

                   // Swap depth textures only if depth is being written to (check shader logic if unsure)
                   if (computePipelineKey !== 'compute-liquid-v1') { // Assuming v1 doesn't write depth
                       this.swapDepthTextures();
                       // We need to recreate the compute bind group for the *next* frame
                       // because the read/write depth textures have swapped.
                        this.createBindGroups();
                   }
             } else {
                  console.error(`Pipeline (${!!computePipeline}) or BindGroup (${!!computeBindGroup}) not found for key: ${computePipelineKey}/${computeBindGroupKey}`);
             }
         }

        // --- Render Pass ---
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp,
            }],
        };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        // Select pipeline and bind group based on mode for the final render pass
        let renderPipeline: GPURenderPipeline | undefined;
        let renderBindGroup: GPUBindGroup | undefined;
        let drawCount = 4; // Default for quad

         switch (mode) {
             case 'shader': // Assuming 'galaxy' is the only 'shader' mode type for now
                 renderPipeline = this.pipelines.get('galaxy') as GPURenderPipeline | undefined;
                 renderBindGroup = this.bindGroups.get('galaxy');
                 if (renderPipeline && renderBindGroup) {
                     this.device.queue.writeBuffer(this.galaxyUniformBuffer, 0, new Float32Array([currentTime, zoom, panX, panY]));
                     drawCount = 6; // Galaxy might use 6 vertices
                 }
                 break;
             case 'image':
             case 'ripple':
                 renderPipeline = this.pipelines.get('imageVideo') as GPURenderPipeline | undefined;
                 renderBindGroup = this.bindGroups.get('image');
                 if (renderPipeline && renderBindGroup) {
                     const uniformArray = new Float32Array(8 + this.MAX_RIPPLES * 4); // Size based on imageVideo shader
                      uniformArray.set([this.canvas.width, this.canvas.height, this.imageTexture.width, this.imageTexture.height], 0);
                      uniformArray.set([currentTime, this.ripplePoints.length, mode === 'ripple' ? 1.0 : 0.0, 0.0], 4);
                      for (let i = 0; i < this.ripplePoints.length; i++) {
                          const point = this.ripplePoints[i];
                          uniformArray.set([point.x, point.y, point.startTime, 0.0], 8 + i * 4);
                      }
                     this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, uniformArray);
                 }
                 break;
             case 'video':
                 renderPipeline = this.pipelines.get('imageVideo') as GPURenderPipeline | undefined;
                 renderBindGroup = this.bindGroups.get('video');
                 if (renderPipeline && renderBindGroup && this.videoTexture) {
                      const uniformArray = new Float32Array(8); // Only basic uniforms for video mode
                      uniformArray.set([this.canvas.width, this.canvas.height, this.videoTexture.width, this.videoTexture.height], 0);
                      uniformArray.set([currentTime, 0, 0, 0], 4); // No ripples for video mode
                      this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, uniformArray);
                 } else if (!this.videoTexture) {
                     // Don't try to render if video texture isn't ready
                     renderPipeline = undefined;
                     renderBindGroup = undefined;
                 }
                 break;
             case 'liquid-v1':
             case 'liquid':
             case 'liquid-zoom':
             case 'liquid-vortex':
             case 'liquid-perspective':
             case 'vortex':
                 // All these modes render the result from the compute shader's writeTexture
                 renderPipeline = this.pipelines.get('liquid') as GPURenderPipeline | undefined; // Using the 'liquid' output pipeline
                 renderBindGroup = this.bindGroups.get('liquid');
                 break;
         }

         if (renderPipeline && renderBindGroup) {
             passEncoder.setPipeline(renderPipeline);
             passEncoder.setBindGroup(0, renderBindGroup);
             passEncoder.draw(drawCount);
         } else {
             // Optional: Log if a pipeline/bindgroup was missing for the render stage
             // console.warn(`Render pipeline or bind group missing for mode: ${mode}`);
         }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
