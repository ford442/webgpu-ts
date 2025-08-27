/// <reference types="react-scripts" />
/// <reference types="@webgpu/types" />

declare module '*.wgsl' {
    const value: string;
    export default value;
}
