import { Renderer } from './renderer';

async function main() {
    const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
    const renderer = new Renderer(canvas);
    await renderer.init();

    const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement;
    const panXSlider = document.getElementById('pan-x-slider') as HTMLInputElement;
    const panYSlider = document.getElementById('pan-y-slider') as HTMLInputElement;

    zoomSlider.addEventListener('input', () => {
        renderer.setZoom(parseFloat(zoomSlider.value) / 100);
    });

    panXSlider.addEventListener('input', () => {
        renderer.setPanX(parseFloat(panXSlider.value) / 100);
    });

    panYSlider.addEventListener('input', () => {
        renderer.setPanY(parseFloat(panYSlider.value) / 100);
    });

    function animate() {
        renderer.render();
        requestAnimationFrame(animate);
    }
    animate();
}

main().catch(err => {
    console.error(err);
    alert('An error occurred while initializing the application. Please ensure your browser supports WebGPU.');
});
