struct Uniforms {
    resolution: vec2<f32>,
}

struct Circle {
    position: vec2<f32>,
    velocity: vec2<f32>,
    acceleration: vec2<f32>,
    padding1: vec2<f32>,
    color: vec3<f32>,
    padding2: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> circles: array<Circle>;
@group(0) @binding(2) var<uniform> deltaTime: f32;

const CIRCLE_RADIUS: f32 = 5.0;
const INTER_EPISILON: f32 = 100.0;
const INTER_SIGMA: f32 = CIRCLE_RADIUS * 8;
const DAMPING: f32 = 0.998;
const GRAVITY: f32 = 9.81 * 1000.0;

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let num_circles = arrayLength(&circles);
    
    if (index >= num_circles) {
        return;
    }
    
    // Get current circle data
    var circle = circles[index];
    
    // Calculate intermolecular acceleration
    circle.acceleration = vec2<f32>(0.0, 0.0);
    
    // Check force with nearby particles
    for (var i: u32 = 0u; i < num_circles; i += 1) {
        if (i == index) {
            continue; // Skip self
        }
        
        let otherCircle = circles[i];
        let offset = otherCircle.position - circle.position;
        let direction = normalize(offset);
        let r = length(offset);

        let interTerm = INTER_SIGMA / r;
        let weakForce = interTerm * interTerm * interTerm;
        let strongForce = weakForce * weakForce;

        let interForce = 4 * INTER_EPISILON * (strongForce - weakForce);

        if (r <= CIRCLE_RADIUS * 2.0) {
            // Apply reaction force
            let directionSpeed = dot(direction, circle.velocity);
            let reactForce = -2 * directionSpeed * direction / deltaTime;
            circle.acceleration += reactForce;
            continue;
        }

        circle.acceleration -= direction * interForce;
    }

    // Apply gravity
    circle.acceleration += vec2<f32>(0.0, GRAVITY) * deltaTime;

    // Apply acceleration to velocity
    circle.velocity += circle.acceleration * deltaTime;

    // Clamp velocity to prevent physics breaking
    if (length(circle.velocity) > 1000.0) {
        circle.velocity = normalize(circle.velocity) * 1000.0;
    }

    // Dampen the velocity
    circle.velocity *= DAMPING;
    
    // Update position using velocity and delta time
    circle.position += circle.velocity * deltaTime;
    
    // Check boundaries and bounce
    // Left boundary
    if (circle.position.x - CIRCLE_RADIUS < 0.0) {
        circle.position.x = CIRCLE_RADIUS;
        circle.velocity.x = -circle.velocity.x;
    }
    // Right boundary
    else if (circle.position.x + CIRCLE_RADIUS > uniforms.resolution.x) {
        circle.position.x = uniforms.resolution.x - CIRCLE_RADIUS;
        circle.velocity.x = -circle.velocity.x;
    }
    
    // Top boundary
    if (circle.position.y - CIRCLE_RADIUS < 0.0) {
        circle.position.y = CIRCLE_RADIUS;
        circle.velocity.y = -circle.velocity.y;
    }
    // Bottom boundary
    else if (circle.position.y + CIRCLE_RADIUS > uniforms.resolution.y) {
        circle.position.y = uniforms.resolution.y - CIRCLE_RADIUS;
        circle.velocity.y = -circle.velocity.y;
    }
    
    // Write back updated circle data
    circles[index] = circle;
}
