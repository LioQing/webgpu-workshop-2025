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
let circleBuffer; // The buffer containing circle data (position, velocity, acceleration, color)
let uniformsBuffer; // The uniforms buffer for screen resolution
let timeBuffer; // The time buffer for delta time
let bindGroup; // The bind group for passing uniforms to the shader
let computeBindGroup; // The bind group for the compute pipeline
let computeBGL; // Explicit compute bind group layout
let computePipelineLayout; // Explicit compute pipeline layout
// Keep a copy of the original movement.wgsl to support Reset
let originalMovementSource = '';
// Keep a copy of the empty template movement_empty.wgsl to support Empty button (lazy loaded)
let emptyMovementSource = '';

// Circle configuration
let num_circles = 128;
const CIRCLE_RADIUS = 5;
const CIRCLE_SEGMENTS = 16; // Number of triangles to approximate a circle
const CIRCLE_SPAWN_RADIUS = 4 * CIRCLE_RADIUS; // Minimum distance between circles
const SPEED = 60.0; // Movement speed in pixels per second
let circles = []; // Array to store circle data (position, velocity, acceleration, color)

// Interaction state
let mousePosition = { x: 0, y: 0 }; // Current mouse position
let isMouseDown = false;
let gravityDirection = 0.0; // 0 for none, -1 for downward, 1 for upward

// Update gravity state
function updateGravity() {
    if (gravityDirection == 0) {
        gravityDirection = -1.0;
    } else if (gravityDirection == -1) {
        gravityDirection = 1.0;
    } else {
        gravityDirection = 0.0;
    }
    updateUniformsBuffer();

    const gravityStatus = document.getElementById('gravity-status');
    if (gravityStatus) {
        // Remove all gravity classes
        gravityStatus.classList.remove('none', 'upward', 'downward');
        
        if (gravityDirection == 0) {
            gravityStatus.textContent = 'Gravity: None';
            gravityStatus.classList.add('none');
        } else if (gravityDirection == 1) {
            gravityStatus.textContent = 'Gravity: Upward';
            gravityStatus.classList.add('upward');
        } else {
            gravityStatus.textContent = 'Gravity: Downward';
            gravityStatus.classList.add('downward');
        }
    }
}

// Update mouse position and button state
function updateMousePosition(event, overrideDown = null) {
    if (overrideDown !== null) {
        isMouseDown = overrideDown;
        return;
    }

    const rect = htmlState.canvas.getBoundingClientRect();
    mousePosition.x = event.clientX - rect.left;
    mousePosition.y = event.clientY - rect.top;
    isMouseDown = event.buttons > 0;
    updateUniformsBuffer();
    
    const mouseStatus = document.getElementById('mouse-status');
    if (mouseStatus) {
        if (isMouseDown) {
            mouseStatus.textContent = `Mouse: (${Math.round(mousePosition.x)}, ${Math.round(mousePosition.y)})`;
            mouseStatus.classList.add('active');
        } else {
            mouseStatus.textContent = 'Mouse: None';
            mouseStatus.classList.remove('active');
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
            size: 8 * 4, // resolution (width, height) (2 floats) + mouse position (2 floats) + is_mouse_down (1 int) + gravity direction (1 float) + padding (2 float)
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
            mousePosition.x,
            mousePosition.y,
            isMouseDown ? 1.0 : 0.0,
            gravityDirection,
            0.0,
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
    const occupied = new Array(Math.floor(htmlState.canvas.width / CIRCLE_SPAWN_RADIUS))
        .fill(false)
        .map(() => new Array(Math.floor(htmlState.canvas.height / CIRCLE_SPAWN_RADIUS))
            .fill(false)
        );

    circles = [];
    
    for (let i = 0; i < num_circles; i++) {
        let x, y, gridX, gridY;
        do {
            gridX = Math.floor(Math.random() * occupied.length);
            gridY = Math.floor(Math.random() * occupied[0].length);
            x = gridX * CIRCLE_SPAWN_RADIUS + CIRCLE_RADIUS;
            y = gridY * CIRCLE_SPAWN_RADIUS + CIRCLE_RADIUS;
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
let fpsLastTime = 0;
let fpsFrames = 0;
let fpsSmoothed = 0;
function update(currentTime = 0) {
    try {
        // Calculate delta time
        const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
        lastTime = currentTime;

        // FPS counter
        fpsFrames++;
        if (currentTime - fpsLastTime >= 250) { // update 4x/sec
            const fps = (fpsFrames * 1000) / (currentTime - fpsLastTime || 1);
            fpsSmoothed = fpsSmoothed ? fpsSmoothed * 0.7 + fps * 0.3 : fps;
            const el = document.getElementById('fps-counter');
            if (el) el.textContent = `FPS: ${Math.round(fpsSmoothed)}`;
            fpsFrames = 0;
            fpsLastTime = currentTime;
        }

        // Run compute shader to update particle positions
        // Cap delta time to prevent large jumps and ensure minimum time has passed
        if (computePipeline && deltaTime > 0.001) {
            runComputeShader(Math.min(deltaTime, 0.1));
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

        // Ensure explicit layouts exist
        ensureComputeLayouts();

        // Create compute pipeline with explicit layout
        computePipeline = gpuState.device.createComputePipeline({
            label: 'Movement compute pipeline',
            layout: computePipelineLayout,
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

        // Create compute bind group using explicit layout
        ensureComputeLayouts();
        computeBindGroup = gpuState.device.createBindGroup({
            label: 'Compute bind group',
            layout: computeBGL,
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
        const workgroupSize = gpuState.device.limits.maxComputeWorkgroupSizeX;
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

// Recompile compute pipeline from WGSL code in the editor sidebar
async function recompileComputeFromEditor() {
    try {
        const codeEl = document.getElementById('shader-code');
        if (!codeEl) return;
        const code = codeEl.textContent || '';
        if (!code.trim()) {
            showErrorToast('Shader source is empty.');
            return;
        }

        // Create shader module and validate
        const module = gpuState.device.createShaderModule({
            label: 'Movement compute shader (live)',
            code
        });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(m => m.type === 'error');
        if (errors.length > 0) {
            const lines = code.split('\n');
            let html = 'Shader Errors:';
            for (const m of errors) {
                html += `\n<pre>`;
                html += `\n${m.message}`;
                if (m.lineNum !== undefined && m.linePos !== undefined) {
                    const lineNumber = m.lineNum;
                    const col = m.linePos;
                    const errorLine = lines[lineNumber - 1] || '';
                    const esc = document.createElement('div');
                    esc.textContent = errorLine;
                    const safeLine = esc.innerHTML;
                    html += `\n ${lineNumber} | ${safeLine}`;
                    const underline = '^'.repeat(Math.max(1, m.length || 1));
                    html += `\n ${' '.repeat(String(lineNumber).length)} | ${' '.repeat(Math.max(0, col - 1))}${underline}`;
                }
                html += `\n</pre>`;
            }
            showErrorToast(html, true, true);
            return;
        }

        // Ensure explicit layouts exist
        ensureComputeLayouts();

        // Build new pipeline with explicit layout
        const newPipeline = gpuState.device.createComputePipeline({
            label: 'Movement compute pipeline (live)',
            layout: computePipelineLayout,
            compute: { module, entryPoint: 'main' }
        });

        // Recreate compute bind group using explicit layout
        const newBindGroup = gpuState.device.createBindGroup({
            label: 'Compute bind group (live)',
            layout: computeBGL,
            entries: [
                { binding: 0, resource: { buffer: uniformsBuffer } },
                { binding: 1, resource: { buffer: circleBuffer } },
                { binding: 2, resource: { buffer: timeBuffer } }
            ]
        });

        // Swap in on success
        computePipeline = newPipeline;
        computeBindGroup = newBindGroup;
        console.log('Compute pipeline recompiled successfully.');
    } catch (error) {
        showErrorToast(`Recompile failed: ${error.message}`);
        console.error('Recompile failed:', error);
    }
}

// Ensure explicit compute bind group and pipeline layouts are created
function ensureComputeLayouts() {
    if (!gpuState.device) return;
    if (!computeBGL) {
        computeBGL = gpuState.device.createBindGroupLayout({
            label: 'Compute BGL (uniforms, storage, time)',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'uniform' }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'storage' }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'uniform' }
                }
            ]
        });
    }
    if (!computePipelineLayout) {
        computePipelineLayout = gpuState.device.createPipelineLayout({
            label: 'Compute Pipeline Layout',
            bindGroupLayouts: [computeBGL]
        });
    }
}

// Restart simulation with new number of circles
async function restartSimulation(newNumCircles) {
    try {
        // Validate input
        const numCircles = parseInt(newNumCircles);
        if (isNaN(numCircles) || numCircles < 1 || numCircles > 2000) {
            showErrorToast('Number of circles must be between 1 and 2000');
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
        // Show loading indicator
        const loadingContainer = document.getElementById('loading-container');
        if (loadingContainer) {
            loadingContainer.classList.remove('hidden');
        }
        
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
        
        // Hide loading indicator
        if (loadingContainer) {
            loadingContainer.classList.add('hidden');
        }
    } catch (error) {
        hideLoading();
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

    // Add mouse event listeners
    htmlState.canvas.addEventListener('mousemove', updateMousePosition);
    htmlState.canvas.addEventListener('mousedown', updateMousePosition);
    htmlState.canvas.addEventListener('mouseup', updateMousePosition);
    htmlState.canvas.addEventListener('mouseleave', (event) => {
        updateMousePosition(event, false);
    });

    // Add spacebar event listener for gravity reversal
    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space') {
            const ae = document.activeElement;
            const isEditable = ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/i.test(ae.tagName));
            if (isEditable) return; // let space insert in editors/inputs
            event.preventDefault();
            updateGravity();
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
    
    // Initialize WebGPU
    init();

    // Fetch movement.wgsl and display it in the sidebar
    (async () => {
        try {
            const codeEl = document.getElementById('shader-code');
            if (!codeEl) return;
            const res = await fetch('movement.wgsl');
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const text = await res.text();
            originalMovementSource = text;
            codeEl.textContent = text;
            if (window.Prism && typeof window.Prism.highlightElement === 'function') {
                window.Prism.highlightElement(codeEl);
            }
        } catch (err) {
            const codeEl = document.getElementById('shader-code');
            if (codeEl) codeEl.textContent = `/* Failed to load movement.wgsl: ${err.message} */`;
            console.error('Failed to load movement.wgsl:', err);
        }
    })();

    // Sidebar resize interactions
    const sidebar = document.getElementById('shader-sidebar');
    const resizer = document.getElementById('shader-resizer');
    const root = document.documentElement;

    // Restore saved sidebar width
    const savedWidth = localStorage.getItem('shaderSidebarWidth');
    if (savedWidth) {
        const desired = parseInt(savedWidth, 10) || 0;
        const finalWidth = Math.max(320, desired);
        root.style.setProperty('--shader-sidebar-width', `${finalWidth}px`);
    }

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    function onPointerDown(clientX) {
        if (!sidebar) return;
        isResizing = true;
        startX = clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        document.body.classList.add('shader-resizing');
    }

    function onPointerMove(clientX) {
        if (!isResizing || !sidebar) return;
        const dx = startX - clientX;
        let newWidth = startWidth + dx;
        newWidth = Math.max(320, newWidth);
        const px = `${Math.round(newWidth)}px`;
        root.style.setProperty('--shader-sidebar-width', px);
    }

    function onPointerUp() {
        if (!isResizing) return;
        isResizing = false;
        document.body.classList.remove('shader-resizing');
        // Persist width
        const current = getComputedStyle(document.documentElement).getPropertyValue('--shader-sidebar-width').trim();
        if (current) localStorage.setItem('shaderSidebarWidth', current);
    }

    if (resizer) {
        // Mouse
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            onPointerDown(e.clientX);
        });
        window.addEventListener('mousemove', (e) => onPointerMove(e.clientX));
        window.addEventListener('mouseup', onPointerUp);
        // Touch
        resizer.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches[0]) {
                onPointerDown(e.touches[0].clientX);
            }
        }, { passive: true });
        window.addEventListener('touchmove', (e) => {
            if (e.touches && e.touches[0]) onPointerMove(e.touches[0].clientX);
        }, { passive: true });
        window.addEventListener('touchend', onPointerUp);
        window.addEventListener('touchcancel', onPointerUp);
    }

    // Confirm button: print code to console
    const confirmBtn = document.getElementById('shader-confirm');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const codeEl = document.getElementById('shader-code');
            const code = codeEl ? codeEl.textContent || '' : '';
            console.log('WGSL code (movement.wgsl):\n\n' + code);
            recompileComputeFromEditor();
        });
    }

    // Reset button: restore original movement.wgsl into the editor
    const resetBtn = document.getElementById('shader-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const codeEl = document.getElementById('shader-code');
            if (!codeEl) return;
            if (!originalMovementSource) {
                showErrorToast('Original shader not loaded yet.');
                return;
            }
            codeEl.textContent = originalMovementSource;
            if (window.Prism && typeof window.Prism.highlightElement === 'function') {
                try {
                    window.Prism.highlightElement(codeEl, false);
                } catch (_) {
                    window.Prism.highlightElement(codeEl);
                }
            }
            console.log('WGSL code reset to original movement.wgsl');
        });
    }

    // Empty button: load movement_empty.wgsl template into the editor
    const emptyBtn = document.getElementById('shader-empty');
    if (emptyBtn) {
        emptyBtn.addEventListener('click', async () => {
            const codeEl = document.getElementById('shader-code');
            if (!codeEl) return;
            try {
                if (!emptyMovementSource) {
                    const res = await fetch('movement_empty.wgsl');
                    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                    emptyMovementSource = await res.text();
                }
                codeEl.textContent = emptyMovementSource;
                if (window.Prism && typeof window.Prism.highlightElement === 'function') {
                    try {
                        window.Prism.highlightElement(codeEl, false);
                    } catch (_) {
                        window.Prism.highlightElement(codeEl);
                    }
                }
                console.log('WGSL code loaded from movement_empty.wgsl');
            } catch (err) {
                showErrorToast(`Failed to load movement_empty.wgsl: ${err.message}`);
                console.error('Failed to load movement_empty.wgsl:', err);
            }
        });
    }

    // Re-highlight code as user edits to keep Prism formatting
    const codeEditable = document.getElementById('shader-code');
    if (codeEditable && window.Prism && typeof window.Prism.highlightElement === 'function') {
        // Helpers to get/set caret offset within a contenteditable element
        const getCaretOffset = (el) => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return null;
            const range = sel.getRangeAt(0);
            // Only handle collapsed selections (caret). If not collapsed, use start.
            const pre = range.cloneRange();
            pre.selectNodeContents(el);
            try {
                pre.setEnd(range.startContainer, range.startOffset);
            } catch (_) {
                return null;
            }
            return pre.toString().length;
        };

        const getSelectionOffsets = (el) => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return { start: null, end: null };
            const range = sel.getRangeAt(0);
            const preStart = range.cloneRange();
            preStart.selectNodeContents(el);
            try { preStart.setEnd(range.startContainer, range.startOffset); } catch (_) { return { start: null, end: null }; }
            const start = preStart.toString().length;
            const preEnd = range.cloneRange();
            preEnd.selectNodeContents(el);
            try { preEnd.setEnd(range.endContainer, range.endOffset); } catch (_) { return { start: null, end: null }; }
            const end = preEnd.toString().length;
            return { start, end };
        };

        const setCaretOffset = (el, offset) => {
            if (offset == null) return;
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
            let node = walker.nextNode();
            let count = 0;
            while (node) {
                const next = count + node.nodeValue.length;
                if (offset <= next) {
                    const range = document.createRange();
                    range.setStart(node, Math.max(0, offset - count));
                    range.collapse(true);
                    const sel = window.getSelection();
                    if (sel) {
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                    return;
                }
                count = next;
                node = walker.nextNode();
            }
            // Fallback to end
            const sel = window.getSelection();
            if (sel) {
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        };

        let rehighlightRaf = 0;
        const schedule = () => {
            if (rehighlightRaf) cancelAnimationFrame(rehighlightRaf);
            rehighlightRaf = requestAnimationFrame(() => {
                const activeIsCode = document.activeElement === codeEditable;
                const offset = activeIsCode ? getCaretOffset(codeEditable) : null;
                // Prefer synchronous highlighting to keep caret snappy
                try {
                    window.Prism.highlightElement(codeEditable, false);
                } catch (_) {
                    window.Prism.highlightElement(codeEditable);
                }
                if (activeIsCode) {
                    const safeOffset = Math.min(offset ?? 0, (codeEditable.textContent || '').length);
                    setCaretOffset(codeEditable, safeOffset);
                }
            });
        };
        codeEditable.addEventListener('input', schedule);
        codeEditable.addEventListener('paste', schedule);
        codeEditable.addEventListener('keyup', (e) => {
            // rehighlight after structural edits
            if (['Enter', 'Tab', 'Backspace', 'Delete'].includes(e.key)) schedule();
        });

        // Insert a literal tab on Tab key; implement Ctrl/Cmd C/X/V shortcuts
        codeEditable.addEventListener('keydown', async (e) => {
            // Tab inserts a tab character
            if (e.key === 'Tab') {
                e.preventDefault();
                const { start, end } = getSelectionOffsets(codeEditable);
                if (start == null || end == null) return;
                const text = codeEditable.textContent || '';
                const before = text.slice(0, Math.min(start, end));
                const after = text.slice(Math.max(start, end));
                const next = before + '\t' + after;
                codeEditable.textContent = next;
                // Place caret after inserted tab, then re-highlight and preserve caret
                const newOffset = Math.min(before.length + 1, next.length);
                setCaretOffset(codeEditable, newOffset);
                schedule();
                return;
            }

            // Ctrl/Cmd shortcuts for copy, cut, paste
            const isAccel = e.ctrlKey || e.metaKey;
            if (!isAccel) return;
            const key = e.key.toLowerCase();
            if (!['c', 'x', 'v'].includes(key)) return;

            const { start, end } = getSelectionOffsets(codeEditable);
            const hasSel = start != null && end != null && end > start;
            const text = codeEditable.textContent || '';

            // Helper to set content and caret, then re-highlight
            const setContent = (newText, caretOffset) => {
                codeEditable.textContent = newText;
                setCaretOffset(codeEditable, Math.max(0, Math.min(caretOffset, newText.length)));
                schedule();
            };

            try {
                if (key === 'c') {
                    if (!hasSel) return; // nothing to copy
                    const selected = text.slice(start, end);
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(selected);
                        e.preventDefault();
                    } else if (document.execCommand) {
                        // Fallback: let the browser handle default copy
                        // We avoid preventDefault so native copy can proceed
                    }
                } else if (key === 'x') {
                    if (!hasSel) return; // nothing to cut
                    const selected = text.slice(start, end);
                    let copied = false;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(selected);
                        copied = true;
                    } else if (document.execCommand) {
                        // Try native cut; if it succeeds we can bail
                        const ok = document.execCommand('cut');
                        if (ok) {
                            // Native cut already altered content; schedule highlight and exit
                            schedule();
                            return;
                        }
                    }
                    // Perform manual cut and prevent default
                    const before = text.slice(0, start);
                    const after = text.slice(end);
                    setContent(before + after, start);
                    e.preventDefault();
                } else if (key === 'v') {
                    // Paste plain text at caret or replace selection
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        e.preventDefault();
                        const clip = await navigator.clipboard.readText();
                        const s = Math.min(start ?? 0, end ?? 0);
                        const epos = Math.max(start ?? 0, end ?? 0);
                        const before = text.slice(0, s);
                        const after = text.slice(epos);
                        const next = before + clip + after;
                        setContent(next, before.length + clip.length);
                    } else {
                        // Allow default paste behaviour and re-highlight via existing paste/input handlers
                    }
                }
            } catch (err) {
                console.warn('Clipboard operation failed:', err);
                // Fall back to default browser behaviour
            }
        });
    }
});
