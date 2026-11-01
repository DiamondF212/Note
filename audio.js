/* Modulo Registratore Audio Offline */
(function (N) {
  'use strict';
  let recorder = null;
  let chunks = [];

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start();
  }

  function stop() {
    return new Promise((resolve) => {
      if (!recorder) return resolve(null);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => { resolve(reader.result); };
      };
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
    });
  }

  N.audio = { start, stop };
})((window.N = window.N || {}));
