import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';

// This interface now includes ALL possible props for any render mode
interface WebGPUCanvasProps {
    mode: RenderMode;
    rendererRef: React.MutableRefObject<Renderer | null>;
    farthestPoint: { x: number; y: number };
    depthThreshold: number;
    edgeHardness: number;
    imageDimensions: { width: number; height: number };
    depthLevels: number;
    depthDimensions: { width: number; height: number };
    fogColor: string;
    fogDensity: number;
    parallaxStrength: number;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = (props) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);
    const isDragging = useRef(false);

    useEffect(() => {
        // ... (Initialization useEffect remains the same)
    }, [props.rendererRef]);

    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (props.rendererRef.current) {
                props.rendererRef.current.render(
                    props.mode, props.farthestPoint, props.depthThreshold, 
                    props.edgeHardness, props.imageDimensions, props.depthLevels, 
                    props.depthDimensions, props.fogColor, props.fogDensity, props.parallaxStrength
                );
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [props]); // Simple dependency array on all props

    // Add wheel listener for 3D parallax zoom
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const handleWheel = (event: WheelEvent) => {
            if (props.mode === '3d-parallax') {
                event.preventDefault();
                props.rendererRef.current?.updateZoom(event.deltaY);
            }
        };
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => { canvas.removeEventListener('wheel', handleWheel); };
    }, [props.rendererRef, props.mode]);

    const handleMouseDown = () => { if (props.mode === '3d-parallax') isDragging.current = true; };
    const handleMouseUp = () => {
        if (props.mode === '3d-parallax') {
            isDragging.current = false;
            props.rendererRef.current?.stopMouseDrag();
        }
    };
    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (props.rendererRef.current && canvas && props.mode === '3d-parallax') {
            const rect = canvas.getBoundingClientRect();
            props.rendererRef.current.updateMouse(
                event.clientX - rect.left,
                event.clientY - rect.top,
                isDragging.current
            );
        }
    };

    return (
        <canvas 
            ref={canvasRef} 
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove} 
            onMouseLeave={handleMouseUp}
        />
    );
};

export default WebGPUCanvas;
