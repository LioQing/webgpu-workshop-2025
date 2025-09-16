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
    
    // Implement your logics here...
    for (var i: u32 = 0u; i < num_circles; i += 1) {
        if i == index { continue; }
        
        let other_circle = circles[i];
        let offset = other_circle.position - circle.position;
        let direction = normalize(offset);
        let distance = length(offset);
        
        if distance <= CIRCLE_RADIUS * 2.0 { continue; }
        
        let g = 100.0 / (distance * distance);
        
        circle.acceleration = direction * g;
        circle.velocity += circle.acceleration * delta_time;
        circle.position += circle.velocity * delta_time;
    }

    // Write back updated circle data
    circles[index] = circle;
}
