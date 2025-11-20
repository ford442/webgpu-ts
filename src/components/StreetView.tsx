import React, { useEffect, useRef, useState } from 'react';

interface StreetViewProps {
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
    onPanoramaReady: (pano: google.maps.StreetViewPanorama) => void;
    apiKey: string;
}

const StreetView: React.FC<StreetViewProps> = ({ onCanvasReady, onPanoramaReady, apiKey }) => {

    const panoRef = useRef<HTMLDivElement>(null);
    const [panorama, setPanorama] = useState<google.maps.StreetViewPanorama | null>(null);

    // Coordinates from your original HTML
    const startLocation = { lat: 39.2575004, lng: -121.021821 };

    useEffect(() => {
        // Check if Google Maps is already loaded
        if (!(window as any).google) {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=alpha`;
            script.async = true;
            script.defer = true;
            script.onload = initialize;
            document.body.appendChild(script);
        } else {
            initialize();
        }

        function initialize() {
            if (!panoRef.current) return;

            // Create a Map instance (required context for some StreetView features)
            const mapDiv = document.createElement('div');
            const mapInstance = new google.maps.Map(mapDiv, {
                center: startLocation,
                zoom: 12,
            });

            // Create the Panorama attached to our ref
            const panoInstance = new google.maps.StreetViewPanorama(panoRef.current!, {
                position: startLocation,
                pov: { heading: 34, pitch: 10 },
                zoom: 1,
                showRoadLabels: false,
                disableDefaultUI: true
            });

            mapInstance.setStreetView(panoInstance);
            setPanorama(panoInstance);
            onPanoramaReady(panoInstance);

            // --- CRITICAL UPDATE: Wait for valid dimensions ---
            // We poll faster (100ms) but wait for dimensions > 100px
            // This ignores the initial 1x1 or 0x0 initialization state
            const checkForCanvas = setInterval(() => {
                if (panoRef.current) {
                    const canvases = panoRef.current.getElementsByTagName('canvas');
                    if (canvases.length > 0) {
                        const canvas = canvases[0];
                        
                        // FIX: Ensure canvas has SUBSTANTIAL dimensions. 
                        // Google Maps often inits at 1px height initially.
                        if (canvas.width > 100 && canvas.height > 100) {
                            console.log("StreetView Canvas Ready:", canvas.width, "x", canvas.height);
                            onCanvasReady(canvas);
                            clearInterval(checkForCanvas);
                        }
                    }
                }
            }, 100);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiKey]);

    // --- Navigation Logic ---
    const findNextPano = (links: (google.maps.StreetViewLink | null)[] | null, currentHeading: number) => {
        if (!links) return null;
        let closestHeadingDiff = 360;
        let closestPanoId = null;
        for (const link of links) {
            if (!link) continue;
            const headingDiff = Math.abs((link.heading || 0) - currentHeading);
            if (headingDiff < closestHeadingDiff) {
                closestHeadingDiff = headingDiff;
                closestPanoId = link.pano;
            }
        }
        return closestPanoId;
    };

    const handleMoveForward = () => {
        if (!panorama) return;
        const links = panorama.getLinks();
        const pov = panorama.getPov();
        const nextPanoId = findNextPano(links, pov.heading);
        if (nextPanoId) {
            panorama.setPano(nextPanoId);
        }
    };

    const handleZoomIn = () => panorama?.setZoom(panorama.getZoom() + 1);
    const handleZoomOut = () => panorama?.setZoom(panorama.getZoom() - 1);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* The actual StreetView div */}
            <div 
                ref={panoRef} 
                style={{ 
                    width: '100%', 
                    height: '100%', 
                    // Keep opacity just above 0 to ensure the browser renders the WebGL context
                    opacity: 0.01, 
                    pointerEvents: 'auto', 
                    position: 'absolute',
                    zIndex: 1
                }} 
            />

            {/* Custom Controls Overlay */}
            <div className="streetview-controls" style={{ 
                position: 'absolute', 
                bottom: 20, 
                left: '50%', 
                transform: 'translateX(-50%)', 
                zIndex: 100, 
                display: 'flex', 
                gap: 10 
            }}>
                <button onClick={handleMoveForward} style={btnStyle}>Forward</button>
                <button onClick={handleZoomIn} style={btnStyle}>Zoom In</button>
                <button onClick={handleZoomOut} style={btnStyle}>Zoom Out</button>
            </div>
        </div>
    );
};

const btnStyle: React.CSSProperties = {
    padding: '10px 20px',
    backgroundColor: 'gold',
    border: '2px solid white',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 'bold',
    color: 'black'
};

export default StreetView;
