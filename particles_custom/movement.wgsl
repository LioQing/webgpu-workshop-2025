struct Uniforms {
    resolution: vec2<f32>,
    mouse_position: vec2<f32>,
    is_mouse_down: u32,
    gravity_direction: f32,
    padding: vec2<f32>,
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
@group(0) @binding(2) var<uniform> delta_time: f32;

const CIRCLE_RADIUS: f32 = 5.0;
const INTER_EPISILON: f32 = 100.0;
const INTER_SIGMA: f32 = CIRCLE_RADIUS * 8;
const MAX_ACCEL: f32 = 10000.0;
const MAX_SPEED: f32 = 1000.0;
const DAMPING: f32 = 0.999;
const MOUSE_RADIUS: f32 = CIRCLE_RADIUS * 50.0;
const GRAVITY: f32 = -9.81 * 1000.0;

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let num_circles = arrayLength(&circles);
    
    if index >= num_circles {
        return;
    }
    
    // Get current circle data
    var circle = circles[index];
    
    // Simulate physics
    // Calculate intermolecular acceleration
    circle.acceleration = vec2<f32>(0.0, 0.0);
    
    // Check force with nearby particles
    for (var i: u32 = 0u; i < num_circles; i += 1) {
        if i == index {
            continue; // Skip self
        }
        
        let other_circle = circles[i];
        let offset = other_circle.position - circle.position;
        let direction = normalize(offset);
        let distance = length(offset);

        let inter_term = INTER_SIGMA / distance;
        let weak_force = inter_term * inter_term * inter_term;
        let strong_force = weak_force * weak_force;

        let inter_force = 4 * INTER_EPISILON * (strong_force - weak_force);

        if distance <= CIRCLE_RADIUS * 2.0 {
            continue;
        }

        circle.acceleration -= direction * inter_force;
    }

    // Apply mouse interaction
    if uniforms.is_mouse_down != 0u {
        let mouse_offset = uniforms.mouse_position - circle.position;
        let mouse_distance = length(mouse_offset);
        
        let term = MOUSE_RADIUS / mouse_distance;
        let force = term * term * term * term * term * term;
        let direction = normalize(mouse_offset);
        circle.acceleration -= direction * force;
    }

    // Apply gravity
    circle.acceleration += vec2<f32>(0.0, GRAVITY * uniforms.gravity_direction) * delta_time;

    // Clamp acceleration to prevent physics breaking
    if length(circle.acceleration) > MAX_ACCEL {
        circle.acceleration = normalize(circle.acceleration) * MAX_ACCEL;
    }

    // Apply acceleration to velocity
    circle.velocity += circle.acceleration * delta_time;

    // Clamp velocity to prevent physics breaking
    if length(circle.velocity) > MAX_SPEED {
        circle.velocity = normalize(circle.velocity) * MAX_SPEED;
    }

    // Dampen the velocity depending on its current speed
    circle.velocity *= DAMPING;
    
    // Update position using velocity and delta time
    circle.position += circle.velocity * delta_time;
    
    // Check boundaries and bounce
    // Left boundary
    if circle.position.x - CIRCLE_RADIUS < 0.0 {
        circle.position.x = CIRCLE_RADIUS;
        circle.velocity.x = -circle.velocity.x;
    }
    // Right boundary
    else if circle.position.x + CIRCLE_RADIUS > uniforms.resolution.x {
        circle.position.x = uniforms.resolution.x - CIRCLE_RADIUS;
        circle.velocity.x = -circle.velocity.x;
    }
    
    // Top boundary
    if circle.position.y - CIRCLE_RADIUS < 0.0 {
        circle.position.y = CIRCLE_RADIUS;
        circle.velocity.y = -circle.velocity.y;
    }
    // Bottom boundary
    else if circle.position.y + CIRCLE_RADIUS > uniforms.resolution.y {
        circle.position.y = uniforms.resolution.y - CIRCLE_RADIUS;
        circle.velocity.y = -circle.velocity.y;
    }
    
    // Write back updated circle data
    circles[index] = circle;
}
