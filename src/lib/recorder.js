// Records a canvas to a video file with MediaRecorder (MP4 where the browser can, WebM otherwise).

const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function recordCanvas(canvas, fps = 60) {
  if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
    throw new Error("This browser can't record the canvas.");
  }
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error("This browser can't encode video.");
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 14_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(250);
  return {
    extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
        };
        recorder.stop();
      }),
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
