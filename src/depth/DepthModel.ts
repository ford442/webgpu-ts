import * as tf from '@tensorflow/tfjs';
import * as tflite from '@tensorflow/tfjs-tflite';

// Path to the TFLite model in the public folder
const MODEL_URL = '/tflite_model/midas.tflite';
const MODEL_INPUT_SIZE = 256;

// Set the path to the WebAssembly backend files for TFLite
// This is necessary for the TFLite package to work.
tflite.setWasmPath(
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-tflite@0.0.1-alpha.8/dist/'
);

export class DepthModel {
    private model: tflite.TFLiteModel | null = null;

    public async init(): Promise<boolean> {
        try {
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
            let depth = this.model!.predict(inputTensor) as tf.Tensor;

            // 4. Post-process the output tensor to normalize it for visualization
            const min = depth.min();
            const max = depth.max();
            const normalizedDepth = depth.sub(min).div(max.sub(min));
            
            // Squeeze and expand dimensions to make it a 3-channel image for toPixels
            return normalizedDepth.squeeze().expandDims(2);
        });

        await tf.browser.toPixels(depthMap as tf.Tensor3D, canvas);
        depthMap.dispose();
    }
}
