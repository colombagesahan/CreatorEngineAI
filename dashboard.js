import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp, getDocs, collection, query, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyAE88FW3US3aZRn5TLEdXkad-jvak3W4yI",
    authDomain: "sahantechhub.firebaseapp.com",
    projectId: "sahantechhub",
    storageBucket: "sahantechhub.firebasestorage.app",
    messagingSenderId: "605792804808",
    appId: "1:605792804808:web:531be19ce5f6a4a17faafd",
    measurementId: "G-JMSXWQ964T"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const { fetchFile, toBlobURL } = FFmpegUtil;
const { FFmpeg } = FFmpegWASM;

document.addEventListener('alpine:init', () => {
    Alpine.data('videoApp', () => ({
        step: 1, mode: 'quick', targetCountry: 'USA', format: '9:16', topic: '', loading: false, processing: false, progressText: '',
        videoURL: null, 
        apiKey: 'AIzaSyBX8sgQFlSVm1CtOT1PvrMcjHrYGvVQw8M',

        // FFmpeg State
        ffmpeg: null,
        converting: false,
        mp4URL: null,
        
        scenes: [], audioCtx: null, dest: null,
        mediaRecorder: null, audioChunks: [], recordingIndex: null, recStartTime: 0,
        validModel: null, bgMusicFile: null, bgMusicBuffer: null,
        
        voiceVol: 1.0, musicVol: 0.15, useBgMusic: false,
        metadataLoading: false, generatedTitle: '', generatedDescription: '',

        animState: { img: null, video: null, text: "", color: "#fff", zoom: 1.0, textY: 100, textAlpha: 0, fontSize: 80, animation: 'fade', progress: 0 },
        
        // User & Trial State
        user: null,
        trialActive: true,

        init() {
            this.checkAuth();
            this.checkForAlerts();
            const cvs = document.getElementById('videoCanvas');
            if(this.format === '9:16') { cvs.width = 1080; cvs.height = 1920; }
            else { cvs.width = 1920; cvs.height = 1080; }

            // Slip Upload Logic
            const slipInput = document.getElementById('slipInput');
            slipInput.addEventListener('change', (e) => {
                const f = e.target.files[0];
                if(f) document.getElementById('slipFileName').innerText = f.name;
            });

            document.getElementById('submitSlipBtn').addEventListener('click', () => this.uploadSlip());
        },

        checkAuth() {
            onAuthStateChanged(auth, async (u) => {
                if (!u) { window.location.href = "index.html"; return; }
                this.user = u;
                this.checkTrialStatus(u.uid);
            });
        },

        async checkTrialStatus(uid) {
            const userRef = doc(db, "users", uid);
            const snap = await getDoc(userRef);
            if (!snap.exists()) return;

            const data = snap.data();
            const now = new Date();
            const created = data.createdAt ? data.createdAt.toDate() : now;
            const diffMs = now - created;
            const hoursLeft = 24 - (diffMs / (1000 * 60 * 60));

            // Provisional Unlock Logic (30 Mins)
            let provisionalUnlock = false;
            if (data.status === 'pending' && data.slip_uploaded_at) {
                 const slipTime = data.slip_uploaded_at.toDate();
                 const slipDiffMins = (now - slipTime) / (1000 * 60);
                 if (slipDiffMins >= 30) provisionalUnlock = true;
                 else {
                     // Still waiting logic
                     document.getElementById('lockScreen').classList.remove('hidden');
                     document.getElementById('pendingMessage').classList.remove('hidden');
                     return; 
                 }
            }

            if (data.status === 'active' || provisionalUnlock) {
                this.trialActive = true;
                return;
            }

            if (data.status === 'locked' || (data.status === 'trial' && hoursLeft <= 0)) {
                document.getElementById('lockScreen').classList.remove('hidden');
                this.trialActive = false;
            } else if (data.status === 'trial') {
                document.getElementById('trialTimer').classList.remove('hidden');
                document.getElementById('timeLeft').innerText = Math.floor(hoursLeft) + "h " + Math.floor((hoursLeft % 1) * 60) + "m";
            }
        },

        async checkForAlerts() {
            // Checks for global alerts
            try {
                const q = query(collection(db, "alerts"), limit(1));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const msg = snap.docs[0].data().message;
                    if (msg) {
                        document.getElementById('alertMessage').innerText = msg;
                        document.getElementById('alertModal').classList.remove('hidden');
                    }
                }
            } catch (e) { console.log("No alerts"); }
        },

        async uploadSlip() {
            const file = document.getElementById('slipInput').files[0];
            if (!file) return alert("Please select an image file.");
            
            const btn = document.getElementById('submitSlipBtn');
            btn.innerText = "Uploading...";
            btn.disabled = true;

            try {
                const storageRef = ref(storage, `slips/${this.user.uid}_${Date.now()}`);
                await uploadBytes(storageRef, file);
                const url = await getDownloadURL(storageRef);

                await updateDoc(doc(db, "users", this.user.uid), {
                    status: 'pending',
                    slip_url: url,
                    slip_uploaded_at: serverTimestamp()
                });

                document.getElementById('pendingMessage').classList.remove('hidden');
                btn.innerText = "Submitted";
                alert("Slip uploaded! Please wait 30 minutes for auto-unlock.");
            } catch (e) {
                console.error(e);
                alert("Upload failed. Try again.");
                btn.innerText = "Submit & Unlock";
                btn.disabled = false;
            }
        },

        cleanup() {
            this.scenes.forEach(s => {
                if(s.media_url && s.media_url.startsWith('blob:')) URL.revokeObjectURL(s.media_url);
            });
            if(this.videoURL) URL.revokeObjectURL(this.videoURL);
            if(this.mp4URL) URL.revokeObjectURL(this.mp4URL);
        },

        reset() { 
            this.cleanup();
            this.step = 1; this.topic = ''; this.scenes = []; this.bgMusicFile = null; 
            this.generatedTitle = ''; this.generatedDescription = '';
            this.mp4URL = null; this.converting = false;
        },

        // --- FFMPEG CONVERSION LOGIC ---
        async convertToMP4() {
            if (!this.videoURL) return alert("No video to convert!");
            this.converting = true;

            try {
                if (!this.ffmpeg) {
                    this.ffmpeg = new FFmpeg();
                    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
                    await this.ffmpeg.load({
                        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
                    });
                }

                await this.ffmpeg.writeFile('input.webm', await fetchFile(this.videoURL));

                await this.ffmpeg.exec([
                    '-i', 'input.webm',
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast', 
                    '-pix_fmt', 'yuv420p',
                    'output.mp4'
                ]);

                const data = await this.ffmpeg.readFile('output.mp4');
                const blob = new Blob([data.buffer], { type: 'video/mp4' });
                this.mp4URL = URL.createObjectURL(blob);

            } catch (error) {
                console.error("Conversion Error:", error);
                alert("Conversion failed. Check console for SharedArrayBuffer errors.");
            }

            this.converting = false;
        },

        // --- EXISTING LOGIC ---

        async getValidModel() {
            if (this.validModel) return this.validModel;
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
                const data = await res.json();
                const good = data.models?.find(m => m.name.includes("gemini-1.5-flash") || m.name.includes("gemini-pro"));
                this.validModel = good ? good.name.replace("models/", "") : "gemini-1.5-flash";
                return this.validModel;
            } catch (e) { return "gemini-1.5-flash"; }
        },

        async generateTrendingTopic() {
            this.loading = true;
            try {
                const model = await this.getValidModel();
                const prompt = `Give ONE viral YouTube Short topic for ${this.targetCountry}. Return text only.`;
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                const data = await res.json();
                this.topic = data.candidates[0].content.parts[0].text.trim();
            } catch(e) { alert("Trend Error"); }
            this.loading = false;
        },

        async generateScript() {
            if(!this.topic) return alert("Enter a topic!");
            this.loading = true;
            
            const cvs = document.getElementById('videoCanvas');
            if(this.format === '9:16') { cvs.width = 1080; cvs.height = 1920; }
            else { cvs.width = 1920; cvs.height = 1080; }

            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                this.audioCtx = new AudioContext();
                this.dest = this.audioCtx.createMediaStreamDestination();
                await this.audioCtx.resume();
            } catch(e) {}

            const model = await this.getValidModel();
            const prompt = `Act as a Viral Video Director. Target: ${this.targetCountry}. Topic: "${this.topic}"
            Create 3 scenes. Scene 1: Hook (< 8 words). Scenes 2-3: Content (< 12 words).
            For 'color_hex': Pick NEON color (#FF0055, #00CCFF, #00FF99, #FFD700).
            Return JSON: { "scenes": [ { "text": "...", "color_hex": "..." } ] }`;

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                const data = await response.json();
                let raw = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
                const json = JSON.parse(raw);
                
                this.scenes = json.scenes.map((s, i) => ({
                    text: s.text, media_url: null, media_type: 'none', image_source: 'Empty',
                    type: i === 0 ? 'hook' : 'content',
                    color: s.color_hex || '#FFD700',
                    fontSize: 80, duration: 5, audio_blob: null, isWriting: false,
                    recDuration: 0, animation: 'fade'
                }));
                this.loading = false; this.step = 2; 
            } catch(e) { alert("AI Error. Try again."); this.loading = false; }
        },

        addScene() { this.scenes.push({ text: "", media_url: null, media_type: 'none', image_source: 'Empty', type: 'content', color: '#00CCFF', fontSize: 80, duration: 5, audio_blob: null, isWriting: false, recDuration: 0, animation: 'fade' }); },
        addOutro() { this.scenes.push({ text: "Thanks for watching! Subscribe 🔔", media_url: null, media_type: 'none', image_source: 'Empty', type: 'outro', color: '#00FF99', fontSize: 80, duration: 5, audio_blob: null, isWriting: false, recDuration: 0, animation: 'zoom' }); },

        async autoWriteScene(index) {
            this.scenes[index].isWriting = true;
            const model = await this.getValidModel();
            const prompt = `Topic: "${this.topic}". Write ONE short script line (max 10 words, emoji).`;
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                const data = await res.json();
                this.scenes[index].text = data.candidates[0].content.parts[0].text.trim();
            } catch(e) { this.scenes[index].text = "Error."; }
            this.scenes[index].isWriting = false;
        },

        handleUpload(event, index) {
            const file = event.target.files[0];
            if(file) {
                if(this.scenes[index].media_url) URL.revokeObjectURL(this.scenes[index].media_url);
                this.scenes[index].media_url = URL.createObjectURL(file);
                this.scenes[index].media_type = file.type.startsWith('video') ? 'video' : 'image';
                this.scenes[index].image_source = 'Upload';
            }
        },
        
        handleMusicUpload(event) {
            const file = event.target.files[0];
            if(file) {
                this.bgMusicFile = file; this.useBgMusic = true;
                const reader = new FileReader();
                reader.onload = async (e) => { this.bgMusicBuffer = await this.audioCtx.decodeAudioData(e.target.result); };
                reader.readAsArrayBuffer(file);
            }
        },

        removeScene(index) { 
            if(this.scenes[index].media_url) URL.revokeObjectURL(this.scenes[index].media_url);
            if(this.scenes.length > 1) this.scenes.splice(index, 1); 
        },

        playGuide(text) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text || "Text missing");
            u.lang = "en-US"; u.rate = 0.9;
            window.speechSynthesis.speak(u);
        },

        async startRecording(index) {
            window.speechSynthesis.cancel(); this.recordingIndex = index; this.audioChunks = []; this.recStartTime = Date.now();
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.mediaRecorder = new MediaRecorder(stream);
                this.mediaRecorder.ondataavailable = e => this.audioChunks.push(e.data);
                this.mediaRecorder.start();
            } catch(e) { alert("Mic Access Denied."); }
        },

        stopRecording(index) {
            if(this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    this.scenes[index].audio_blob = blob;
                    const duration = (Date.now() - this.recStartTime) / 1000;
                    this.scenes[index].recDuration = duration.toFixed(1);
                    this.scenes[index].duration = duration.toFixed(1); 
                    this.recordingIndex = null;
                    this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
                };
            }
        },

        playRecording(index) { if(this.scenes[index].audio_blob) new Audio(URL.createObjectURL(this.scenes[index].audio_blob)).play(); },
        
        async generateMetadata() {
            this.metadataLoading = true;
            try {
                const model = await this.getValidModel();
                const prompt = `Act as a YouTube SEO Expert. Target Audience: ${this.targetCountry}. Topic: "${this.topic}". Generate: 1. A viral, high-CTR Title for a YouTube Short (max 60 chars). 2. A human-written, engaging Description (max 100 words) including 3 hashtags. Return strictly valid JSON format: { "title": "...", "description": "..." }`;
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                const data = await res.json();
                let raw = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
                const json = JSON.parse(raw);
                this.generatedTitle = json.title; this.generatedDescription = json.description;
            } catch(e) { 
                this.generatedTitle = "🔥 Amazing " + this.topic + " #Shorts";
                this.generatedDescription = "Check out this incredible video! #Viral #Trending";
            }
            this.metadataLoading = false;
        },

        async startRendering() {
            const missingImgs = this.scenes.some(s => !s.media_url && s.type !== 'outro');
            if(missingImgs) return alert("⚠️ Please upload visuals for all scenes!");

            this.processing = true;
            if(this.audioCtx.state === 'suspended') await this.audioCtx.resume();
            
            const canvas = document.getElementById('videoCanvas');
            const ctx = canvas.getContext('2d');
            const assets = [];

            // 1. PRELOAD ASSETS
            for(let i=0; i<this.scenes.length; i++) {
                this.progressText = `Preparing Scene ${i+1}/${this.scenes.length}`;
                const s = this.scenes[i];
                try {
                    if(s.media_type === 'video') {
                        const v = document.createElement('video');
                        v.src = s.media_url; v.muted = true; v.loop = true; v.playsInline = true;
                        await new Promise((resolve, reject) => { 
                            v.onloadeddata = resolve; 
                            v.onerror = reject; 
                            v.load(); 
                        });
                        assets.push({ type: 'video', el: v });
                    } else {
                        if (!s.media_url) { assets.push({ type: 'placeholder', el: null }); } else {
                            const imgPromise = this.loadImage(s.media_url);
                            const timeoutPromise = new Promise(r => setTimeout(() => r(null), 3000));
                            const img = await Promise.race([imgPromise, timeoutPromise]);
                            if(!img) { assets.push({ type: 'placeholder', el: null }); } else { assets.push({ type: 'image', el: img }); }
                        }
                    }
                } catch(e) { assets.push({ type: 'placeholder', el: null }); }
            }

            // 2. SETUP AUDIO
            if(this.bgMusicBuffer && this.useBgMusic) {
                const s = this.audioCtx.createBufferSource();
                s.buffer = this.bgMusicBuffer; s.loop = true;
                const g = this.audioCtx.createGain(); g.gain.value = this.musicVol;
                s.connect(g); g.connect(this.dest);
                s.start(0);
                this.bgMusicNode = s;
            }

            // 3. SETUP RECORDER
            this.progressText = "Rendering...";
            const canvasStream = canvas.captureStream(30);
            
            // Audio oscillator to ensure track exists
            const osc = this.audioCtx.createOscillator(); osc.frequency.value = 0; 
            const g = this.audioCtx.createGain(); g.gain.value=0.001; 
            osc.connect(g); g.connect(this.dest); osc.start();

            // WebM Recorder with combined streams
            const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
            let options = { mimeType: 'video/webm; codecs=vp9', videoBitsPerSecond: 5000000 };
            if (!MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) { options = { mimeType: 'video/webm', videoBitsPerSecond: 5000000 }; }
            
            const mediaRecorder = new MediaRecorder(combinedStream, options);
            const chunks = [];
            mediaRecorder.ondataavailable = (e) => { if(e.data.size > 0) chunks.push(e.data); };
            mediaRecorder.start(100);

            let isRendering = true;

            // 4. ANIMATION LOOP (Runs continuously)
            const renderFrame = () => {
                if(!isRendering) return;
                
                // Clear Canvas
                ctx.fillStyle = "black"; ctx.fillRect(0,0, canvas.width, canvas.height);
                
                // Draw Background (Video or Image)
                if(this.animState.video) {
                     const v = this.animState.video; 
                     const vRatio = v.videoWidth / v.videoHeight; 
                     const cRatio = canvas.width / canvas.height;
                     let dw, dh, dx, dy;
                     if (vRatio > cRatio) { dh = canvas.height; dw = dh * vRatio; dy = 0; dx = (canvas.width - dw)/2; } 
                     else { dw = canvas.width; dh = dw / vRatio; dx = 0; dy = (canvas.height - dh)/2; }
                     ctx.drawImage(v, dx, dy, dw, dh);
                } else if(this.animState.img) {
                    ctx.save(); 
                    const cx = canvas.width/2; const cy = canvas.height/2;
                    ctx.translate(cx, cy); ctx.scale(this.animState.zoom, this.animState.zoom); ctx.translate(-cx, -cy);
                    const imgRatio = this.animState.img.width / this.animState.img.height; 
                    const canvasRatio = canvas.width / canvas.height;
                    let dw, dh, dx, dy;
                    if (imgRatio > canvasRatio) { dh = canvas.height; dw = dh * imgRatio; dy = 0; dx = (canvas.width - dw) / 2; } 
                    else { dw = canvas.width; dh = dw / imgRatio; dx = 0; dy = (canvas.height - dh) / 2; }
                    ctx.drawImage(this.animState.img, dx, dy, dw, dh); 
                    ctx.restore(); 
                    this.animState.zoom += 0.0015;
                } else {
                    const grd = ctx.createLinearGradient(0, 0, 0, canvas.height); 
                    grd.addColorStop(0, "#0f0f1a"); grd.addColorStop(1, "#1a1a2e"); 
                    ctx.fillStyle = grd; ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                
                // Vignette
                const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, canvas.width/3, canvas.width/2, canvas.height/2, canvas.height);
                grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(0,0,0,0.85)"); 
                ctx.fillStyle = grad; ctx.fillRect(0,0, canvas.width, canvas.height);

                // Text Animation State
                if (this.animState.animation === 'slide') { 
                    if(this.animState.textY > 0) this.animState.textY *= 0.9; 
                    this.animState.textAlpha = Math.min(this.animState.textAlpha + 0.05, 1); 
                } 
                else if (this.animState.animation === 'typewriter') { 
                    this.animState.progress += 0.5; 
                    this.animState.textAlpha = 1; 
                    this.animState.textY = 0; 
                } 
                else { 
                    this.animState.textAlpha = Math.min(this.animState.textAlpha + 0.05, 1); 
                    this.animState.textY = 0; 
                }
                
                // Draw Text Box
                ctx.save(); ctx.globalAlpha = this.animState.textAlpha;
                const boxH = canvas.height * 0.25; const boxY = canvas.height - boxH - 50; 
                ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.beginPath(); 
                if(ctx.roundRect) ctx.roundRect(40, boxY, canvas.width - 80, boxH, 30); else ctx.rect(40, boxY, canvas.width - 80, boxH); 
                ctx.fill();
                
                // Draw Text
                ctx.fillStyle = this.animState.color; 
                ctx.font = `900 ${this.animState.fontSize}px Montserrat, 'Noto Color Emoji'`; 
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                let displayText = this.animState.text;
                if(this.animState.animation === 'typewriter') { 
                    const charCount = Math.floor(this.animState.progress); 
                    displayText = this.animState.text.substring(0, charCount); 
                }
                this.wrapText(ctx, displayText, canvas.width/2, boxY + (boxH/2) + this.animState.textY, canvas.width * 0.8, this.animState.fontSize * 1.2);
                ctx.restore();
                
                requestAnimationFrame(renderFrame);
            };
            requestAnimationFrame(renderFrame);

            // 5. SEQUENCE CONTROLLER
            for (let i = 0; i < this.scenes.length; i++) {
                const scene = this.scenes[i]; const asset = assets[i];
                
                // Update State
                if(asset && asset.type === 'video') { 
                    this.animState.video = asset.el; this.animState.img = null; 
                    await asset.el.play(); 
                } 
                else if (asset && asset.type === 'image') { 
                    this.animState.img = asset.el; this.animState.video = null; this.animState.zoom = 1.05; 
                } 
                else { this.animState.img = null; this.animState.video = null; }
                
                this.animState.text = scene.text; 
                this.animState.color = scene.color || '#FFD700'; 
                this.animState.fontSize = parseInt(scene.fontSize) || 80; 
                this.animState.animation = scene.animation || 'fade';
                this.animState.textY = 100; this.animState.textAlpha = 0; this.animState.progress = 0;
                
                const sceneDur = Math.max(parseFloat(scene.duration) * 1000, 2000); // Min 2 secs
                
                // Play Audio & Wait
                const p1 = (this.mode === 'creator' && scene.audio_blob) 
                    ? this.playBlobAudio(scene.audio_blob) 
                    : this.playTTS(scene.text, scene.duration);
                
                // FORCE WAIT for duration even if TTS fails
                await Promise.all([p1, new Promise(r => setTimeout(r, sceneDur))]);
                
                if(asset && asset.type === 'video') asset.el.pause();
            }

            // Finish
            await new Promise(r => setTimeout(r, 2000)); // Outro tail
            isRendering = false;
            
            if(this.bgMusicNode) this.bgMusicNode.stop();
            mediaRecorder.stop();
            
            mediaRecorder.onstop = () => {
                const finalBlob = new Blob(chunks, { type: 'video/webm' });
                this.videoURL = URL.createObjectURL(finalBlob);
                this.processing = false; this.step = 3; this.generateMetadata();
            };
        },

        async loadImage(url) {
            return new Promise((resolve) => {
                const img = new Image(); if(url && !url.startsWith('blob:')) img.crossOrigin = "Anonymous";
                img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = url;
            });
        },

        async playTTS(text, duration) {
            return new Promise((resolve) => {
                if(!text) return resolve();
                window.speechSynthesis.cancel(); 
                const u = new SpeechSynthesisUtterance(text); 
                u.rate = 1.0; u.volume = this.voiceVol;
                
                // Important: If browser blocks auto-audio, this might fire immediately.
                // The loop logic now handles the timing via setTimeout, so this is just for effect.
                u.onend = () => { resolve(); }; 
                u.onerror = () => { resolve(); };
                try { window.speechSynthesis.speak(u); } catch(e) { resolve(); }
                // Fallback timeout in case onend never fires
                setTimeout(resolve, (text.length * 200) + 2000); 
            });
        },

        async playBlobAudio(blob) {
            return new Promise(async (resolve) => {
                try {
                    const ab = await blob.arrayBuffer(); const buf = await this.audioCtx.decodeAudioData(ab);
                    const s = this.audioCtx.createBufferSource(); s.buffer = buf; const g = this.audioCtx.createGain(); g.gain.value = this.voiceVol; s.connect(g); g.connect(this.dest);
                    s.onended = () => { s.disconnect(); resolve(); }; s.start(0);
                } catch (e) { resolve(); } 
            });
        },

        wrapText(ctx, text, x, y, maxWidth, lineHeight) {
            const words = text.split(' '); let line = ''; let lines = [];
            for(let n = 0; n < words.length; n++) {
                let testLine = line + words[n] + ' ';
                if (ctx.measureText(testLine).width > maxWidth && n > 0) { lines.push(line); line = words[n] + ' '; } else { line = testLine; }
            }
            lines.push(line); let startY = y - ((lines.length - 1) * lineHeight) / 2;
            lines.forEach((l, i) => { ctx.fillText(l, x, startY + (i * lineHeight)); });
        }
    }));
});
