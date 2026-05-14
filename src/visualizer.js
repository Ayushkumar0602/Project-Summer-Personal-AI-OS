// JARVIS WebGL Core Visualizer
// This script creates an audio-reactive 3D sphere that acts as the core of the JARVIS interface.

class JarvisVisualizer {
    constructor() {
        this.canvas = document.getElementById('jarvis-core');
        if (!this.canvas) return;

        this.width = 240;
        this.height = 240;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
        
        this.renderer.setSize(this.width, this.height);
        this.camera.position.z = 5;

        // Create the core sphere
        const geometry = new THREE.IcosahedronGeometry(2, 4); // High detail for wireframe
        
        // Custom Shader Material for glowing effect
        const material = new THREE.MeshBasicMaterial({
            color: 0x06b6d4, // Cyan base
            wireframe: true,
            transparent: true,
            opacity: 0.8
        });

        this.coreMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.coreMesh);

        // Particle system around the core
        const particleGeo = new THREE.BufferGeometry();
        const particleCount = 200;
        const posArray = new Float32Array(particleCount * 3);
        
        for(let i = 0; i < particleCount * 3; i++) {
            posArray[i] = (Math.random() - 0.5) * 8;
        }
        
        particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const particleMat = new THREE.PointsMaterial({
            size: 0.05,
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.6
        });

        this.particles = new THREE.Points(particleGeo, particleMat);
        this.scene.add(this.particles);

        // State parameters
        this.targetScale = 1.0;
        this.currentScale = 1.0;
        this.baseRotationSpeed = 0.005;
        this.rotationSpeed = this.baseRotationSpeed;
        this.targetColor = new THREE.Color(0x06b6d4);

        this.animate = this.animate.bind(this);
        this.animate();
    }

    // Called from renderer.js audio pipeline
    updateAudioData(volumeArray) {
        if (!volumeArray || volumeArray.length === 0) return;
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < volumeArray.length; i++) {
            sum += volumeArray[i];
        }
        const avg = sum / volumeArray.length;
        
        // Map average volume (0-255) to a scale (1.0 - 1.8)
        const volumeNorm = avg / 255.0;
        this.targetScale = 1.0 + (volumeNorm * 0.8);
        this.rotationSpeed = this.baseRotationSpeed + (volumeNorm * 0.05);
    }

    setState(stateName) {
        switch(stateName) {
            case 'idle':
                this.targetColor.setHex(0x06b6d4); // Cyan
                this.targetScale = 1.0;
                this.baseRotationSpeed = 0.005;
                break;
            case 'listening':
                this.targetColor.setHex(0xef4444); // Red
                this.targetScale = 1.2;
                this.baseRotationSpeed = 0.01;
                break;
            case 'thinking':
                this.targetColor.setHex(0xfbbf24); // Yellow/Gold
                this.targetScale = 1.1;
                this.baseRotationSpeed = 0.02;
                break;
            case 'speaking':
                this.targetColor.setHex(0x00e5ff); // Bright Cyan
                // Audio updates will drive scale/rotation mostly
                this.baseRotationSpeed = 0.015;
                break;
            case 'researching':
                this.targetColor.setHex(0xc084fc); // Purple
                this.targetScale = 1.15;
                this.baseRotationSpeed = 0.03;
                break;
        }
    }

    animate() {
        requestAnimationFrame(this.animate);

        // Smooth scale interpolation
        this.currentScale += (this.targetScale - this.currentScale) * 0.1;
        this.coreMesh.scale.set(this.currentScale, this.currentScale, this.currentScale);

        // Smooth color interpolation
        this.coreMesh.material.color.lerp(this.targetColor, 0.05);
        this.particles.material.color.lerp(this.targetColor, 0.05);

        // Rotation
        this.coreMesh.rotation.x += this.rotationSpeed;
        this.coreMesh.rotation.y += this.rotationSpeed;
        
        this.particles.rotation.y -= this.rotationSpeed * 0.5;

        // Subtle pulsing for opacity
        const time = Date.now() * 0.001;
        this.coreMesh.material.opacity = 0.6 + Math.sin(time * 2) * 0.2;

        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    window.visualizer = new JarvisVisualizer();
});
