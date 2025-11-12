/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/main.ts":
/*!*********************!*\
  !*** ./src/main.ts ***!
  \*********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony import */ var _renderer__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./renderer */ \"./src/renderer.ts\");\n\nasync function main() {\n    const canvas = document.getElementById('webgpu-canvas');\n    const renderer = new _renderer__WEBPACK_IMPORTED_MODULE_0__.Renderer(canvas);\n    await renderer.init();\n    const zoomSlider = document.getElementById('zoom-slider');\n    const panXSlider = document.getElementById('pan-x-slider');\n    const panYSlider = document.getElementById('pan-y-slider');\n    zoomSlider.addEventListener('input', () => {\n        renderer.setZoom(parseFloat(zoomSlider.value) / 100);\n    });\n    panXSlider.addEventListener('input', () => {\n        renderer.setPanX(parseFloat(panXSlider.value) / 100);\n    });\n    panYSlider.addEventListener('input', () => {\n        renderer.setPanY(parseFloat(panYSlider.value) / 100);\n    });\n    function animate() {\n        renderer.render();\n        requestAnimationFrame(animate);\n    }\n    animate();\n}\nmain().catch(err => {\n    console.error(err);\n    alert('An error occurred while initializing the application. Please ensure your browser supports WebGPU.');\n});\n\n\n//# sourceURL=webpack://webgpu-galaxy/./src/main.ts?\n}");

/***/ }),

/***/ "./src/renderer.ts":
/*!*************************!*\
  !*** ./src/renderer.ts ***!
  \*************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   Renderer: () => (/* binding */ Renderer)\n/* harmony export */ });\nObject(function webpackMissingModule() { var e = new Error(\"Cannot find module './shaders/galaxy.wgsl'\"); e.code = 'MODULE_NOT_FOUND'; throw e; }());\n\nclass Renderer {\n    canvas;\n    device;\n    context;\n    pipeline;\n    uniformBuffer;\n    uniformBindGroup;\n    videoTexture;\n    sampler;\n    zoom = 1.0;\n    panX = 0.5;\n    panY = 0.5;\n    constructor(canvas) {\n        this.canvas = canvas;\n    }\n    async init() {\n        if (!navigator.gpu) {\n            throw new Error(\"WebGPU not supported on this browser.\");\n        }\n        const adapter = await navigator.gpu.requestAdapter();\n        if (!adapter) {\n            throw new Error(\"No appropriate GPUAdapter found.\");\n        }\n        this.device = await adapter.requestDevice();\n        this.context = this.canvas.getContext('webgpu');\n        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();\n        this.context.configure({\n            device: this.device,\n            format: presentationFormat,\n        });\n        this.createResources();\n        this.createPipeline();\n    }\n    createResources() {\n        // Uniform buffer\n        this.uniformBuffer = this.device.createBuffer({\n            size: 3 * 4, // 3 floats (time, zoom, pan)\n            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,\n        });\n        // Sampler\n        this.sampler = this.device.createSampler({\n            magFilter: 'linear',\n            minFilter: 'linear',\n        });\n        // Video texture\n        const video = document.getElementById('video');\n        this.videoTexture = this.device.createTexture({\n            size: [video.videoWidth, video.videoHeight],\n            format: 'rgba8unorm',\n            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,\n        });\n    }\n    createPipeline() {\n        const shaderModule = this.device.createShaderModule({ code: Object(function webpackMissingModule() { var e = new Error(\"Cannot find module './shaders/galaxy.wgsl'\"); e.code = 'MODULE_NOT_FOUND'; throw e; }()) });\n        this.pipeline = this.device.createRenderPipeline({\n            layout: 'auto',\n            vertex: {\n                module: shaderModule,\n                entryPoint: 'main',\n            },\n            fragment: {\n                module: shaderModule,\n                entryPoint: 'main',\n                targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],\n            },\n            primitive: {\n                topology: 'triangle-list',\n            },\n        });\n        this.uniformBindGroup = this.device.createBindGroup({\n            layout: this.pipeline.getBindGroupLayout(0),\n            entries: [\n                { binding: 0, resource: { buffer: this.uniformBuffer } },\n                { binding: 1, resource: this.sampler },\n                { binding: 2, resource: this.videoTexture.createView() },\n            ],\n        });\n    }\n    setZoom(value) {\n        this.zoom = value;\n    }\n    setPanX(value) {\n        this.panX = value;\n    }\n    setPanY(value) {\n        this.panY = value;\n    }\n    render() {\n        const video = document.getElementById('video');\n        if (video.readyState >= 2) {\n            this.device.queue.copyExternalImageToTexture({ source: video }, { texture: this.videoTexture }, [video.videoWidth, video.videoHeight]);\n        }\n        this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([performance.now() / 1000, this.zoom, this.panX, this.panY]));\n        const commandEncoder = this.device.createCommandEncoder();\n        const textureView = this.context.getCurrentTexture().createView();\n        const renderPassDescriptor = {\n            colorAttachments: [{\n                    view: textureView,\n                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },\n                    loadOp: 'clear',\n                    storeOp: 'store',\n                }],\n        };\n        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);\n        passEncoder.setPipeline(this.pipeline);\n        passEncoder.setBindGroup(0, this.uniformBindGroup);\n        passEncoder.draw(6, 1, 0, 0);\n        passEncoder.end();\n        this.device.queue.submit([commandEncoder.finish()]);\n    }\n}\n\n\n//# sourceURL=webpack://webgpu-galaxy/./src/renderer.ts?\n}");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module can't be inlined because the eval devtool is used.
/******/ 	var __webpack_exports__ = __webpack_require__("./src/main.ts");
/******/ 	
/******/ })()
;