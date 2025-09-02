import * as tf from '@tensorflow/tfjs';

const MODEL_URL = 'https://tfhub.dev/intel/midas-v2-1-small/1/webgl1/model.json?tfjs-graph-model=true';
const MODEL_INPUT_SIZE = 256;

export class DepthModel {
    private model: tf.GraphModel | null = null;

    public async init(): Promise<boolean> {
        try {
            await tf.setBackend('webgpu');
            await tf.ready();
            // Use loadGraphModel instead
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
            // 1. Create a tensor from the video frame
            const frame = tf.browser.fromPixels(videoElement);

            // 2. Pre-process the tensor
            const resized = tf.image.resizeBilinear(frame, [MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
            const normalized = resized.div(127.5).sub(1);
            const batched = normalized.expandDims(0);

            // 3. Run inference
            let depth = this.model!.predict(batched) as tf.Tensor;

            // 4. Post-process the output
            depth = depth.squeeze([0]);
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
