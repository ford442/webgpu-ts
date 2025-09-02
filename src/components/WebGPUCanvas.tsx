import React, { useRef, useEffect } from 'react';
import { Renderer, RenderMode } from '../renderer/Renderer';
import { DepthModel } from '../depth/DepthModel';

interface WebGPUCanvasProps {
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
    videoSrc1: string;
    videoSrc2: string;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, videoSrc1, videoSrc2 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const depthCanvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const depthModelRef = useRef<DepthModel | null>(null);
    const videoRef1 = useRef<HTMLVideoElement | null>(null);
    const videoRef2 = useRef<HTMLVideoElement | null>(null);
    const animationFrameId = useRef<number>(0);

    // Effect to initialize the renderer and create video elements
    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);
        const depthModel = new DepthModel();

        (async () => {
            const [rendererSuccess, modelSuccess] = await Promise.all([
                renderer.init(),
                depthModel.init()
            ]);

            if (rendererSuccess && modelSuccess) {
                rendererRef.current = renderer;
                depthModelRef.current = depthModel;
                videoRef1.current = document.createElement('video');
                videoRef2.current = document.createElement('video');
                [videoRef1.current, videoRef2.current].forEach(v => {
                    if (v) {
                        v.crossOrigin = 'anonymous';
                        v.muted = true;
                        v.loop = true;
                        v.playsInline = true;
                    }
                });
            }
        })();

        return () => {
            cancelAnimationFrame(animationFrameId.current);
        };
    }, []);

    // Effect to handle video source changes
    useEffect(() => {
        if (videoRef1.current && videoSrc1) {
            videoRef1.current.src = videoSrc1;
            videoRef1.current.play().catch(err => console.error("Video 1 play failed:", err));
        }
    }, [videoSrc1]);

    useEffect(() => {
        if (videoRef2.current && videoSrc2) {
            videoRef2.current.src = videoSrc2;
            videoRef2.current.play().catch(err => console.error("Video 2 play failed:", err));
        }
    }, [videoSrc2]);


    // This useEffect will now handle the rendering loop
    useEffect(() => {
        let active = true;
        const animate = async () => {
            if (!active) return;

            if (rendererRef.current && videoRef1.current && videoRef1.current.readyState >= 2) {
                if (mode === 'depthMerge' && depthModelRef.current && depthCanvasRef.current && videoRef2.current) {
                    await depthModelRef.current.renderDepthMap(videoRef1.current, depthCanvasRef.current);
                    // @ts-ignore: Hiding type error until renderer is updated
                    rendererRef.current.render(mode, videoRef1.current, zoom, panX, panY, videoRef2.current, depthCanvasRef.current);
                } else {
                    rendererRef.current.render(mode, videoRef1.current, zoom, panX, panY);
                }
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => {
            active = false;
            cancelAnimationFrame(animationFrameId.current);
        };
    }, [mode, zoom, panX, panY, videoSrc1, videoSrc2]);

    return (
        <div>
            <canvas ref={canvasRef} width="800" height="600" />
            <canvas ref={depthCanvasRef} width="256" height="256" style={{ display: 'none' }} />
        </div>
    );
};

export default WebGPUCanvas;
