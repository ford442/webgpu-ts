import {RenderMode} from './types';

export class Renderer {
    private canvas: HTMLCanvasElement;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private presentationFormat!: GPUTextureFormat;
    private pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    private bindGroups = new Map<string, GPUBindGroup>();
    private filteringSampler!: GPUSampler;
    private nonFilteringSampler!: GPUSampler;
    private comparisonSampler!: GPUSampler;
    private imageUrls: string[] = [];
    private ripplePoints: { x: number, y: number, startTime: number }[] = [];
    private MAX_RIPPLES = 100;
    private computeUniformBuffer!: GPUBuffer;
    private imageVideoUniformBuffer!: GPUBuffer;
    private galaxyUniformBuffer!: GPUBuffer;
    private videoTexture!: GPUTexture;
    private imageTexture!: GPUTexture;
    private writeTexture!: GPUTexture;
    private depthTextureRead!: GPUTexture;
    private depthTextureWrite!: GPUTexture;
    private dataTextureA!: GPUTexture; // Renamed from dataTexture
    private dataTextureB!: GPUTexture; // ADDED
    private dataTextureC!: GPUTexture; // ADDED
    private extraBuffer!: GPUBuffer;
    private fgSpeed: number = 0.05;
    private bgSpeed: number = 0.01;
    private parallaxStrength: number = 2.0;
    private fogDensity: number = 0.7;
    private shaderBaseUrl: string = 'https://glsl.1ink.us/effects/';
    // Store shader sources keyed by pipeline key so we can parse WGSL for bindings
    private shaderSources = new Map<string, string>();
    // Optional per-shader manifest data (parsed JSON) keyed by pipeline key
    private shaderManifests = new Map<string, any>();
    // Default binding map for compute pipelines (binding index -> logical resource key)
    private defaultComputeBindingMap: Record<number, string> = {
        0: 'filteringSampler',
        1: 'imageTexture',
        2: 'writeTexture',
        3: 'computeUniformBuffer',
        4: 'depthTextureRead',
        5: 'nonFilteringSampler',
        6: 'depthTextureWrite',
        7: 'dataTextureA',
        8: 'dataTextureB',
        9: 'dataTextureC',
        10: 'extraBuffer',
        11: 'comparisonSampler'
    };

    private colorStrength: number = 1.0; // fallback
    private stainedCellSize: number = 0.035;
    private stainedEdgeWidth: number = 0.06;
    private stainedRefraction: number = 0.02;
    private zoomPreset: number = 1;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    // --- WGSL parsing + auto-bind helpers ---
    // Very small parser to extract @binding/@group declarations for group 0 and infer resource kind.
    private parseWGSLBindings(code: string): Array<{binding: number, group: number, kind: string, raw: string}> {
        const results: Array<{binding: number, group: number, kind: string, raw: string}> = [];
        if (!code) return results;
        // Match declarations containing @binding(N) and @group(M) up to the terminating semicolon.
        const declRegex = /@binding\((\d+)\)\s*@group\((\d+)\)[^;\n]*;?/g;
        let m: RegExpExecArray | null;
        while ((m = declRegex.exec(code)) !== null) {
            const binding = Number(m[1]);
            const group = Number(m[2]);
            // Take a small window around the match to inspect the type/token
            const start = Math.max(0, m.index - 120);
            const end = Math.min(code.length, m.index + 200);
            const snippet = code.slice(start, end);
            let kind = 'unknown';
            const s = snippet.toLowerCase();
            if (/texture_storage/.test(s)) kind = 'storageTexture';
            else if (/texture_2d|texture_3d|texture_cube|texture_multisampled_2d/.test(s)) kind = 'texture';
            else if (/sampler_comparison/.test(s)) kind = 'comparisonSampler';
            else if (/\bsampler\b/.test(s)) kind = 'sampler';
            else if (/var\s*<\s*uniform\s*>/.test(s)) kind = 'uniform';
            else if (/var\s*<\s*storage\s*>/.test(s)) kind = 'storageBuffer';
            results.push({binding, group, kind, raw: snippet});
        }
        return results;
    }

    private resolveResourceForParsedBinding(parsed: {binding: number, group: number, kind: string}, pipelineKey: string): GPUBindingResource | null {
        // Map of available resources
        const res: Record<string, any> = {
            filteringSampler: this.filteringSampler,
            nonFilteringSampler: this.nonFilteringSampler,
            comparisonSampler: this.comparisonSampler,
            imageTexture: this.imageTexture,
            videoTexture: this.videoTexture,
            writeTexture: this.writeTexture,
            depthTextureRead: this.depthTextureRead,
            depthTextureWrite: this.depthTextureWrite,
            dataTextureA: this.dataTextureA,
            dataTextureB: this.dataTextureB,
            dataTextureC: this.dataTextureC,
            extraBuffer: this.extraBuffer,
            computeUniformBuffer: this.computeUniformBuffer,
            imageVideoUniformBuffer: this.imageVideoUniformBuffer,
            galaxyUniformBuffer: this.galaxyUniformBuffer,
        };

        const kind = parsed.kind;
        try {
            // If binding index matches a default mapping for compute pipelines, prefer it
            if (pipelineKey.startsWith('compute') && this.defaultComputeBindingMap[parsed.binding]) {
                const key = this.defaultComputeBindingMap[parsed.binding];
                const r = this.resolveResourceByKey(key);
                if (r) return r;
            }
            if (kind === 'sampler') {
                return res.filteringSampler || res.nonFilteringSampler || null;
            }
            if (kind === 'comparisonSampler') {
                return res.comparisonSampler || res.filteringSampler || null;
            }
            if (kind === 'texture') {
                // prefer video/image/write/data textures in that order
                if (res.videoTexture) return res.videoTexture.createView();
                if (res.imageTexture) return res.imageTexture.createView();
                if (res.writeTexture) return res.writeTexture.createView();
                if (res.dataTextureA) return res.dataTextureA.createView();
                if (res.dataTextureB) return res.dataTextureB.createView();
                if (res.dataTextureC) return res.dataTextureC.createView();
                if (res.depthTextureRead) return res.depthTextureRead.createView();
                return null;
            }
            if (kind === 'storageTexture') {
                // prefer writeTexture and data textures for storage writes
                if (res.writeTexture) return res.writeTexture.createView();
                if (res.dataTextureA) return res.dataTextureA.createView();
                if (res.dataTextureB) return res.dataTextureB.createView();
                if (res.dataTextureC) return res.dataTextureC.createView();
                if (res.depthTextureWrite) return res.depthTextureWrite.createView();
                return null;
            }
            if (kind === 'uniform') {
                // heuristics: compute pipelines use computeUniformBuffer; render pipelines use imageVideo/galaxy
                if (pipelineKey.startsWith('compute')) return res.computeUniformBuffer ? {buffer: res.computeUniformBuffer} : null;
                if (pipelineKey === 'galaxy') return res.galaxyUniformBuffer ? {buffer: res.galaxyUniformBuffer} : null;
                return res.imageVideoUniformBuffer ? {buffer: res.imageVideoUniformBuffer} : (res.computeUniformBuffer ? {buffer: res.computeUniformBuffer} : null);
            }
            if (kind === 'storageBuffer') {
                return res.extraBuffer ? {buffer: res.extraBuffer} : null;
            }
        } catch (e) {
            // resource may not exist or createView may fail
            return null;
        }
        return null;
    }

    private resolveResourceByKey(key: string): GPUBindingResource | null {
        if (!key) return null;
        const k = key.toString();
        try {
            if (k.includes('Sampler')) {
                if (k === 'comparisonSampler') return this.comparisonSampler || null;
                if (k === 'nonFilteringSampler') return this.nonFilteringSampler || this.filteringSampler || null;
                return this.filteringSampler || this.nonFilteringSampler || null;
            }
            if (k.includes('Texture')) {
                const tex = (this as any)[k] as GPUTexture | undefined;
                if (tex && typeof tex.createView === 'function') return tex.createView();
                return null;
            }
            if (k.includes('Buffer') || k.endsWith('Buffer') || k.endsWith('UniformBuffer')) {
                const buf = (this as any)[k] as GPUBuffer | undefined;
                if (buf) return {buffer: buf};
                return null;
            }
            // fallback: check known names
            switch (k) {
                case 'extraBuffer': return this.extraBuffer ? {buffer: this.extraBuffer} : null;
                case 'computeUniformBuffer': return this.computeUniformBuffer ? {buffer: this.computeUniformBuffer} : null;
                case 'imageVideoUniformBuffer': return this.imageVideoUniformBuffer ? {buffer: this.imageVideoUniformBuffer} : null;
                case 'galaxyUniformBuffer': return this.galaxyUniformBuffer ? {buffer: this.galaxyUniformBuffer} : null;
                case 'videoTexture': return this.videoTexture ? this.videoTexture.createView() : null;
                case 'imageTexture': return this.imageTexture ? this.imageTexture.createView() : null;
                case 'writeTexture': return this.writeTexture ? this.writeTexture.createView() : null;
                case 'dataTextureA': return this.dataTextureA ? this.dataTextureA.createView() : null;
                case 'dataTextureB': return this.dataTextureB ? this.dataTextureB.createView() : null;
                case 'dataTextureC': return this.dataTextureC ? this.dataTextureC.createView() : null;
                case 'depthTextureRead': return this.depthTextureRead ? this.depthTextureRead.createView() : null;
                case 'depthTextureWrite': return this.depthTextureWrite ? this.depthTextureWrite.createView() : null;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    private tryCreateBindGroupFromShader(bindGroupKey: string, pipelineKey: string): boolean {
        const pipeline = this.pipelines.get(pipelineKey);
        if (!pipeline) return false;
        const code = this.shaderSources.get(pipelineKey);
        const manifest = this.shaderManifests.get(pipelineKey);
        const layout = (pipeline as unknown as { getBindGroupLayout(index: number): GPUBindGroupLayout }).getBindGroupLayout(0);
        const entries: Array<{binding: number, resource: GPUBindingResource}> = [];

        // 1) If a manifest exists, use it (explicit mapping binding -> resourceKey)
        if (manifest && manifest.bindings) {
            for (const [k, resourceKey] of Object.entries(manifest.bindings)) {
                const binding = Number(k);
                const resource = this.resolveResourceByKey(resourceKey as string);
                if (!resource) return false;
                entries.push({binding, resource});
            }
        } else {
            // 2) Try to parse WGSL bindings
            if (code) {
                const parsed = this.parseWGSLBindings(code).filter(p => p.group === 0);
                for (const p of parsed) {
                    const resource = this.resolveResourceForParsedBinding(p, pipelineKey);
                    if (!resource) {
                        // if a parsed binding can't be satisfied, attempt default map fallback below
                        continue;
                    }
                    entries.push({binding: p.binding, resource});
                }
            }

            // 3) If entries are incomplete for compute pipelines, use default binding map
            if (pipelineKey.startsWith('compute')) {
                for (const [bindIdxStr, key] of Object.entries(this.defaultComputeBindingMap)) {
                    const binding = Number(bindIdxStr);
                    // skip if we already filled this binding
                    if (entries.find(e => e.binding === binding)) continue;
                    const resource = this.resolveResourceByKey(key);
                    if (!resource) continue;
                    entries.push({binding, resource});
                }
            }
        }

        try {
            const bg = this.device.createBindGroup({layout, entries});
            this.bindGroups.set(bindGroupKey, bg);
            return true;
        } catch (e) {
            console.warn('Auto-bind group creation failed:', e);
            return false;
        }
    }
    // --- end WGSL parsing + auto-bind helpers ---

    public addRipplePoint(x: number, y: number) {
        this.ripplePoints.push({x, y, startTime: performance.now() / 1000.0});
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

    public setStainedParams(cellSize: number, edgeWidth: number, refraction: number, colorStrength: number) {
        this.stainedCellSize = cellSize;
        this.stainedEdgeWidth = edgeWidth;
        this.stainedRefraction = refraction;
        this.colorStrength = colorStrength;
    }

    public setZoomPreset(p: number) {
        this.zoomPreset = Math.max(0, Math.min(2, Math.floor(p)));
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
        this.context.configure({device: this.device, colorSpace: "display-p3",format: this.presentationFormat, alphaMode: 'premultiplied',toneMapping: {mode: "extended"}});
        await this.fetchImageUrls();
        await this.createResources();
        await this.createPipelines();
        return true;
    }

    private async fetchImageUrls(): Promise<void> {
        const bucketName = 'my-sd35-space-images-2025';
        const apiUrl = `https://storage.googleapis.com/storage/v1/b/${bucketName}/o`;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`API error: ${response.status}`);
            const data = await response.json();
            this.imageUrls = data.items ? data.items.map((item: {
                name: string
            }) => `https://storage.googleapis.com/${bucketName}/${item.name}`) : [];
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
            this.device.queue.copyExternalImageToTexture({source: imageBitmap}, {texture: this.imageTexture, colorSpace:"display-p3"}, [imageBitmap.width, imageBitmap.height]);
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
        this.device.queue.writeTexture({texture: this.depthTextureRead}, data, {
            bytesPerRow: width * 4,
            rowsPerImage: height
        }, [width, height]);
        this.device.queue.writeTexture({texture: this.depthTextureWrite}, data, {
            bytesPerRow: width * 4,
            rowsPerImage: height
        }, [width, height]);
        this.createBindGroups();
    }

    private async createResources(): Promise<void> {
        const {width, height} = this.canvas;
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
        this.comparisonSampler = this.device.createSampler({
            compare: 'less', // Used for shadow mapping (e.g., is fragment depth < shadow map depth?)
        });
        this.galaxyUniformBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.imageVideoUniformBuffer = this.device.createBuffer({
            size: 32 + (this.MAX_RIPPLES * 16),
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.computeUniformBuffer = this.device.createBuffer({
            size: 48 + (this.MAX_RIPPLES * 16), // 3*vec4 + 50*vec4 = 848 bytes
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        const placeholderDepthDescriptor: GPUTextureDescriptor = {
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
        };
        this.depthTextureRead = this.device.createTexture(placeholderDepthDescriptor);
        this.depthTextureWrite = this.device.createTexture(placeholderDepthDescriptor);
        this.device.queue.writeTexture({texture: this.depthTextureRead}, new Float32Array([0.0]), {bytesPerRow: 4}, [1, 1]);
        this.device.queue.writeTexture({texture: this.depthTextureWrite}, new Float32Array([0.0]), {bytesPerRow: 4}, [1, 1]);
        this.writeTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba32float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        const dataStorageTextureDescriptor: GPUTextureDescriptor = {
            size: [width, height],
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        };
        const dataTextureDescriptor: GPUTextureDescriptor = {
            size: [width, height],
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        };
        this.dataTextureA = this.device.createTexture(dataStorageTextureDescriptor); // Renamed
        this.dataTextureB = this.device.createTexture(dataStorageTextureDescriptor); // ADDED
        this.dataTextureC = this.device.createTexture(dataTextureDescriptor); // ADDED
        // Create a 1KB storage buffer as an example
        const initialExtraData = new Float32Array(256); // 256 floats * 4 bytes/float = 1024 bytes
        this.extraBuffer = this.device.createBuffer({
            size: initialExtraData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Float32Array(this.extraBuffer.getMappedRange()).set(initialExtraData);
        this.extraBuffer.unmap();
        await this.loadRandomImage();
    }

    private async createPipelines(): Promise<void> {
        const shaderNames = [
            'galaxy.wgsl', 'imageVideo.wgsl', 'video-effect.wgsl', 'video-stained.wgsl', 'liquid-v1.wgsl', 'liquid.wgsl',
            'liquid-alt.wgsl',
            'liquid-alt2.wgsl',
            'liquid-zoom.wgsl', 'texture.wgsl', 'liquid-perspective.wgsl', 'vortex.wgsl'
        ];

        // Helper: fetch shader from remote, fallback to local /shaders when offline/CORS
        const fetchShader = async (name: string): Promise<string> => {
            try {
                const r = await fetch(`${this.shaderBaseUrl}${name}`);
                if (r.ok) return await r.text();
            } catch {}
            const rl = await fetch(`shaders/${name}`);
            return await rl.text();
        };
        // Fetch shader sources in parallel
        const shaderCodes = await Promise.all(shaderNames.map(fetchShader));

        const [galaxyCode, imageVideoCode, videoEffectCode, videoStainedCode, liquidV1Code, liquidCode, liquidAltCode, liquidAlt2Code, liquidZoomCode, textureCode, liquidPerspectiveCode, vortexCode] = shaderCodes;

        // Save shader sources for later automatic binding attempts
        this.shaderSources.set('galaxy', galaxyCode);
        this.shaderSources.set('imageVideo', imageVideoCode);
        this.shaderSources.set('videoEffect', videoEffectCode);
        this.shaderSources.set('videoStained', videoStainedCode);
        this.shaderSources.set('liquidV1', liquidV1Code);
        this.shaderSources.set('liquid', liquidCode);
        this.shaderSources.set('computeAlt', liquidAltCode);
        this.shaderSources.set('computeAlt2', liquidAlt2Code);
        this.shaderSources.set('compute', liquidCode); // primary compute shader
        this.shaderSources.set('computeV1', liquidV1Code);
        this.shaderSources.set('computeZoom', liquidZoomCode);
        this.shaderSources.set('texture', textureCode);
        this.shaderSources.set('liquidPerspective', liquidPerspectiveCode);
        this.shaderSources.set('vortex', vortexCode);

        const galaxyModule = this.device.createShaderModule({code: galaxyCode});
        const imageVideoModule = this.device.createShaderModule({code: imageVideoCode});
        const videoEffectModule = this.device.createShaderModule({code: videoEffectCode});
        const videoStainedModule = this.device.createShaderModule({code: videoStainedCode});
        const liquidV1Module = this.device.createShaderModule({code: liquidV1Code});
        const liquidModule = this.device.createShaderModule({code: liquidCode});
        const liquidAltModule = this.device.createShaderModule({code: liquidAltCode});
        const liquidAlt2Module = this.device.createShaderModule({code: liquidAlt2Code});
        const liquidZoomModule = this.device.createShaderModule({code: liquidZoomCode});
        const textureModule = this.device.createShaderModule({code: textureCode});
        const liquidPerspectiveModule = this.device.createShaderModule({code: liquidPerspectiveCode});
        const vortexModule = this.device.createShaderModule({code: vortexCode});

        // 1. Create ONE shared bind group layout for ALL compute shaders
        const videoBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' as GPUSamplerBindingType } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' as GPUTextureSampleType } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' as GPUBufferBindingType } },
            ]
        });
        const videoPipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [videoBindGroupLayout]
        });

        // 1b. Create compute bind group layout and pipeline layout
        const computeBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' as GPUSamplerBindingType } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' as GPUTextureSampleType } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only' as GPUStorageTextureAccess, format: 'rgba32float' as GPUTextureFormat } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' as GPUBufferBindingType } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' as GPUTextureSampleType } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'non-filtering' as GPUSamplerBindingType } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only' as GPUStorageTextureAccess, format: 'r32float' as GPUTextureFormat } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only' as GPUStorageTextureAccess, format: 'rgba32float' as GPUTextureFormat } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only' as GPUStorageTextureAccess, format: 'rgba32float' as GPUTextureFormat } },
                { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' as GPUTextureSampleType } },
                { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' as GPUBufferBindingType } },
                { binding: 11, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'comparison' as GPUSamplerBindingType } },
            ],
        });
        const computePipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [computeBindGroupLayout],
        });

        // 3. Create render pipelines
        const commonConfig = {
            vertex: {module: imageVideoModule, entryPoint: 'vs_main'},
            fragment: {targets: [{format: this.presentationFormat}]},
            primitive: {topology: 'triangle-strip' as GPUPrimitiveTopology}
        };

        const [
            galaxyPipeline, imageVideoPipeline, texturePipeline
        ] = await Promise.all([
            this.device.createRenderPipelineAsync({
                layout: 'auto', ...commonConfig,
                vertex: {module: galaxyModule, entryPoint: 'vs_main'},
                fragment: {...commonConfig.fragment, module: galaxyModule, entryPoint: 'fs_main'},
                primitive: {topology: 'triangle-list' as GPUPrimitiveTopology}
            }),
            this.device.createRenderPipelineAsync({
                layout: videoPipelineLayout, ...commonConfig,
                fragment: {...commonConfig.fragment, module: imageVideoModule, entryPoint: 'fs_main'}
            }),
            this.device.createRenderPipelineAsync({
                layout: 'auto', ...commonConfig,
                vertex: {module: textureModule, entryPoint: 'vs_main'},
                fragment: {...commonConfig.fragment, module: textureModule, entryPoint: 'fs_main'}
            }),
        ]);

        this.pipelines.set('galaxy', galaxyPipeline);
        this.pipelines.set('imageVideo', imageVideoPipeline);
        // 'liquid' render pipeline uses the textureModule pipeline (historical naming)
        this.pipelines.set('liquid', texturePipeline);

        // 4. Create ALL compute pipelines using the SHARED layout
        const [
            computeV1, compute, computeZoom,
            computePerspective, computeVortex, computeAlt, computeAlt2
        ] = await Promise.all([
            this.device.createComputePipelineAsync({
                layout: computePipelineLayout,
                compute: {module: liquidV1Module, entryPoint: 'main'}
            }),
            this.device.createComputePipelineAsync({
                layout: computePipelineLayout,
                compute: {module: liquidModule, entryPoint: 'main'}
            }),
            this.device.createComputePipelineAsync({
                layout: computePipelineLayout,
                compute: {module: liquidZoomModule, entryPoint: 'main'}
            }),
            this.device.createComputePipelineAsync({
                layout: computePipelineLayout,
                compute: {module: liquidPerspectiveModule, entryPoint: 'main'}
            }),
            this.device.createComputePipelineAsync({
                layout: computePipelineLayout,
                compute: {module: vortexModule, entryPoint: 'main'}
            }),
            this.device.createComputePipelineAsync({
                layout: computePipelineLayout,
                compute: {module: liquidAltModule, entryPoint: 'main'}
            }),
            this.device.createComputePipelineAsync({
                layout: computePipelineLayout,
                compute: {module: liquidAlt2Module, entryPoint: 'main'}
            })
        ]);

        this.pipelines.set('computeV1', computeV1);
        this.pipelines.set('compute', compute);
        this.pipelines.set('computeZoom', computeZoom);
        this.pipelines.set('computePerspective', computePerspective);
        this.pipelines.set('computeVortex', computeVortex);
        this.pipelines.set('computeAlt', computeAlt);
        this.pipelines.set('computeAlt2', computeAlt2);

        // Create the video-effect render pipeline (separate await to keep Promise lists simple)
        const videoEffectPipeline = await this.device.createRenderPipelineAsync({
            layout: videoPipelineLayout,
            vertex: { module: imageVideoModule, entryPoint: 'vs_main' },
            fragment: { module: videoEffectModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
            primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology }
        });

        this.pipelines.set('videoEffect', videoEffectPipeline);

        // Create the video-stained render pipeline
        const videoStainedPipeline = await this.device.createRenderPipelineAsync({
            layout: videoPipelineLayout,
            vertex: { module: imageVideoModule, entryPoint: 'vs_main' },
            fragment: { module: videoStainedModule, entryPoint: 'fs_main', targets: [{ format: this.presentationFormat }] },
            primitive: { topology: 'triangle-strip' as GPUPrimitiveTopology }
        });
        this.pipelines.set('videoStained', videoStainedPipeline);
    }

    private createBindGroups(): void {
        if (!this.imageTexture || !this.nonFilteringSampler || !this.comparisonSampler || !this.depthTextureRead || !this.depthTextureWrite || !this.dataTextureA|| !this.dataTextureB || !this.dataTextureC || !this.extraBuffer || !this.computeUniformBuffer) return;
        // --- Render Bind Groups (no change) ---
        if (this.videoTexture) {
            this.bindGroups.set('galaxy', this.device.createBindGroup({
                layout: this.pipelines.get('galaxy')!.getBindGroupLayout(0),
                entries: [{binding: 0, resource: {buffer: this.galaxyUniformBuffer}}, {
                    binding: 1,
                    resource: this.filteringSampler
                }, {binding: 2, resource: this.videoTexture.createView()}]
            }));
            // Use shared videoBindGroupLayout for both imageVideo and videoEffect
            const videoBindGroupLayout = this.pipelines.get('imageVideo')!.getBindGroupLayout(0);
            this.bindGroups.set('video', this.device.createBindGroup({
                layout: videoBindGroupLayout,
                entries: [
                    {binding: 0, resource: this.filteringSampler},
                    {binding: 1, resource: this.videoTexture.createView()},
                    {binding: 2, resource: {buffer: this.imageVideoUniformBuffer}}
                ]
            }));
        }
        this.bindGroups.set('image', this.device.createBindGroup({
            layout: this.pipelines.get('imageVideo')!.getBindGroupLayout(0),
            entries: [{binding: 0, resource: this.filteringSampler}, {
                binding: 1,
                resource: this.imageTexture.createView()
            }, {binding: 2, resource: {buffer: this.imageVideoUniformBuffer}}]
        }));
        this.bindGroups.set('liquid', this.device.createBindGroup({
            layout: this.pipelines.get('liquid')!.getBindGroupLayout(0),
            entries: [{binding: 0, resource: this.filteringSampler}, {
                binding: 1,
                resource: this.writeTexture.createView()
            }]
        }));

        // --- Attempt AUTO-binding for compute pipelines (fallback to manual mega bind group if auto fails) ---
        const computePipeline = this.pipelines.get('compute') || this.pipelines.get('computeV1');
        if (!computePipeline) return; // Pipelines not ready

        // Try automatic bind-group creation using the primary compute shader; if it fails, fall back to manual creation below
        const autoOk = this.tryCreateBindGroupFromShader('compute', 'compute');
        if (autoOk) {
            console.info('Auto bind-group creation succeeded for compute pipeline');
        }
        if (autoOk) {
            // Remove old per-compute bind keys for cleanliness
            this.bindGroups.delete('computeV1');
            this.bindGroups.delete('computeZoom');
            this.bindGroups.delete('computePerspective');
            this.bindGroups.delete('computeVortex');
            return;
        }

        // Define the entries for the one bind group
        const inputTextureView = this.imageTexture.createView();
        const computeEntries = [
            {binding: 0, resource: this.filteringSampler},
            {binding: 1, resource: inputTextureView},
            {binding: 2, resource: this.writeTexture.createView()},
            {binding: 3, resource: {buffer: this.computeUniformBuffer}},
            {binding: 4, resource: this.depthTextureRead.createView()},
            {binding: 5, resource: this.nonFilteringSampler},
            {binding: 6, resource: this.depthTextureWrite.createView()},

            // --- MODIFIED/ADDED LINES ---
            {binding: 7, resource: this.dataTextureA.createView()},
            {binding: 8, resource: this.dataTextureB.createView()},
            {binding: 9, resource: this.dataTextureC.createView()},
            {binding: 10, resource: {buffer: this.extraBuffer}},
            {binding: 11, resource: this.comparisonSampler},
            // --- END MODIFICATION ---
        ];

        const computeBindGroup = this.device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0), // Get layout from any compute pipeline
            entries: computeEntries,
        });

        // Delete all old/stale compute bind groups
        this.bindGroups.delete('computeV1');
        this.bindGroups.delete('computeZoom');
        this.bindGroups.delete('computePerspective');
        this.bindGroups.delete('computeVortex');
        
        // Set the ONE compute bind group
        this.bindGroups.set('compute', computeBindGroup);
    }

    private swapDepthTextures() {
        const temp = this.depthTextureRead;
        this.depthTextureRead = this.depthTextureWrite;
        this.depthTextureWrite = temp;
    }

    public render(mode: RenderMode, videoElement: HTMLVideoElement, zoom: number, panX: number, panY: number, farthestPoint: {
        x: number,
        y: number
    }, mousePosition: { x: number, y: number }, isMouseDown: boolean): void {
        if (!this.device || !this.imageTexture) return;
        const currentTime = performance.now() / 1000.0;
        if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
            if (!this.videoTexture || this.videoTexture.width !== videoElement.videoWidth || this.videoTexture.height !== videoElement.videoHeight) {
                if (this.videoTexture) this.videoTexture.destroy();
                this.videoTexture = this.device.createTexture({
                    size: [videoElement.videoWidth, videoElement.videoHeight],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
                });
                this.createBindGroups();
            }
            this.device.queue.copyExternalImageToTexture({source: videoElement}, {texture: this.videoTexture}, [videoElement.videoWidth, videoElement.videoHeight]);
        }
        const commandEncoder = this.device.createCommandEncoder();
        if (mode.startsWith('liquid') || mode === 'vortex') {
            const computePass = commandEncoder.beginComputePass();
            const computeBG = this.bindGroups.get('compute'); // Get the ONE bind group

            if (computeBG) {
                // --- 1. Uniform Buffer Updates ---
                if (mode === 'liquid-v1') {
                    // liquid-v1 only needs config: [time, 0, resX, resY]
                    const configData = new Float32Array([
                        currentTime, 0, this.canvas.width, this.canvas.height
                    ]);
                    // Write only the first vec4 (16 bytes)
                    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, configData, 0, 4);
                } else {
                    // All other compute shaders use the full uniform struct
                    this.ripplePoints = this.ripplePoints.filter(p => (currentTime - p.startTime) < 4.0);
                    if (this.ripplePoints.length > this.MAX_RIPPLES) this.ripplePoints.splice(0, this.ripplePoints.length - this.MAX_RIPPLES);

                    const rippleDataArr = new Float32Array(this.MAX_RIPPLES * 4);
                    for (let i = 0; i < this.ripplePoints.length; i++) {
                        const point = this.ripplePoints[i];
                        rippleDataArr.set([point.x, point.y, point.startTime], i * 4);
                    }

                    // Create the full 848-byte array
                    const uniformArray = new Float32Array(12 + this.MAX_RIPPLES * 4);

                    // config (offset 0)
                    uniformArray.set([currentTime, this.ripplePoints.length, this.canvas.width, this.canvas.height], 0);

                    // zoom_config (offset 4)
                    uniformArray.set([currentTime, farthestPoint.x, farthestPoint.y, this.zoomPreset], 4);

                    // zoom_params (offset 8) - Use class properties
                    const zoomParams = new Float32Array([
                        this.fgSpeed,
                        this.bgSpeed,
                        this.parallaxStrength,
                        this.fogDensity
                    ]);
                    uniformArray.set(zoomParams, 8);

                    // ripples (offset 12)
                    uniformArray.set(rippleDataArr, 12);

                    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, uniformArray);
                }

                // --- 2. Set Bind Group ONCE ---
                computePass.setBindGroup(0, computeBG);

                // --- 3. Switch Pipeline ---
                if (mode === 'liquid-v1') {
                    computePass.setPipeline(this.pipelines.get('computeV1') as GPUComputePipeline);
                } else if (mode === 'vortex') {
                    computePass.setPipeline(this.pipelines.get('computeVortex') as GPUComputePipeline);
                } else if (mode === 'liquid-zoom' || mode === 'liquid-vortex') {
                    computePass.setPipeline(this.pipelines.get('computeZoom') as GPUComputePipeline);
                } else if (mode === 'liquid-alt2') {
                    computePass.setPipeline(this.pipelines.get('computeAlt2') as GPUComputePipeline);
                } else if (mode === 'liquid-perspective') {
                    computePass.setPipeline(this.pipelines.get('computePerspective') as GPUComputePipeline);
                } else if ((mode as string) === 'liquid-alt') {
                    computePass.setPipeline(this.pipelines.get('computeAlt') as GPUComputePipeline);
                } else if ((mode as string) === 'liquid-alt') {
                    computePass.setPipeline(this.pipelines.get('computeAlt') as GPUComputePipeline);
                } else if ((mode as string) === 'liquid-alt') {
                    computePass.setPipeline(this.pipelines.get('computeAlt') as GPUComputePipeline);
                } else if ((mode as string) === 'liquid-alt') {
                    computePass.setPipeline(this.pipelines.get('computeAlt') as GPUComputePipeline);
                } else { // 'liquid'
                    computePass.setPipeline(this.pipelines.get('compute') as GPUComputePipeline);
                }

                // --- 4. Dispatch ---
                computePass.dispatchWorkgroups(this.canvas.width / 8, this.canvas.height / 8, 1);
            }
            computePass.end();

            // swapDepthTextures logic is unchanged
            if (mode === 'liquid' || mode === 'liquid-zoom' || mode === 'liquid-vortex' || mode === 'liquid-perspective' || mode === 'vortex') {
                this.swapDepthTextures();
            }
        }
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: {r: 0.0, g: 0.0, b: 0.0, a: 1.0},
                loadOp: 'clear' as GPULoadOp,
                storeOp: 'store' as GPUStoreOp
            }]
        };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        const liquidPipeline = this.pipelines.get('liquid') as GPURenderPipeline;
        const imageVideoPipeline = this.pipelines.get('imageVideo') as GPURenderPipeline;
        const galaxyPipeline = this.pipelines.get('galaxy') as GPURenderPipeline;
        switch (mode) {
            case 'shader':
                if (galaxyPipeline && this.bindGroups.has('galaxy')) {
                    this.device.queue.writeBuffer(this.galaxyUniformBuffer, 0, new Float32Array([currentTime, zoom, panX, panY]));
                    passEncoder.setPipeline(galaxyPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('galaxy')!);
                    passEncoder.draw(6);
                }
                break;
            case 'image':
            case 'ripple': {
                if (imageVideoPipeline && this.bindGroups.has('image')) {
                    const uniformArray = new Float32Array(12 + this.MAX_RIPPLES * 4);
                    // resolutions
                    uniformArray.set([this.canvas.width, this.canvas.height, this.imageTexture.width, this.imageTexture.height], 0);
                    // config
                    uniformArray.set([currentTime, this.ripplePoints.length, mode === 'ripple' ? 1.0 : 0.0, 0.0], 4);
                    // stained params (cellSize, edgeWidth, refraction, colorStrength)
                    uniformArray.set([this.stainedCellSize, this.stainedEdgeWidth, this.stainedRefraction, this.colorStrength], 8);
                    // ripples start at offset 12
                    for (let i = 0; i < this.ripplePoints.length; i++) {
                        const point = this.ripplePoints[i];
                        uniformArray.set([point.x, point.y, point.startTime, 0.0], 12 + i * 4);
                    }
                    this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, uniformArray);

                    passEncoder.setPipeline(imageVideoPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('image')!);
                    passEncoder.draw(4);
                }
                break;
            }
            case 'video': {
                if (imageVideoPipeline && this.bindGroups.has('video')) {
                    const uniformArray = new Float32Array(12);
                    uniformArray.set([this.canvas.width, this.canvas.height, this.videoTexture.width, this.videoTexture.height], 0);
                    uniformArray.set([currentTime, 0, 0, 0], 4);
                    uniformArray.set([this.stainedCellSize, this.stainedEdgeWidth, this.stainedRefraction, this.colorStrength], 8);
                    this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, uniformArray);

                    passEncoder.setPipeline(imageVideoPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('video')!);
                    passEncoder.draw(4);
                }
                break;
            }
            case 'video-stained': {
                const videoStainedPipeline = this.pipelines.get('videoStained') as GPURenderPipeline | undefined;
                if (videoStainedPipeline && this.bindGroups.has('video')) {
                    const ua = new Float32Array(12);
                    ua.set([this.canvas.width, this.canvas.height, this.videoTexture.width, this.videoTexture.height], 0);
                    ua.set([currentTime, 0, 0, 0], 4);
                    ua.set([this.stainedCellSize, this.stainedEdgeWidth, this.stainedRefraction, this.colorStrength], 8);
                    this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, ua);

                    passEncoder.setPipeline(videoStainedPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('video')!);
                    passEncoder.draw(4);
                }
                break;
            }
            case 'video-effect': {
                // Use the dedicated videoEffect pipeline but reuse the same bind group/uniform layout as 'video'
                const videoEffectPipeline = this.pipelines.get('videoEffect') as GPURenderPipeline | undefined;
                if (videoEffectPipeline && this.bindGroups.has('video')) {
                    const ua = new Float32Array(12);
                    ua.set([this.canvas.width, this.canvas.height, this.videoTexture.width, this.videoTexture.height], 0);
                    ua.set([currentTime, 0, 0, 0], 4);
                    ua.set([this.stainedCellSize, this.stainedEdgeWidth, this.stainedRefraction, this.colorStrength], 8);
                    this.device.queue.writeBuffer(this.imageVideoUniformBuffer, 0, ua);

                    passEncoder.setPipeline(videoEffectPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('video')!);
                    passEncoder.draw(4);
                }
                break;
            }
            case 'liquid-v1':
            case 'liquid':
            case 'liquid-zoom':
            case 'liquid-vortex':
            case 'liquid-perspective':
            case 'vortex':
                if (liquidPipeline && this.bindGroups.has('liquid')) {
                    passEncoder.setPipeline(liquidPipeline);
                    passEncoder.setBindGroup(0, this.bindGroups.get('liquid')!);
                    passEncoder.draw(4);
                }
                break;
        }
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
