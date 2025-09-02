import * as tf from '@tensorflow/tfjs';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/midas/dist/v2_1_small/model.json';
const MODEL_INPUT_SIZE = 256;

export class DepthModel {
    private model: tf.GraphModel | null = null;

    public async init(): Promise<boolean> {
        try {
            await tf.setBackend('webgpu');
            await tf.ready();
            this.model = await tf.loadGraphModel(MODEL_URL);
            console.log('MiDaS model loaded and WebGPU backend ready.');
            return true;
        } catch (error) {
            console.error('Failed to initialize DepthModel:', error);
            return false;
        }
    }

    public async renderDepthMap(videoElement: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
        if (!this.model) {
            console.error('Model not loaded yet.');
            return;
        }

        const depthMap = tf.tidy(() => {
            const frame = tf.browser.fromPixels(videoElement).expandDims(0);
            const resized = tf.image.resizeBilinear(frame, [MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);

            // The TFJS Graph Model from TF Hub expects input in the range [0, 255]
            // and the output is also a tensor that needs to be normalized for visualization.
            let depth = this.model!.predict(resized) as tf.Tensor;

            depth = depth.squeeze();
            const max = depth.max();
            const min = depth.min();
            const normalizedDepth = depth.sub(min).div(max.sub(min));

            // We need to expand dims to 3 so toPixels works
            return normalizedDepth.expandDims(2);
        });

        await tf.browser.toPixels(depthMap as tf.Tensor3D, canvas);
        depthMap.dispose();
    }
}
