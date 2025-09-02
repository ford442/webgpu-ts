import type * as tf from '@tensorflow/tfjs';
import type * as tflite from '@tensorflow/tfjs-tflite';

// Path to the TFLite model in the public folder
const MODEL_URL = './tflite_model/midas.tflite';
const MODEL_INPUT_SIZE = 256;

// Type assertion for the global objects
const tfModule = (window as any).tf as typeof tf;
const tfliteModule = (window as any).tflite as typeof tflite;

export class DepthModel {
    private model: tflite.TFLiteModel | null = null;

    public async init(): Promise<boolean> {
        try {
            await tfModule.setBackend('wasm');
            await tfModule.ready();
            this.model = await tfliteModule.loadTFLiteModel(MODEL_URL);
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

        const depthMap = tfModule.tidy(() => {
            // 1. Create a tensor from the video frame and resize it
            const frame = tfModule.browser.fromPixels(videoElement);
            const resized = tfModule.image.resizeBilinear(frame, [MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
            
            // 2. Pre-process the tensor (casting and expanding dimensions)
            const inputTensor = resized.toFloat().expandDims(0);

            // 3. Run inference
            const output = this.model!.predict(inputTensor);
            if (!(output instanceof tfModule.Tensor)) {
                console.error('The output of the model is not a tensor.');
                // Return a dummy tensor to avoid breaking the tidy function
                return tfModule.zeros([MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 1]);
            }
            const depth = output;

            // 4. Post-process the output tensor to normalize it for visualization
            const min = depth.min();
            const max = depth.max();
            const normalizedDepth = depth.sub(min).div(max.sub(min));
            
            // Squeeze and expand dimensions to make it a 3-channel image for toPixels
            return normalizedDepth.squeeze().expandDims(2);
        });

        await tfModule.browser.toPixels(depthMap as tf.Tensor3D, canvas);
        depthMap.dispose();
    }
}
