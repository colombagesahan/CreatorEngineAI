// 1. IMPORTS
import {
  FFmpeg
} from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/esm/index.js";
import {
  fetchFile,
  toBlobURL
} from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";
import Alpine
from "https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/module.esm.js";

// Console Warning Fix
const origWarn = console.warn;
console.warn = (...args) => {
  if (args[0] && typeof args[0] === 'string' &&
    args[0].includes('cdn.tailwindcss.com')) return;
  origWarn.apply(console, args);
};

// 2. DEFINE APPLICATION LOGIC
function createVideoApp() {
  return {
    step: 1,
    mode: 'quick',
    format: '9:16',
    topic: '',
    targetCountry: 'USA',
    loading: false,
    processing: false,
    progressText: '',

    // Video State
    videoURL: null,
    apiKey: 'AIzaSyBPoOd87sG2LpICsMk6mi7Aeg9nvKTWq5c',

    // FFmpeg State
    ffmpeg: null,
    converting: false,
    mp4URL: null,
    scenes: [],
    audioCtx: null,
    dest: null,
    mediaRecorder: null,
    audioChunks: [],
    recordingIndex: null,
    recStartTime: 0,
    validModel: null,
    bgMusicFile: null,
    bgMusicBuffer: null,
    voiceVol: 1.0,
    musicVol: 0.15,
    useBgMusic: false,
    metadataLoading: false,
    generatedTitle: '',
    generatedDescription: '',

    animState: {
      img: null,
      video: null,
      text: "",
      color: "#fff",
      zoom: 1.0,
      textY: 100,
      textAlpha: 0,
      fontSize: 80,
      animation: 'fade',
      progress: 0
    },

    init() {
      const cvs = document.getElementById('videoCanvas');
      if (this.format === '9:16') {
        cvs.width = 1080;
        cvs.height = 1920;
      } else {
        cvs.width = 1920;
        cvs.height = 1080;
      }
    },

    cleanup() {
      this.scenes.forEach(s => {
        if (s.media_url && s.media_url.startsWith('blob:')) {
          URL.revokeObjectURL(s.media_url);
        }
      });
      if (this.videoURL) URL.revokeObjectURL(this.videoURL);
      if (this.mp4URL) URL.revokeObjectURL(this.mp4URL);
    },

    reset() {
      this.cleanup();
      this.step = 1;
      this.topic = '';
      this.scenes = [];
      this.bgMusicFile = null;
      this.generatedTitle = '';
      this.generatedDescription = '';
      this.mp4URL = null;
      this.converting = false;
    },

    // --- FFMPEG (Fixed for GitHub Pages) ---
    async convertToMP4() {
      if (!this.videoURL) return alert("No video to convert!");
      this.converting = true;
      try {
        if (!this.ffmpeg) {
          this.ffmpeg = new FFmpeg();
          const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6';
          const esmURL = `${baseURL}/dist/esm`;

          // 1. Manually fetch the worker code
          const workerResp = await fetch(`${esmURL}/ffmpeg-core.worker.js`);
          const workerText = await workerResp.text();
          // 2. Create a local Blob for the worker
          const workerBlob = new Blob([workerText], {
            type: 'text/javascript'
          });
          const workerObjURL = URL.createObjectURL(workerBlob);

          await this.ffmpeg.load({
            coreURL: await toBlobURL(`${esmURL}/ffmpeg-core.js`,
              'text/javascript'),
            wasmURL: await toBlobURL(`${esmURL}/ffmpeg-core.wasm`,
              'application/wasm'),
            workerURL: workerObjURL // Pass the local Blob URL
          });
        }

        await this.ffmpeg.writeFile('input.webm',
          await fetchFile(this.videoURL));

        await this.ffmpeg.exec([
          '-i', 'input.webm',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          'output.mp4'
        ]);

        const data = await this.ffmpeg.readFile('output.mp4');
        const blob = new Blob([data.buffer], {
          type: 'video/mp4'
        });
        this.mp4URL = URL.createObjectURL(blob);
      } catch (error) {
        console.error("Conversion Error:", error);
        alert(`Error: ${error.message}. If this persists, ` +
          `it is likely a GitHub Pages threading limitation.`);
      }
      this.converting = false;
    },

    // --- AI & LOGIC ---
    async getValidModel() {
      if (this.validModel) return this.validModel;
      try {
        const base = "https://generativelanguage.googleapis.com/v1beta/models";
        const res = await fetch(`${base}?key=${this.apiKey}`);
        const data = await res.json();
        const good = data.models?.find(m =>
          m.name.includes("gemini-1.5-flash") || m.name.includes("gemini-pro")
        );
        this.validModel = good ? good.name.replace("models/", "") :
          "gemini-1.5-flash";
        return this.validModel;
      } catch (e) {
        return "gemini-1.5-flash";
      }
    },

    async generateTrendingTopic() {
      this.loading = true;
      try {
        const model = await this.getValidModel();
        const prompt =
          `Give ONE viral YouTube Short topic for ${this.targetCountry}.` +
          ` Return text only.`;
        const base = "https://generativelanguage.googleapis.com/v1beta/models";
        const url = `${base}/${model}:generateContent?key=${this.apiKey}`;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }]
          })
        });
        const data = await res.json();
        this.topic = data.candidates[0].content.parts[0].text.trim();
      } catch (e) {
        alert("Trend Error");
      }
      this.loading = false;
    },

    async generateScript() {
      if (!this.topic) return alert("Enter a topic!");
      this.loading = true;
      this.init();
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();
        this.dest = this.audioCtx.createMediaStreamDestination();
        await this.audioCtx.resume();
      } catch (e) {}

      const model = await this.getValidModel();
      let prompt = `Act as a Viral Director. Target: ${this.targetCountry}. `;
      prompt += `Topic: "${this.topic}" Create 3 scenes. `;
      prompt += `Scene 1: Hook (<8 words). Scenes 2-3: Content (<12 words). `;
      prompt += `For 'color_hex': Pick NEON (#FF0055, #00CCFF, #00FF99). `;
      prompt += `Return JSON: { "scenes": [{ "text": "...", "color_hex": "..." }] };`;

      try {
        const base = "https://generativelanguage.googleapis.com/v1beta/models";
        const url = `${base}/${model}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }]
          })
        });
        const data = await response.json();
        let raw = data.candidates[0].content.parts[0].text;
        raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();

        const json = JSON.parse(raw);
        this.scenes = json.scenes.map((s, i) => ({
          text: s.text,
          media_url: null,
          media_type: 'none',
          image_source: 'Empty',
          type: i === 0 ? 'hook' : 'content',
          color: s.color_hex || '#FFD700',
          fontSize: 80,
          duration: 5,
          audio_blob: null,
          isWriting: false,
          recDuration: 0,
          animation: 'fade'
        }));
        this.loading = false;
        this.step = 2;
      } catch (e) {
        console.error(e);
        alert("AI Error. Try again.");
        this.loading = false;
      }
    },

    addScene() {
      this.scenes.push({
        text: "",
        media_url: null,
        media_type: 'none',
        image_source: 'Empty',
        type: 'content',
        color: '#00CCFF',
        fontSize: 80,
        duration: 5,
        audio_blob: null,
        isWriting: false,
        recDuration: 0,
        animation: 'fade'
      });
    },

    addOutro() {
      this.scenes.push({
        text: "Thanks for watching! Subscribe 🔔",
        media_url: null,
        media_type: 'none',
        image_source: 'Empty',
        type: 'outro',
        color: '#00FF99',
        fontSize: 80,
        duration: 5,
        audio_blob: null,
        isWriting: false,
        recDuration: 0,
        animation: 'zoom'
      });
    },

    async autoWriteScene(index) {
      this.scenes[index].isWriting = true;
      const model = await this.getValidModel();
      const prompt =
        `Topic: "${this.topic}". Write ONE short line (max 10 words, emoji).`;
      try {
        const base = "https://generativelanguage.googleapis.com/v1beta/models";
        const url = `${base}/${model}:generateContent?key=${this.apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }]
          })
        });
        const data = await res.json();
        this.scenes[index].text = data.candidates[0].content.parts[0].text.trim();
      } catch (e) {
        this.scenes[index].text = "Error.";
      }
      this.scenes[index].isWriting = false;
    },

    handleUpload(event, index) {
      const file = event.target.files[0];
      if (file) {
        if (this.scenes[index].media_url) {
          URL.revokeObjectURL(this.scenes[index].media_url);
        }
        this.scenes[index].media_url = URL.createObjectURL(file);
        const isVid = file.type.startsWith('video');
        this.scenes[index].media_type = isVid ? 'video' : 'image';
        this.scenes[index].image_source = 'Upload';
      }
    },

    handleMusicUpload(event) {
      const file = event.target.files[0];
      if (file) {
        this.bgMusicFile = file;
        this.useBgMusic = true;
        const reader = new FileReader();
        reader.onload = async (e) => {
          this.bgMusicBuffer = await this.audioCtx.decodeAudioData(e.target.result);
        };
        reader.readAsArrayBuffer(file);
      }
    },

    removeScene(index) {
      if (this.scenes[index].media_url) {
        URL.revokeObjectURL(this.scenes[index].media_url);
      }
      if (this.scenes.length > 1) this.scenes.splice(index, 1);
    },

    playGuide(text) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text || "Text missing");
      u.lang = "en-US";
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    },

    async startRecording(index) {
      window.speechSynthesis.cancel();
      this.recordingIndex = index;
      this.audioChunks = [];
      this.recStartTime = Date.now();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true
        });
        this.mediaRecorder = new MediaRecorder(stream);
        this.mediaRecorder.ondataavailable = e => this.audioChunks.push(e.data);
        this.mediaRecorder.start();
      } catch (e) {
        alert("Mic Access Denied.");
      }
    },

    stopRecording(index) {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
        this.mediaRecorder.onstop = () => {
          const blob = new Blob(this.audioChunks, {
            type: 'audio/webm'
          });
          this.scenes[index].audio_blob = blob;
          const duration = (Date.now() - this.recStartTime) / 1000;
          this.scenes[index].recDuration = duration.toFixed(1);
          this.scenes[index].duration = duration.toFixed(1);
          this.recordingIndex = null;
          this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        };
      }
    },

    playRecording(index) {
      if (this.scenes[index].audio_blob) {
        new Audio(URL.createObjectURL(this.scenes[index].audio_blob)).play();
      }
    },

    async generateMetadata() {
      this.metadataLoading = true;
      try {
        const model = await this.getValidModel();
        let prompt = `Act as SEO Expert. Target: ${this.targetCountry}. `;
        prompt += `Topic: "${this.topic}". Generate: `;
        prompt += `1. Viral Title (max 60 chars). `;
        prompt += `2. Description (max 100 words) + 3 hashtags. `;
        prompt += `Return JSON: { "title": "...", "description": "..." }`;

        const base = "https://generativelanguage.googleapis.com/v1beta/models";
        const url = `${base}/${model}:generateContent?key=${this.apiKey}`;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }]
          })
        });
        const data = await res.json();
        let raw = data.candidates[0].content.parts[0].text;
        raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(raw);
        this.generatedTitle = json.title;
        this.generatedDescription = json.description;
      } catch (e) {
        this.generatedTitle = "🔥 Amazing " + this.topic + " #Shorts";
        this.generatedDescription = "Check out this video! #Viral #Trending";
      }
      this.metadataLoading = false;
    },

    async startRendering() {
      const missingImgs = this.scenes.some(s => !s.media_url && s.type !== 'outro');
      if (missingImgs) return alert("⚠️ Please upload visuals for all scenes!");
      this.processing = true;
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      const canvas = document.getElementById('videoCanvas');
      const ctx = canvas.getContext('2d');
      const assets = [];

      for (let i = 0; i < this.scenes.length; i++) {
        this.progressText = `Preparing Scene ${i+1}/${this.scenes.length}`;
        const s = this.scenes[i];
        try {
          if (s.media_type === 'video') {
            const v = document.createElement('video');
            v.src = s.media_url;
            v.muted = true;
            v.loop = true;
            await new Promise((resolve, reject) => {
              v.onloadedmetadata = resolve;
              v.onerror = reject;
              v.load();
            });
            assets.push({
              type: 'video',
              el: v
            });
          } else {
            if (!s.media_url) {
              assets.push({
                type: 'placeholder',
                el: null
              });
            } else {
              const imgPromise = this.loadImage(s.media_url);
              const timeoutP = new Promise(r => setTimeout(() => r(null), 3000));
              const img = await Promise.race([imgPromise, timeoutP]);
              assets.push(img ? {
                type: 'image',
                el: img
              } : {
                type: 'placeholder',
                el: null
              });
            }
          }
        } catch (e) {
          assets.push({
            type: 'placeholder',
            el: null
          });
        }
      }

      if (this.bgMusicBuffer && this.useBgMusic) {
        const s = this.audioCtx.createBufferSource();
        s.buffer = this.bgMusicBuffer;
        s.loop = true;
        const g = this.audioCtx.createGain();
        g.gain.value = this.musicVol;
        s.connect(g);
        g.connect(this.dest);
        s.start(0);
        this.bgMusicNode = s;
      }

      this.progressText = "Rendering...";
      const canvasStream = canvas.captureStream(30);
      const osc = this.audioCtx.createOscillator();
      osc.frequency.value = 0;
      const g = this.audioCtx.createGain();
      g.gain.value = 0.001;
      osc.connect(g);
      g.connect(this.dest);
      osc.start();

      const tracks = [
        ...canvasStream.getVideoTracks(),
        ...this.dest.stream.getAudioTracks()
      ];
      const combinedStream = new MediaStream(tracks);

      let options = {
        mimeType: 'video/webm; codecs=vp9',
        videoBitsPerSecond: 3500000
      };
      if (!MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
        options = {
          mimeType: 'video/webm',
          videoBitsPerSecond: 3500000
        };
      }
      const mediaRecorder = new MediaRecorder(combinedStream, options);
      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.start(100);

      let isRendering = true;
      const renderFrame = () => {
        if (!isRendering) return;
        try {
          ctx.fillStyle = "black";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          if (this.animState.video) {
            const v = this.animState.video;
            const vRatio = v.videoWidth / v.videoHeight;
            const cRatio = canvas.width / canvas.height;
            let dw, dh, dx, dy;
            if (vRatio > cRatio) {
              dh = canvas.height;
              dw = dh * vRatio;
              dy = 0;
              dx = (canvas.width - dw) / 2;
            } else {
              dw = canvas.width;
              dh = dw / vRatio;
              dx = 0;
              dy = (canvas.height - dh) / 2;
            }
            ctx.drawImage(v, dx, dy, dw, dh);
          } else if (this.animState.img) {
            ctx.save();
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            ctx.translate(cx, cy);
            ctx.scale(this.animState.zoom, this.animState.zoom);
            ctx.translate(-cx, -cy);
            const imgRatio = this.animState.img.width / this.animState.img.height;
            const canvasRatio = canvas.width / canvas.height;
            let dw, dh, dx, dy;
            if (imgRatio > canvasRatio) {
              dh = canvas.height;
              dw = dh * imgRatio;
              dy = 0;
              dx = (canvas.width - dw) / 2;
            } else {
              dw = canvas.width;
              dh = dw / imgRatio;
              dx = 0;
              dy = (canvas.height - dh) / 2;
            }
            ctx.drawImage(this.animState.img, dx, dy, dw, dh);
            ctx.restore();
            this.animState.zoom += 0.0015;
          } else {
            const grd = ctx.createLinearGradient(0, 0, 0, canvas.height);
            grd.addColorStop(0, "#0f0f1a");
            grd.addColorStop(1, "#1a1a2e");
            ctx.fillStyle = grd;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          const grad = ctx.createRadialGradient(
            canvas.width / 2, canvas.height / 2, canvas.width / 3,
            canvas.width / 2, canvas.height / 2, canvas.height
          );
          grad.addColorStop(0, "rgba(0,0,0,0)");
          grad.addColorStop(1, "rgba(0,0,0,0.85)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          if (this.animState.animation === 'slide') {
            if (this.animState.textY > 0) this.animState.textY *= 0.9;
            this.animState.textAlpha = Math.min(this.animState.textAlpha + 0.05, 1);
          } else if (this.animState.animation === 'typewriter') {
            this.animState.progress += 0.5;
            this.animState.textAlpha = 1;
            this.animState.textY = 0;
          } else {
            this.animState.textAlpha = Math.min(this.animState.textAlpha + 0.05, 1);
            this.animState.textY = 0;
          }

          ctx.save();
          ctx.globalAlpha = this.animState.textAlpha;
          const boxH = canvas.height * 0.25;
          const boxY = canvas.height - boxH - 50;

          ctx.fillStyle = "rgba(0,0,0,0.8)";
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(40, boxY, canvas.width - 80, boxH, 30);
          else ctx.rect(40, boxY, canvas.width - 80, boxH);
          ctx.fill();

          ctx.fillStyle = this.animState.color;
          const fontName = "Montserrat, 'Noto Color Emoji'";
          ctx.font = `900 ${this.animState.fontSize}px ${fontName}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          let displayText = this.animState.text;
          if (this.animState.animation === 'typewriter') {
            const charCount = Math.floor(this.animState.progress);
            displayText = this.animState.text.substring(0, charCount);
          }
          this.wrapText(
            ctx, displayText, canvas.width / 2,
            boxY + (boxH / 2) + this.animState.textY,
            canvas.width * 0.8, this.animState.fontSize * 1.2
          );
          ctx.restore();

        } catch (e) {}
        requestAnimationFrame(renderFrame);
      };

      requestAnimationFrame(renderFrame);

      for (let i = 0; i < this.scenes.length; i++) {
        const scene = this.scenes[i];
        const asset = assets[i];
        try {
          if (asset && asset.type === 'video') {
            this.animState.video = asset.el;
            this.animState.img = null;
            asset.el.play();
          } else if (asset && asset.type === 'image') {
            this.animState.img = asset.el;
            this.animState.video = null;
            this.animState.zoom = 1.05;
          } else {
            this.animState.img = null;
            this.animState.video = null;
          }

          this.animState.text = scene.text;
          this.animState.color = scene.color || '#FFD700';
          this.animState.fontSize = parseInt(scene.fontSize) || 80;
          this.animState.animation = scene.animation || 'fade';
          this.animState.textY = 100;
          this.animState.textAlpha = 0;
          this.animState.progress = 0;

          const sceneDur = parseFloat(scene.duration) * 1000;
          const isCreator = (this.mode === 'creator' && scene.audio_blob);
          const p1 = isCreator ?
            this.playBlobAudio(scene.audio_blob) :
            this.playTTS(scene.text, scene.duration);

          await Promise.all([p1, new Promise(r => setTimeout(r, sceneDur))]);

          if (asset && asset.type === 'video') asset.el.pause();
        } catch (e) {}
      }

      await new Promise(r => setTimeout(r, 2000));
      isRendering = false;
      if (this.bgMusicNode) this.bgMusicNode.stop();
      mediaRecorder.stop();

      mediaRecorder.onstop = () => {
        this.videoURL = URL.createObjectURL(new Blob(chunks, {
          type: 'video/webm'
        }));
        this.processing = false;
        this.step = 3;
        this.generateMetadata();
      };
    },

    async loadImage(url) {
      return new Promise((resolve) => {
        const img = new Image();
        if (url && !url.startsWith('blob:')) img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
    },

    async playTTS(text, duration) {
      return new Promise((resolve) => {
        if (!text) return resolve();
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.0;
        u.volume = this.voiceVol;
        u.onend = () => {
          resolve();
        };
        u.onerror = () => {
          resolve();
        };
        try {
          window.speechSynthesis.speak(u);
        } catch (e) {
          resolve();
        }
        setTimeout(resolve, (text.length * 100) + 2000);
      });
    },

    async playBlobAudio(blob) {
      return new Promise(async (resolve) => {
        try {
          const ab = await blob.arrayBuffer();
          const buf = await this.audioCtx.decodeAudioData(ab);
          const s = this.audioCtx.createBufferSource();
          s.buffer = buf;
          const g = this.audioCtx.createGain();
          g.gain.value = this.voiceVol;
          s.connect(g);
          g.connect(this.dest);
          s.onended = () => {
            s.disconnect();
            resolve();
          };
          s.start(0);
        } catch (e) {
          resolve();
        }
      });
    },

    wrapText(ctx, text, x, y, maxWidth, lineHeight) {
      const words = text.split(' ');
      let line = '';
      let lines = [];
      for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && n > 0) {
          lines.push(line);
          line = words[n] + ' ';
        } else {
          line = testLine;
        }
      }
      lines.push(line);
      let startY = y - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((l, i) => {
        ctx.fillText(l, x, startY + (i * lineHeight));
      });
    }
  };
}

// 3. ATTACH TO WINDOW & START ALPINE
window.videoApp = createVideoApp;

// Only start Alpine if it hasn't started yet
document.addEventListener('alpine:init', () => {
  // Logic if needed on init
});

// Since we are using modules, Alpine might need a kickstart if not auto-loaded
Alpine.start();
