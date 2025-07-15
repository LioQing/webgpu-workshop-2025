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

// WebGPU variables
let renderPipeline; // The render pipeline for drawing the circles
let computePipeline; // The compute pipeline for moving the circles
let vertexBuffer; // The vertex buffer containing circle geometry
let indexBuffer; // The index buffer for circle triangles
let circleBuffer; // The buffer containing circle data (position, color, velocity)
let uniformsBuffer; // The uniforms buffer for screen resolution
let timeBuffer; // The time buffer for delta time
let bindGroup; // The bind group for passing uniforms to the shader
let computeBindGroup; // The bind group for the compute pipeline

// Circle configuration
let num_circles = 128;
const CIRCLE_RADIUS = 5;
const CIRCLE_SEGMENTS = 16; // Number of triangles to approximate a circle
const CIRCLE_SPAWN_RADIUS = 1.5 * CIRCLE_RADIUS; // Minimum distance between circles
const SPEED = 60.0; // Movement speed in pixels per second
let circles = []; // Array to store circle data (position, color, velocity)

// Gravity state
let isGravityReversed = false;

// Update gravity status display
function updateGravityDisplay() {
    const gravityStatus = document.getElementById('gravity-status');
    if (gravityStatus) {
        if (isGravityReversed) {
            gravityStatus.textContent = 'Gravity: Upward';
            gravityStatus.classList.add('reversed');
        } else {
            gravityStatus.textContent = 'Gravity: Downward';
            gravityStatus.classList.remove('reversed');
        }
    }
}

// Resize the canvas and update buffers
function resizeCanvas() {
    resizeCanvasUtil();

    // Update uniform buffer with new resolution
    if (uniformsBuffer) {
        updateUniformsBuffer();
    }
    
    // Regenerate circles with new canvas dimensions
    if (circleBuffer) {
        generateCircles();
        updateCircleBuffer();
    }
}

// Create uniforms buffer for screen resolution
function createUniformsBuffer() {
    try {
        uniformsBuffer = gpuState.device.createBuffer({
            label: 'Uniform buffer',
            size: 4 * 4, // resolution (width, height) (2 floats) + is_gravity_reversed (1 int) + padding (1 float)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
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
        const uniformData = new Float32Array([
            htmlState.canvas.width, 
            htmlState.canvas.height,
            isGravityReversed ? 1.0 : 0.0,
            0.0
        ]);
        gpuState.device.queue.writeBuffer(uniformsBuffer, 0, uniformData);
    } catch (error) {
        showErrorToast(`Error updating uniform buffer: ${error.message}`);
        console.error('Uniform buffer update error:', error);
    }
}

// Create vertex buffer for circle geometry
function createVertexBuffer() {
    try {
        // Create a single circle geometry (center + edge vertices)
        const vertices = [];
        
        // Center vertex
        vertices.push(0.0, 0.0);
        
        // Edge vertices
        for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
            const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
            vertices.push(
                Math.cos(angle) * CIRCLE_RADIUS,
                Math.sin(angle) * CIRCLE_RADIUS
            );
        }
        
        const vertexData = new Float32Array(vertices);
        
        vertexBuffer = gpuState.device.createBuffer({
            label: 'Circle vertices',
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });
        
        gpuState.device.queue.writeBuffer(vertexBuffer, 0, vertexData);
        
        // Create index buffer for triangles
        const indices = [];
        for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
            const next = (i + 1) % CIRCLE_SEGMENTS;
            // Triangle from center to edge
            indices.push(0, i + 1, next + 1);
        }
        
        const indexData = new Uint32Array(indices);
        
        indexBuffer = gpuState.device.createBuffer({
            label: 'Circle indices',
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
        });
        
        gpuState.device.queue.writeBuffer(indexBuffer, 0, indexData);
    } catch (error) {
        showErrorToast(`Error creating vertex buffer: ${error.message}`);
        console.error('Vertex buffer creation error:', error);
        throw error;
    }
}

// Generate random circles
function generateCircles() {
    // We divide the canvas into a grid of circles and store whether each circle is occupied
    const occupied = new Array(Math.floor(htmlState.canvas.width / (2 * CIRCLE_SPAWN_RADIUS)))
        .fill(false)
        .map(() => new Array(Math.floor(htmlState.canvas.height / (2 * CIRCLE_SPAWN_RADIUS)))
            .fill(false)
        );

    circles = [];
    
    for (let i = 0; i < num_circles; i++) {
        let x, y, gridX, gridY;
        do {
            gridX = Math.floor(Math.random() * occupied.length);
            gridY = Math.floor(Math.random() * occupied[0].length);
            x = gridX * 2 * CIRCLE_SPAWN_RADIUS + CIRCLE_SPAWN_RADIUS;
            y = gridY * 2 * CIRCLE_SPAWN_RADIUS + CIRCLE_SPAWN_RADIUS;
        } while (occupied[gridX] && occupied[gridX][gridY]);

        const r = Math.random() * 0.5 + 0.5; // Random red component (0.5 to 1.0)
        const g = Math.random() * 0.5 + 0.5; // Random green component (0.5 to 1.0)
        const b = Math.random() * 0.5 + 0.5; // Random blue component (0.5 to 1.0)
        
        // Random velocity direction
        const angle = Math.random() * Math.PI * 2;
        const vx = Math.cos(angle) * SPEED;
        const vy = Math.sin(angle) * SPEED;
        const ax = 0;
        const ay = 0;

        circles.push({ x, y, vx, vy, ax, ay, r, g, b });

        occupied[gridX][gridY] = true;
    }
}

// Create circle buffer for circle data
function createCircleBuffer() {
    try {
        circleBuffer = gpuState.device.createBuffer({
            label: 'Circle buffer',
            size: num_circles * 12 * 4, // position (2 floats) + velocity (2 floats) + acceleration (2 floats) + padding (2) + color (3 floats) + padding (1)
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        generateCircles();
        updateCircleBuffer();
    } catch (error) {
        showErrorToast(`Error creating circle buffer: ${error.message}`);
        console.error('Circle buffer creation error:', error);
        throw error;
    }
}

// Update circle buffer with current circle data
function updateCircleBuffer() {
    try {
        const circleData = [];
        
        for (let i = 0; i < num_circles; i++) {
            const circle = circles[i];
            circleData.push(circle.x, circle.y, circle.vx, circle.vy, circle.ax, circle.ay, 0, 0, circle.r, circle.g, circle.b, 0);
        }
        
        const circleArray = new Float32Array(circleData);
        gpuState.device.queue.writeBuffer(circleBuffer, 0, circleArray);
    } catch (error) {
        showErrorToast(`Error updating circle buffer: ${error.message}`);
        console.error('Circle buffer update error:', error);
    }
}

// Create time buffer for delta time
function createTimeBuffer() {
    try {
        timeBuffer = gpuState.device.createBuffer({
            label: 'Time buffer',
            size: 1 * 4, // deltaTime (1 float)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
    } catch (error) {
        showErrorToast(`Error creating time buffer: ${error.message}`);
        console.error('Time buffer creation error:', error);
        throw error;
    }
}

// Update time buffer with delta time
function updateTimeBuffer(deltaTime) {
    try {
        const timeData = new Float32Array([deltaTime]);
        gpuState.device.queue.writeBuffer(timeBuffer, 0, timeData);
    } catch (error) {
        showErrorToast(`Error updating time buffer: ${error.message}`);
        console.error('Time buffer update error:', error);
    }
}

// Update function to render the circles
let lastTime = 0;
function update(currentTime = 0) {
    try {
        // Calculate delta time
        const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
        lastTime = currentTime;

        // Run compute shader to update particle positions
        // Cap delta time to prevent large jumps and ensure minimum time has passed
        if (computePipeline && deltaTime > 0.001 && deltaTime < 0.1) {
            runComputeShader(deltaTime);
        }

        // Run render shader to draw particles
        if (renderPipeline) {
            runRenderShader();
        }

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

// Create render pipeline for particle rendering
async function createRenderPipeline() {
    try {
        // Load render shader
        const response = await fetch('circles.wgsl');
        if (!response.ok) {
            throw new Error(`Failed to load render shader: ${response.status} ${response.statusText}`);
        }
        const shaderCode = await response.text();

        // Create shader module
        const shaderModule = gpuState.device.createShaderModule({
            label: 'Circles shader',
            code: shaderCode
        });

        validateShader(shaderCode);

        // Create render pipeline
        renderPipeline = gpuState.device.createRenderPipeline({
            label: 'Circles render pipeline',
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        // Vertex buffer (circle geometry)
                        arrayStride: 2 * 4, // position (2 floats)
                        stepMode: 'vertex',
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x2' // position
                        }]
                    }
                ]
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
    } catch (error) {
        showErrorToast(`Error creating render pipeline: ${error.message}`);
        console.error('Render pipeline creation error:', error);
        throw error;
    }
}

// Create compute pipeline for particle movement
async function createComputePipeline() {
    try {
        // Load compute shader
        const response = await fetch('movement.wgsl');
        if (!response.ok) {
            throw new Error(`Failed to load compute shader: ${response.status} ${response.statusText}`);
        }
        const computeShaderCode = await response.text();

        // Create compute shader module
        const computeShaderModule = gpuState.device.createShaderModule({
            label: 'Movement compute shader',
            code: computeShaderCode
        });

        validateShader(computeShaderCode);

        // Create compute pipeline
        computePipeline = gpuState.device.createComputePipeline({
            label: 'Movement compute pipeline',
            layout: 'auto',
            compute: {
                module: computeShaderModule,
                entryPoint: 'main'
            }
        });
    } catch (error) {
        showErrorToast(`Error creating compute pipeline: ${error.message}`);
        console.error('Compute pipeline creation error:', error);
        throw error;
    }
}

// Create bind groups for render and compute pipelines
function createBindGroups() {
    try {
        // Create render bind group
        const bindGroupLayout = renderPipeline.getBindGroupLayout(0);
        bindGroup = gpuState.device.createBindGroup({
            label: 'Circles bind group',
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: circleBuffer }
                }
            ]
        });

        // Create compute bind group
        const computeBindGroupLayout = computePipeline.getBindGroupLayout(0);
        computeBindGroup = gpuState.device.createBindGroup({
            label: 'Compute bind group',
            layout: computeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: circleBuffer }
                },
                {
                    binding: 2,
                    resource: { buffer: timeBuffer }
                }
            ]
        });
    } catch (error) {
        showErrorToast(`Error creating bind groups: ${error.message}`);
        console.error('Bind group creation error:', error);
        throw error;
    }
}

// Run render shader to draw particles
function runRenderShader() {
    try {
        // Get current texture from canvas
        const currentTexture = gpuState.context.getCurrentTexture();
        
        // Create render pass descriptor
        const renderPassDescriptor = {
            label: 'Circles render pass',
            colorAttachments: [{
                view: currentTexture.createView(),
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        };

        // Create command encoder
        const encoder = gpuState.device.createCommandEncoder({
            label: 'Circles command encoder'
        });

        // Create render pass
        const renderPass = encoder.beginRenderPass(renderPassDescriptor);
        
        // Set pipeline, bind group, vertex buffer, and index buffer
        renderPass.setPipeline(renderPipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.setVertexBuffer(0, vertexBuffer);
        renderPass.setIndexBuffer(indexBuffer, 'uint32');
        
        // Draw instanced circles using indexed triangles
        // Each circle has CIRCLE_SEGMENTS triangles (3 indices each)
        const indicesPerCircle = CIRCLE_SEGMENTS * 3;
        renderPass.drawIndexed(indicesPerCircle, num_circles);
        
        // End render pass
        renderPass.end();

        // Submit commands
        gpuState.device.queue.submit([encoder.finish()]);
    } catch (error) {
        showErrorToast(`Render shader error: ${error.message}`);
        console.error('Render shader error:', error);
    }
}

// Run compute shader to update particle positions
function runComputeShader(deltaTime) {
    try {
        // Update time buffer with current delta time
        updateTimeBuffer(deltaTime);

        // Create command encoder
        const encoder = gpuState.device.createCommandEncoder({
            label: 'Compute command encoder'
        });

        // Create compute pass
        const computePass = encoder.beginComputePass({
            label: 'Movement compute pass'
        });

        // Set compute pipeline and bind group
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroup);

        // Dispatch compute shader
        const workgroupSize = 64;
        const numWorkgroups = Math.ceil(num_circles / workgroupSize);
        computePass.dispatchWorkgroups(numWorkgroups);

        // End compute pass
        computePass.end();

        // Submit compute commands
        gpuState.device.queue.submit([encoder.finish()]);
    } catch (error) {
        showErrorToast(`Compute shader error: ${error.message}`);
        console.error('Compute shader error:', error);
    }
}

// Restart simulation with new number of circles
async function restartSimulation(newNumCircles) {
    try {
        // Validate input
        const numCircles = parseInt(newNumCircles);
        if (isNaN(numCircles) || numCircles < 1 || numCircles > 1000) {
            showErrorToast('Number of circles must be between 1 and 1000');
            return;
        }
        
        // Update the variable
        num_circles = numCircles;
        
        // Destroy existing circle buffer
        if (circleBuffer) {
            circleBuffer.destroy();
        }
        
        // Recreate circle buffer with new size
        createCircleBuffer();
        
        // Recreate bind groups since buffer changed
        createBindGroups();
        
        console.log(`Simulation restarted with ${num_circles} circles`);
    } catch (error) {
        showErrorToast(`Error restarting simulation: ${error.message}`);
        console.error('Restart simulation error:', error);
    }
}

// Initialize WebGPU
async function init() {
    try {
        // Initialize device and context
        await initDeviceAndContext();

        // Configure context
        configureContext();

        // Create uniform buffer
        createUniformsBuffer();
        
        // Create vertex buffer (circle geometry)
        createVertexBuffer();
        
        // Create circle buffer (circle data)
        createCircleBuffer();
        
        // Create time buffer (delta time)
        createTimeBuffer();

        // Create render pipeline
        await createRenderPipeline();
        
        // Create compute pipeline
        await createComputePipeline();
        
        // Create bind groups
        createBindGroups();
        
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

    // Add spacebar event listener for gravity reversal
    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space') {
            event.preventDefault();
            isGravityReversed = !isGravityReversed;
            updateUniformsBuffer();
            updateGravityDisplay();
        }
    });

    // Add event listeners for circle controls
    const numCirclesInput = document.getElementById('num-circles-input');
    const applyButton = document.getElementById('apply-circles');
    
    if (numCirclesInput && applyButton) {
        applyButton.addEventListener('click', () => {
            const newNumCircles = numCirclesInput.value;
            restartSimulation(newNumCircles);
        });
        
        // Allow applying with Enter key
        numCirclesInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                const newNumCircles = numCirclesInput.value;
                restartSimulation(newNumCircles);
            }
        });
    }

    // Initialize canvas size
    resizeCanvas();
    
    // Initialize gravity display
    updateGravityDisplay();
    
    // Initialize WebGPU
    init();
});
