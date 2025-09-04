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

struct VertexInput {
    @location(0) position: vec2<f32>,
    @builtin(instance_index) instance_index: u32,
}

struct FragmentInput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> circles: array<Circle>;

@vertex
fn vs_main(input: VertexInput) -> FragmentInput {
    var out: FragmentInput;
    
    // Get circle data using instance index
    let circle = circles[input.instance_index];
    
    // Transform local vertex position to world position
    let world_pos = input.position + circle.position;
    
    // Convert pixel coordinates to normalized device coordinates
    let ndc = (world_pos / uniforms.resolution) * 2.0 - 1.0;
    let flipped_ndc = vec2<f32>(ndc.x, -ndc.y);
    
    out.position = vec4<f32>(flipped_ndc, 0.0, 1.0);
    out.color = circle.color;
    return out;
}

@fragment
fn fs_main(input: FragmentInput) -> @location(0) vec4<f32> {
    return vec4<f32>(input.color, 1.0);
}
