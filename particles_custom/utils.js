let htmlState = {
    canvas: null, // The canvas element for rendering
    errorMessage: null, // The error message element to display errors
}

let gpuState = {
    device: null, // The WebGPU device for handling GPU operations
    context: null, // The WebGPU context for rendering
}

// Show error toast message
function showErrorToast(message, neverHide = false, isHtml = false) {
    // If there's already a neverHide error showing, don't display new errors
    if (showErrorToast.hasNeverHideError && !neverHide) {
        return;
    }

    if (!htmlState.errorMessage) {
        console.error('Error message element not found!');
        return;
    }
    // Support inner content container if present
    const content = htmlState.errorMessage.querySelector('.toast-content') || htmlState.errorMessage;
    if (isHtml) {
        content.innerHTML = message;
    } else {
        content.textContent = message;
    }
    htmlState.errorMessage.classList.add('visible', 'show');
    htmlState.errorMessage.classList.remove('hide');
    
    // Clear any existing timeout
    if (showErrorToast.timeoutId) {
        clearTimeout(showErrorToast.timeoutId);
    }
    
    if (neverHide) {
        showErrorToast.hasNeverHideError = true;
        return;
    }

    // Auto-hide after 10 seconds
    showErrorToast.timeoutId = setTimeout(() => {
        hideErrorToast();
    }, 10000);
}

function hideErrorToast() {
    if (!htmlState.errorMessage) return;
    htmlState.errorMessage.classList.add('hide');
    htmlState.errorMessage.classList.remove('show');
    setTimeout(() => {
        htmlState.errorMessage.classList.remove('visible');
    }, 300);
}

// Adjust context to canvas size
function resizeCanvas() {
    try {
    // Always size canvas to full window; sidebar overlays
    htmlState.canvas.width = Math.max(window.innerWidth, 1);
        htmlState.canvas.height = window.innerHeight;
        
        // Reconfigure context
        if (gpuState.context) {
            configureContext();
        }
    } catch (error) {
        showErrorToast(`Error resizing canvas: ${error.message}`);
        console.error('Canvas resize error:', error);
    }
}

// Configure WebGPU context
function configureContext() {
    try {
        const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        gpuState.context.configure({
            device: gpuState.device,
            format: canvasFormat
        });
    } catch (error) {
        showErrorToast(`Error configuring context: ${error.message}`);
        console.error('Context configuration error:', error);
        throw error;
    }
}

// Initialize the WebGPU device and context
async function initDeviceAndContext() {
    try {
        // Check WebGPU support
        if (!navigator.gpu) {
            throw new Error('WebGPU is not supported in this browser');
        }

        // Request adapter
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error('No WebGPU adapter found');
        }

        // Request device
        gpuState.device = await adapter.requestDevice();
        
        // Set up device error handling for uncaptured errors
        gpuState.device.addEventListener('uncapturederror', (event) => {
            showErrorToast(`WebGPU uncaptured error: ${event.error.message}`);
            console.error('WebGPU uncaptured error:', event.error);
        });
        
        // Get canvas context
        gpuState.context = htmlState.canvas.getContext('webgpu');
        if (!gpuState.context) {
            throw new Error('Failed to get WebGPU context');
        }
    } catch (error) {
        showErrorToast(`Device request error: ${error.message}`, neverHide = true);
        console.error('Device request error:', error);
    }
}

// Validate the WGSL shader compilation
async function validateShader(shaderCode) {
    try {
        const shaderModule = gpuState.device.createShaderModule({
            label: 'Validation shader',
            code: shaderCode
        });

        // Check for compilation errors
        const compilationInfo = await shaderModule.getCompilationInfo();
        if (compilationInfo.messages.length > 0) {
            const shaderLines = shaderCode.split('\n');
            
            for (const message of compilationInfo.messages) {
                const messageType = message.type === 'error' ? 'Error' : 
                                    message.type === 'warning' ? 'Warning' : 'Info';
                
                // Create pretty error message with sanitized content
                let prettyMessage = `Shader ${messageType}: ${message.message}`;
                
                if (message.lineNum !== undefined && message.linePos !== undefined) {
                    prettyMessage += `\n<pre>`;
                    
                    const lineNumber = message.lineNum;
                    const columnPosition = message.linePos;
                    const errorLine = shaderLines[lineNumber - 1] || '';
                    const codeDiv = document.createElement('div');
                    codeDiv.textContent = errorLine;

                    prettyMessage += `\n ${lineNumber} | ${codeDiv.innerHTML}`;
                    
                    // Create underline for the error position
                    const underlineLength = message.length || 1;
                    const spaces = ' '.repeat(columnPosition - 1);
                    const underline = '^'.repeat(Math.max(1, underlineLength));
                    prettyMessage += `\n ${' '.repeat(String(lineNumber).length)} | ${spaces}${underline}`;
                    
                    prettyMessage += `\n</pre>`;
                }
                
                if (message.type === 'error') {
                    throw new Error(prettyMessage);
                }
            }
        }
    } catch (error) {
        showErrorToast(`Shader validation error: ${error.message}`, true, true);
        console.error('Shader validation error:', error);
    }
}

// Initialize canvas and error message elements
function initElements() {
    htmlState.canvas = document.getElementById('canvas');
    htmlState.errorMessage = document.getElementById('error-toast');
    // Close button wiring
    if (htmlState.errorMessage) {
        const closeBtn = htmlState.errorMessage.querySelector('.toast-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => hideErrorToast());
        }
    }
}

// Export functions and variables for use in other files
export {
    htmlState,
    gpuState,
    showErrorToast,
    resizeCanvas,
    configureContext,
    initDeviceAndContext,
    validateShader,
    initElements
};
