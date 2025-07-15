# WebGPU Summer Workshop: Synthetic Animation in the Browser

This repository holds the code and resources for the WebGPU Summer Workshop, focusing on creating synthetic animations in the browser using WebGPU.

This README provides all the materials for the workshop.

## Introduction

[WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) is an API standard developed by the [W3C](https://www.w3.org/) committee to provide a more modern way to access the GPU through browsers.

While there is [WebGL](https://developer.mozilla.org/en-US/docs/Glossary/WebGL) for rendering graphics in the browser, WebGPU provides a lower-level interface and is designed to be more efficient and powerful, allowing developers to create complex graphics applications directly in the browser.

> [!NOTE]
>
> WebGPU is still in development and not yet widely supported in all browsers. Check the [WebGPU implementation status page](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) for the latest updates on browser support.
>
> At the time of writing, WebGPU is only generally available in chromium-based browsers like Chrome and Edge. Firefox and Safari require enabling experimental features to use WebGPU.

## Workshop Overview

This workshop is designed for anyone with a basic understanding of programming. We will explore the WebGPU API and how to use it to create graphics and interactive animations in the browser. Therefore, most of the code has already been implemented for you, you will only need to fill in the most essential parts.

This workshop is structured as follows:

1. Implement traditional render pipeline that renders a simple triangle.
2. Implement compute pipeline to simulate physics.
3. Implement interaction with the simulation to create a synthetic animation.

> [!NOTE]
>
> This workshop will only focus on the WebGPU API in JavaScript in the [triangle](./triangle/) and [particles](./particles/) pages, we will not cover the basics of web development like HTML and CSS.

## Getting Started

To get started with the workshop, follow these steps:

1. Clone this repository:
   ```bash
   git clone https://github.com/LioQing/webgpu-summer-workshop-2025.git
   ```
2. Checkout the `scaffold` branch:
   ```bash
   git checkout scaffold
   ```
3. Open the `index.html` file in a browser.
    - If you are using Visual Studio Code, you can install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension to see changes in real-time.
    - If you are using another editor, you can use Python's built-in HTTP server:
      ```bash
      python -m http.server 8000
      ```

> [!NOTE]
>
> I vibe coded 90% of the code in this workshop, but I reviewed 100% of the code, so feel free to ask questions if you have any doubts about the code.

## 1. Triangle Rendering

In the first part of the workshop, we will implement a traditional rendering pipeline to render a simple triangle using WebGPU.

### Terminology

First, let's define some key terms related to graphics programming:

- **Render Pipeline**: a sequence of instructions for GPU to render graphics.
    - **Vertex**: a position in space.
    - **Fragment**: a pixel in the final image.
- **Shader**: a program that run on the GPU to process things.
- **Buffer**: a piece of memory storage on the GPU.
    - **Vertex Buffer**: a buffer with an array of vertices.
    - **Index Buffer**: a buffer with an array of indices to access vertices.
    - **Uniform Buffer**: a buffer with data that can be read by shaders.
    - **Storage Buffer**: a buffer that can be read and written by shaders.
- **Bind Group**: a collection of buffers and textures that is defined for a shader to access.

### Render Pipeline

Then, let's take a look at what a render pipeline looks like:

```mermaid
graph LR
    subgraph Application
    A[Create Pipeline] --> B[Create Buffer]
    end
    subgraph "Render Pipeline"
    B --> C[Vertex Shader]
    C --> D[Fragment Shader]
    end
    begin "Render Targets"
    D --> E[Screen]
    D --> F[Image]
    end
```

> [!NOTE]
>
> If the application already created all the data in the buffer, why do we need to run the shaders?
>
> Sometimes, we may want to modify the data on GPU instead of CPU, for example, to rotate an entire object with a lot of vertices, CPU just need to pass all the initial vertex positions in the vertex buffer and the rotation in a uniform buffer, and GPU can do it in parallel, which is much faster than CPU doing it one by one.

While there are a lot of different types of shaders, vertex and fragment shaders are the most fundamental ones for rendering graphics.

> [!NOTE]
>
> Why are there different types of shaders?
>
> Shaders are designed to run on different stages of the rendering pipeline, each with its own specific purpose. GPUs can specialize their hardware for different types of shaders, allowing for more efficient processing of graphics data.

### Calling WebGPU Rendering API

Let's open [triangle/triangle.js](./triangle/index.js) and take a look at the code.

```javascript
let renderPipeline; // The render pipeline for drawing the triangle
let vertexBuffer; // The vertex buffer containing triangle vertices
let uniformsBuffer; // The uniforms buffer for screen resolution
let bindGroup; // The bind group for passing uniforms to the shader

// Resize the canvas and update buffers
function resizeCanvas() {
    // ...
}

// Create uniforms buffer for screen resolution
function createUniformsBuffer() {
    // ...
}

// Update uniforms buffer with current canvas resolution
function updateUniformsBuffer() {
    // ...
}

// Create vertex buffer
function createVertexBuffer() {
    // ...
}

// Update vertex buffer with current canvas resolution
function updateVertexBuffer() {
    // ...
}

// Create bind group for render pipeline
function createBindGroup() {
    // ...
}

// Create render pipeline for triangle rendering
async function createRenderPipeline() {
    // ...
}

// Run render shader to draw the triangle
function runRenderShader() {
    // ...
}

// Update function to render the triangle
function update() {
    // ...
    
    // Run render shader to draw triangle
    if (renderPipeline) {
        runRenderShader();
    }

    // Request next frame
    requestAnimationFrame(update);
    
    // ...
}

// Initialize WebGPU
async function init() {
    // ...

    // Initialize device and context
    await initDeviceAndContext();

    // Configure context
    configureContext();

    // Create uniform buffer
    createUniformsBuffer();
    
    // Create vertex buffer
    createVertexBuffer();

    // Create render pipeline
    await createRenderPipeline();
    
    // Create bind group
    createBindGroup();
    
    // Start render loop
    update();

    // ...
}
```

We can break down the code into several key parts:

1. Initializing the device and context
   ```javascript
   // Initialize device and context
   await initDeviceAndContext();
   
   // Configure context
   configureContext();
   ```
    - Device represents the GPU which lets us create resources and run shaders.
    - Context is an object that tells the GPU to render to a specific canvas.
    - [utils.js](./utils.js) contains utility functions to initialize them so we can focus on the rendering logic instead of the setup.
2. Create the buffers
   ```javascript
   // Create uniform buffer
   createUniformsBuffer();
   
   // Create vertex buffer
   createVertexBuffer();
   ```
    - We create buffers to store uniforms and vertices.
    - The uniforms hold the screen resolution for reason that will be explained in [the next section](#triangle-render-shader).
    - The vertex buffer holds the vertex positions and colors of the triangle.
    - The buffers are created using the device's [`createBuffer`](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createBuffer) method.
    - The buffers are then written to using the device queue's [`writeBuffer`](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeBuffer) method.
    - Queues are used to submit commands/instructions to the GPU, they are not executed immediately, but rather scheduled for execution later using the [`submit`](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/submit) method.
3. Create the render pipeline and bind group
   ```javascript
   // Create render pipeline
   await createRenderPipeline();
   
   // Create bind group
   createBindGroup();
   ```
    - The render pipeline is created using the device's [`createRenderPipeline`](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createRenderPipeline) method.
    - In the pipeline descriptor, we need to specify the vertex and fragment shaders, the bind group layout, and the topology of the geometry.
    - WebGPU API in JavaScript allows us to automatically detect the shader's bind group layout, which simplifies a lot of the boilerplate code.
    - The topology is set to `triangle-list`, which will render every 3 vertices as a triangle.
    - The bind group is created using the device's [`createBindGroup`](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createBindGroup) method, which binds the buffers to the pipeline.
4. Finally, we update every frame to render the triangle, which also responds to canvas resize
   ```javascript
   // Run render shader to draw triangle
   if (renderPipeline) {
       runRenderShader();
   }

   // Request next frame
   requestAnimationFrame(update);
   ```
    - To run the shader, we need to call the device's [`createCommandEncoder`](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createCommandEncoder) method to create a [`GPUCommandEncoder`](https://developer.mozilla.org/en-US/docs/Web/API/GPUCommandEncoder), and then use the encoder's [`beginRenderPass`](https://developer.mozilla.org/en-US/docs/Web/API/GPUCommandEncoder/beginRenderPass) method to create a render pass.
    - The render pass is where we specify the render targets (the canvas) and the bind group to use.

### Triangle Render Shader

Shaders in WebGPU are written in a language called [WGSL](https://www.w3.org/TR/WGSL/), which is a shading language designed for WebGPU.

Let's take a look at the vertex and fragment shaders in [triangle/triangle.wgsl](./triangle/triangle.wgsl):

```wgsl
struct Uniforms {
    resolution: vec2<f32>,
}

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) color: vec3<f32>,
}

struct FragmentInput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> FragmentInput {
    var out: FragmentInput;
    
    // ...

    return out;
}

@fragment
fn fs_main(input: FragmentInput) -> @location(0) vec4<f32> {
    return vec4<f32>(input.color, 1.0);
}
```

We can take a look at each part of the shader:

1. Define structs and bind groups
    ```wgsl
    struct Uniforms {
         resolution: vec2<f32>,
    }
    
    struct VertexInput {
         @location(0) position: vec2<f32>,
         @location(1) color: vec3<f32>,
    }
    
    struct FragmentInput {
         @builtin(position) position: vec4<f32>,
         @location(0) color: vec3<f32>,
    }
    
    @group(0) @binding(0) var<uniform> uniforms: Uniforms;
    ```
     - We define a `Uniforms` struct to hold the screen resolution.
     - The `VertexInput` struct holds the vertex position and color, while the `FragmentInput` struct holds the position and color for the fragment shader.
     - The `@location` attribute specifies the input/output locations for the vertex and fragment shaders.
     - The `@builtin(position)` attribute specifies that the position is a built-in output for the vertex shader, which will be used to determine where the vertex is drawn on the screen.
     - These structs must match the layout of the buffers we created in JavaScript.
     - The `@group` and `@binding` attributes specify the group and binding of the buffer, which lets us to organize our resources.
2. Calculate normalized device coordinates (NDC) in the vertex shader
   ```wgsl
   @vertex
   fn vs_main(input: VertexInput) -> FragmentInput {
       var out: FragmentInput;
       
       let ndc = (input.position / uniforms.resolution) * 2.0 - 1.0;
       let flipped_ndc = vec2<f32>(ndc.x, -ndc.y);
       
       out.position = vec4<f32>(flipped_ndc, 0.0, 1.0);
       out.color = input.color;
       return out;
   }
   ```
    - The vertex shader function is annotated with `@vertex`.
    - The vertex shader takes the `VertexInput` and outputs `FragmentInput`.
    - It converts the vertex position from pixel coordinates to normalized device coordinates(NDC) by scaling it to the range [-1, 1] with the given screen resolution in the uniforms buffer.
    - The color is passed directly to the fragment shader.
3. Simply output the color in the fragment shader
   ```wgsl
   @fragment
   fn fs_main(input: FragmentInput) -> @location(0) vec4<f32> {
       return vec4<f32>(input.color, 1.0);
   }
   ```
    - The fragment shader function is annotated with `@fragment`.
    - The fragment shader takes the `FragmentInput` and outputs a color.
    - It simply returns the color with an alpha value of 1.0 (fully opaque).
    - The color will be linearly interpolated between the vertices of the triangle, which is the default behavior in most graphics APIs.

### Triangle

After finishing everything, you should be able to see a triangle with red, green, and blue colors on the page.

![triangle.png](./media/triangle.png)