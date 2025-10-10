// src/renderer/modes/index.ts

import { IRenderMode } from '../IRenderMode';
import { RenderMode } from '../types';
import { LightingMode } from './LightingMode';
import { LiquidMode } from './LiquidMode';
// Import other modes here as you create them

export const renderModes: Record<RenderMode, new () => IRenderMode> = {
    'liquid-v1': LightingMode,
    'liquid': LiquidMode,
    // Add other modes here
    'shader': LightingMode,
    'image': LightingMode,
    'video': LightingMode,
    'ripple': LightingMode,
    'liquid-zoom': LightingMode,
    'liquid-vortex': LightingMode,
    'liquid-perspective': LightingMode,
    'vortex': LightingMode,
};
