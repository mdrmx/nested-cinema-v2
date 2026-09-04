import * as THREE from "../node_modules/three/build/three.module.js";

class ProjectionSurface {
  constructor(texture) {
    this.material = new THREE.MeshBasicMaterial({ map: texture });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

class ProjectionRenderer {
  constructor(container) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.patternCanvas = document.createElement("canvas");
    this.patternContext = this.patternCanvas.getContext("2d");
    this.patternTexture = new THREE.CanvasTexture(this.patternCanvas);
    this.patternTexture.colorSpace = THREE.SRGBColorSpace;
    this.projectionSurfaces = [new ProjectionSurface(this.patternTexture)];
    this.frameId = null;

    this.renderer.domElement.setAttribute(
      "aria-label",
      "Projection test pattern",
    );
    container.appendChild(this.renderer.domElement);
    this.projectionSurfaces.forEach((surface) => this.scene.add(surface.mesh));

    this.resize = this.resize.bind(this);
    this.render = this.render.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();
  }

  resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.drawTestPattern(width * pixelRatio, height * pixelRatio);
  }

  drawTestPattern(width, height) {
    const context = this.patternContext;
    const patternWidth = Math.round(width);
    const patternHeight = Math.round(height);
    const scale = Math.min(patternWidth, patternHeight) / 1080;
    const inset = 28 * scale;
    const gridSize = 96 * scale;

    this.patternCanvas.width = patternWidth;
    this.patternCanvas.height = patternHeight;
    context.fillStyle = "#000000";
    context.fillRect(0, 0, patternWidth, patternHeight);

    context.strokeStyle = "rgba(255, 255, 255, 0.36)";
    context.lineWidth = Math.max(1, scale);
    context.beginPath();
    for (let x = patternWidth / 2; x >= inset; x -= gridSize) {
      context.moveTo(x, inset);
      context.lineTo(x, patternHeight - inset);
    }
    for (
      let x = patternWidth / 2 + gridSize;
      x <= patternWidth - inset;
      x += gridSize
    ) {
      context.moveTo(x, inset);
      context.lineTo(x, patternHeight - inset);
    }
    for (let y = patternHeight / 2; y >= inset; y -= gridSize) {
      context.moveTo(inset, y);
      context.lineTo(patternWidth - inset, y);
    }
    for (
      let y = patternHeight / 2 + gridSize;
      y <= patternHeight - inset;
      y += gridSize
    ) {
      context.moveTo(inset, y);
      context.lineTo(patternWidth - inset, y);
    }
    context.stroke();

    context.strokeStyle = "#ffffff";
    context.lineWidth = Math.max(2, 3 * scale);
    context.strokeRect(
      inset,
      inset,
      patternWidth - inset * 2,
      patternHeight - inset * 2,
    );

    const centerX = patternWidth / 2;
    const centerY = patternHeight / 2;
    const crosshairSize = 54 * scale;
    context.beginPath();
    context.moveTo(centerX - crosshairSize, centerY);
    context.lineTo(centerX + crosshairSize, centerY);
    context.moveTo(centerX, centerY - crosshairSize);
    context.lineTo(centerX, centerY + crosshairSize);
    context.stroke();
    context.beginPath();
    context.arc(centerX, centerY, 13 * scale, 0, Math.PI * 2);
    context.stroke();

    const markerSize = 38 * scale;
    const cornerOffset = inset + markerSize / 2;
    this.drawCornerMarker(
      context,
      cornerOffset,
      cornerOffset,
      markerSize,
      "TL",
      scale,
    );
    this.drawCornerMarker(
      context,
      patternWidth - cornerOffset,
      cornerOffset,
      markerSize,
      "TR",
      scale,
    );
    this.drawCornerMarker(
      context,
      cornerOffset,
      patternHeight - cornerOffset,
      markerSize,
      "BL",
      scale,
    );
    this.drawCornerMarker(
      context,
      patternWidth - cornerOffset,
      patternHeight - cornerOffset,
      markerSize,
      "BR",
      scale,
    );

    context.fillStyle = "#ffffff";
    context.font = `600 ${Math.max(18, 30 * scale)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      "NESTED CINEMA - PROJECTION TEST",
      centerX,
      centerY - 96 * scale,
    );
    this.patternTexture.needsUpdate = true;
  }

  drawCornerMarker(context, x, y, size, label, scale) {
    context.fillStyle = "#ffffff";
    context.fillRect(x - size / 2, y - size / 2, size, size);
    context.fillStyle = "#000000";
    context.font = `700 ${Math.max(12, 15 * scale)}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, x, y + 1 * scale);
  }

  start() {
    this.render();
  }

  render() {
    this.frameId = requestAnimationFrame(this.render);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener("resize", this.resize);
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.projectionSurfaces.forEach((surface) => surface.dispose());
    this.patternTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const projectionRenderer = new ProjectionRenderer(document.body);
window.__projectionDiagnostics = {
  rendererInstances: 1,
  animationLoops: 1,
  resizeListeners: 1,
  canvasCount: 1,
};
projectionRenderer.start();
window.addEventListener(
  "beforeunload",
  () => {
    projectionRenderer.dispose();
    window.__projectionDiagnostics = {
      rendererInstances: 0,
      animationLoops: 0,
      resizeListeners: 0,
      canvasCount: 0,
    };
  },
  { once: true },
);
