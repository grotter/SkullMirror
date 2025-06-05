import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {VIDEO_SIZE} from './shared/params';
import {drawResults, isMobile} from './shared/util';

export class Camera {
  constructor() {
    this.video = document.getElementById('video');
    this.canvas = document.getElementById('output');
    this.ctx = this.canvas.getContext('2d');
    
    this.model;

    this.loadModel();
  }

  onModelLoadProgress(xhr) {
    if (xhr.lengthComputable) {
      let percentComplete = (xhr.loaded / xhr.total) * 100;
      if (percentComplete > 100) percentComplete = 100;

      document.getElementById('per').innerHTML = Math.round(percentComplete).toString();

      if (xhr.loaded >= xhr.total) {
        document.getElementsByTagName('html')[0].classList.remove('model-loading');
      }
    }
  }

  loadModel() {
    // setup three.js scene, camera and renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, VIDEO_SIZE['default'].width / VIDEO_SIZE['default'].height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // Make background transparent
    renderer.setSize(VIDEO_SIZE['default'].width, VIDEO_SIZE['default'].height);
    renderer.setClearColor(0x000000, .2); // Set clear color to transparent

    // setup lighting
    const light = new THREE.AmbientLight(0xffffff, .5);
    scene.add(light);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);

    const loader = new GLTFLoader();
    let inst = this;

    loader.load('https://s3.us-west-2.amazonaws.com/files.calacademy.org/3d/elephant.glb', function (gltf) {
        inst.model = gltf.scene;

        // flip model vertically
        inst.model.scale.y *= -1; 

        // add to DOM
        document.getElementById('app').appendChild(renderer.domElement);
        
        // remove inline style
        renderer.domElement.style = '';

        scene.add(inst.model);
        camera.position.z = 45;

        function animate() {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
        }

        animate();
    }, this.onModelLoadProgress);
  }

  /**
   * Initiate a Camera instance and wait for the camera stream to be ready.
   * @param cameraParam From app `STATE.camera`.
   */
  static async setupCamera(cameraParam) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
          'Browser API navigator.mediaDevices.getUserMedia not available');
    }

    const {targetFPS, sizeOption} = cameraParam;
    const $size = VIDEO_SIZE[sizeOption];
    const videoConfig = {
      'audio': false,
      'video': {
        facingMode: 'user',
        // Only setting the video to a specified size for large screen, on
        // mobile devices accept the default size.
        width: VIDEO_SIZE['default'].width,
        height: VIDEO_SIZE['default'].height,
        frameRate: {
          ideal: targetFPS,
        },
      },
    };

    const stream = await navigator.mediaDevices.getUserMedia(videoConfig);

    const camera = new Camera();
    camera.video.srcObject = stream;

    await new Promise((resolve) => {
      camera.video.onloadedmetadata = () => {
        resolve(video);
      };
    });

    camera.video.play();

    const videoWidth = camera.video.videoWidth;
    const videoHeight = camera.video.videoHeight;

    // Must set below two lines, otherwise video element doesn't show.
    camera.video.width = videoWidth;
    camera.video.height = videoHeight;

    camera.canvas.width = videoWidth;
    camera.canvas.height = videoHeight;

    // Because the image from camera is mirrored, need to flip horizontally.
    camera.ctx.translate(camera.video.videoWidth, 0);
    camera.ctx.scale(-1, 1);

    return camera;
  }

  getCalculatedRotation(keypoints) {
    if (!keypoints || keypoints.length === 0) {
        return { x: 0, y: 0, z: 0 };
    }

    // landmarks
    // @see mesh_map.jpg
    const leftEye = keypoints[33];
    const rightEye = keypoints[263];
    const noseTip = keypoints[1];

    // normalize coordinates
    const normalize = (point) => ({ x: point.x, y: -point.y, z: point.z || 0 });

    const leftEyeNorm = normalize(leftEye);
    const rightEyeNorm = normalize(rightEye);
    const noseTipNorm = normalize(noseTip);

    // calculate the center point between the eyes
    const eyeCenter = {
        x: (leftEyeNorm.x + rightEyeNorm.x) / 2,
        y: (leftEyeNorm.y + rightEyeNorm.y) / 2,
        z: (leftEyeNorm.z + rightEyeNorm.z) / 2,
    };

    // angle between the nose-to-eye-center line and the vertical axis
    const dx = noseTipNorm.x - eyeCenter.x;
    const dz = noseTipNorm.z - eyeCenter.z;
    const yaw = Math.atan2(dx, dz);

    // angle of the eye line relative to the horizontal axis
    const roll = Math.atan2(rightEyeNorm.y - leftEyeNorm.y, rightEyeNorm.x - leftEyeNorm.x);

    // angle between the nose-to-eye line and the vertical axis
    const dy = noseTipNorm.y - eyeCenter.y;
    const pitch = -Math.atan2(dy, dz);
    
    // offset pitch a bit
    const pitchOffset = Math.PI / 5;
    const adjustedPitch = pitch + pitchOffset;

    // negate to match Three.js coordinate system
    return {
        x: -adjustedPitch,
        y: -yaw,
        z: -roll
    };
  }

  drawCtx() {
    this.ctx.drawImage(
        this.video, 0, 0, this.video.videoWidth, this.video.videoHeight);
  }

  drawResults(faces, triangulateMesh, boundingBox) {
    drawResults(this.ctx, faces, triangulateMesh, boundingBox);
    if (!this.model) return;

    const rotation = this.getCalculatedRotation(faces[0].keypoints);
    document.getElementById('rotation').innerText = `x: ${rotation.x.toFixed(5)}, y: ${rotation.y.toFixed(5)}, z: ${rotation.z.toFixed(5)}`;

    // Normalize angles to range [-π, π]
    const normalizeAngle = (angle) => {
      while (angle > Math.PI) angle -= 2 * Math.PI;
      while (angle < -Math.PI) angle += 2 * Math.PI;
      return angle;
    };

    rotation.x = normalizeAngle(rotation.x);
    rotation.y = normalizeAngle(rotation.y);
    rotation.z = normalizeAngle(rotation.z);

    // Smooth the rotation using interpolation
    const interpolateAngle = (current, target, factor) => {
      const delta = normalizeAngle(target - current);
      return current + delta * factor;
    };

    const smoothingFactor = 0.125;
    this.model.rotation.x = interpolateAngle(this.model.rotation.x, rotation.x, smoothingFactor);
    this.model.rotation.y = interpolateAngle(this.model.rotation.y, rotation.y, smoothingFactor);
    this.model.rotation.z = interpolateAngle(this.model.rotation.z, rotation.z, smoothingFactor);
  }
}
