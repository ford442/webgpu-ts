import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';

interface WebGPUCanvasProps {
    mode: RenderMode;
    rendererRef: React.MutableRefObject<Renderer | null>;
    onRendererReady: () => void;
    params: {
        farthestPoint: { x: number; y: number };
        imageDimensions: { width: number; height: number };
        depthDimensions: { width: number; height: number };
        parallaxStrength: number;
    }
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = (props) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const container = canvas.parentElement;
        if (!container) return;
        const renderer = new Renderer(canvas);

        const initRenderer = async () => {
            const success = await renderer.init();
            if (success) {
                props.rendererRef.current = renderer;
                props.onRendererReady();
                
                // Initial resize
                renderer.handleResize();
                // Setup observer for future resizes
                const observer = new ResizeObserver(() => {
                    renderer.handleResize();
                });
                observer.observe(container);

                // Cleanup observer on component unmount
                return () => observer.disconnect();
            }
        };
        initRenderer();
    }, [props.rendererRef, props.onRendererReady]);

    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active || !props.rendererRef.current) return;
            // Pass all params directly to the unified render method
            props.rendererRef.current.render(props.mode, props.params);
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [props.mode, props.params, props.rendererRef]);

    return (
        <canvas ref={canvasRef} />
    );
};

export default WebGPUCanvas;
