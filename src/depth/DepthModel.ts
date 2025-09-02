// Path to the TFLite model in the public folder
const MODEL_URL = '/tflite_model/midas.tflite';
const MODEL_INPUT_SIZE = 256;

export class DepthModel {
    private model: any | null = null;

    public async init(): Promise<boolean> {
        try {
            await tf.setBackend('wasm');
            await tf.ready();
            this.model = await tflite.loadTFLiteModel(MODEL_URL);
            console.log('MiDaS TFLite model loaded successfully.');
            return true;
        } catch (error) {
            console.error('Failed to initialize TFLite DepthModel:', error);
            return false;
        }
    }

    public async renderDepthMap(videoElement: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
        if (!this.model) {
            console.error('Model not loaded yet.');
            return;
        }

        const depthMap = tf.tidy(() => {
            // 1. Create a tensor from the video frame and resize it
            const frame = tf.browser.fromPixels(videoElement);
            const resized = tf.image.resizeBilinear(frame, [MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
            
            // 2. Pre-process the tensor (casting and expanding dimensions)
            const inputTensor = resized.toFloat().expandDims(0);

            // 3. Run inference
            let depth = this.model!.predict(inputTensor) as any;

            // 4. Post-process the output tensor to normalize it for visualization
            const min = depth.min();
            const max = depth.max();
            const normalizedDepth = depth.sub(min).div(max.sub(min));
            
            // Squeeze and expand dimensions to make it a 3-channel image for toPixels
            return normalizedDepth.squeeze().expandDims(2);
        });

        await tf.browser.toPixels(depthMap, canvas);
        depthMap.dispose();
    }
}
