// Import utility functions and variables
import {
    htmlState,
    gpuState,
    showErrorToast,
    resizeCanvas as resizeCanvasUtil,
    configureContext,
    initDeviceAndContext,
    validateShader,
    initElements
} from './utils.js';

let renderPipeline; // The render pipeline for drawing the triangle
let vertexBuffer; // The vertex buffer containing triangle vertices
let uniformsBuffer; // The uniforms buffer for screen resolution
let bindGroup; // The bind group for passing uniforms to the shader

// Resize the canvas and update buffers
function resizeCanvas() {
    resizeCanvasUtil();

    // Update uniform buffer with new resolution
    if (uniformsBuffer) {
        updateUniformsBuffer();
    }
    
    // Update vertex buffer with new resolution
    if (vertexBuffer) {
        updateVertexBuffer();
    }
}

// Create uniforms buffer for screen resolution
function createUniformsBuffer() {
    try {
        uniformsBuffer = gpuState.device.createBuffer({
            label: 'Uniform buffer',
            size: 2 * 4, // resolution (width, height) (2 floats)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        
        const bindGroupLayout = renderPipeline.getBindGroupLayout(0);
        
        bindGroup = gpuState.device.createBindGroup({
            label: 'Uniform bind group',
            layout: bindGroupLayout,
            entries: [{
                binding: 0,
                resource: {
                    buffer: uniformsBuffer
                }
            }]
        });

        updateUniformsBuffer();
    } catch (error) {
        showErrorToast(`Error creating uniform buffer: ${error.message}`);
        console.error('Uniform buffer creation error:', error);
        throw error;
    }
}

// Update uniforms buffer with current canvas resolution
function updateUniformsBuffer() {
    try {
        const resolution = new Float32Array([htmlState.canvas.width, htmlState.canvas.height]);
        gpuState.device.queue.writeBuffer(uniformsBuffer, 0, resolution);
    } catch (error) {
        showErrorToast(`Error updating uniform buffer: ${error.message}`);
        console.error('Uniform buffer update error:', error);
    }
}

// Create vertex buffer
function createVertexBuffer() {
    try {
        // Create vertex buffer
        vertexBuffer = gpuState.device.createBuffer({
            label: 'Triangle vertices',
            size: (2 + 3) * 3 * 4, // position (2 floats) + color (3 floats), 3 vertices
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });

        updateVertexBuffer();
    } catch (error) {
        showErrorToast(`Error creating vertex buffer: ${error.message}`);
        console.error('Vertex buffer creation error:', error);
        throw error;
    }
}

// Update vertex buffer with current canvas resolution
function updateVertexBuffer() {
    try {
        const centerX = htmlState.canvas.width / 2;
        const centerY = htmlState.canvas.height / 2;
        const size = Math.min(htmlState.canvas.width, htmlState.canvas.height) * 0.3; // 30% of smaller dimension
        
        const vertices = new Float32Array([
            // Top red vertex
            centerX, centerY - size,  1.0, 0.0, 0.0,
            // Bottom left green vertex
            centerX - size, centerY + size,  0.0, 1.0, 0.0,
            // Bottom right blue vertex
            centerX + size, centerY + size,  0.0, 0.0, 1.0
        ]);

        gpuState.device.queue.writeBuffer(vertexBuffer, 0, vertices);
    } catch (error) {
        showErrorToast(`Error updating vertex buffer: ${error.message}`);
        console.error('Vertex buffer update error:', error);
    }
}

// Update function to render the triangle
function update() {
    try {
        // Get current texture from canvas
        const currentTexture = gpuState.context.getCurrentTexture();
        
        // Create render pass descriptor
        const renderPassDescriptor = {
            label: 'Triangle render pass',
            colorAttachments: [{
                view: currentTexture.createView(),
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        };

        // Create command encoder
        const encoder = gpuState.device.createCommandEncoder({
            label: 'Triangle command encoder'
        });

        // Create render pass
        const renderPass = encoder.beginRenderPass(renderPassDescriptor);
        
        // Set pipeline, bind group, and vertex buffer
        renderPass.setPipeline(renderPipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.setVertexBuffer(0, vertexBuffer);
        
        // Draw triangle
        renderPass.draw(3);
        
        // End render pass
        renderPass.end();

        // Submit commands
        gpuState.device.queue.submit([encoder.finish()]);

        // Request next frame
        requestAnimationFrame(update);
    } catch (error) {
        showErrorToast(`Render error: ${error.message}`);
        console.error('Render error:', error);
        setTimeout(() => {
            requestAnimationFrame(update);
        }, 100);
    }
}

// Initialize WebGPU
async function init() {
    try {
        // Initialize device and context
        await initDeviceAndContext();

        // Configure context
        configureContext();

        // Load WGSL shader code from file
        const response = await fetch('triangle.wgsl');
        if (!response.ok) {
            throw new Error(`Failed to load shader file: ${response.status} ${response.statusText}`);
        }
        const shaderCode = await response.text();

        // Create shader module
        const shaderModule = gpuState.device.createShaderModule({
            label: 'Triangle shader',
            code: shaderCode
        });

        validateShader(shaderCode);

        // Create render pipeline
        renderPipeline = gpuState.device.createRenderPipeline({
            label: 'Triangle render pipeline',
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 5 * 4, // position (2 floats) + color (3 floats)
                    attributes: [
                        {
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x2' // position
                        },
                        {
                            shaderLocation: 1,
                            offset: 2 * 4, // color, after position (2 floats)
                            format: 'float32x3' // color
                        }
                    ]
                }]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat()
                }]
            },
            primitive: {
                topology: 'triangle-list'
            }
        });
        
        // Create uniform buffer
        createUniformsBuffer();
        
        // Create vertex buffer
        createVertexBuffer();
        
        // Start render loop
        update();
    } catch (error) {
        showErrorToast(`Error: ${error.message}`);
        console.error('WebGPU Error:', error);
    }
}

// Initialize everything when the page loads
document.addEventListener('DOMContentLoaded', () => {
    initElements();
    
    // Add global error handlers
    window.addEventListener('error', (event) => {
        showErrorToast(`JavaScript Error: ${event.message}`);
        console.error('Global error:', event.error);
    });
    
    window.addEventListener('unhandledrejection', (event) => {
        showErrorToast(`Unhandled Promise Rejection: ${event.reason}`);
        console.error('Unhandled promise rejection:', event.reason);
    });
    
    // Add resize event listener
    window.addEventListener('resize', resizeCanvas);

    // Initialize canvas size
    resizeCanvas();
    
    // Initialize WebGPU
    init();
});
