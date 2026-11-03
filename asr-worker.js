// Speech recognition for التسميع, off the main thread: Tarteel's Whisper
// models fine-tuned on Quran recitation (ONNX), run by transformers.js.
// The model is downloaded once on request and kept in the browser's cache
// ('transformers-cache'); after that it works offline and audio never leaves
// the device.
// Messages in: { type: 'load', model, dtype }, { type: 'run', id, audio: Float32Array (16 kHz) }
// Messages out: progress { file, loaded, total }, ready { threads }, text { id, text, ms }, error { message }
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';

env.allowLocalModels = false;
// several cores when the page is cross-origin isolated (see sw.js)
if (self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);

let asr = null, loading = null;

function load(model, dtype) {
  return loading ||= pipeline('automatic-speech-recognition', model, {
    dtype,
    device: 'wasm',
    progress_callback: p => {
      if (p.status === 'progress') postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
    },
  }).then(p => {
    asr = p;
    postMessage({ type: 'ready', threads: env.backends.onnx.wasm.numThreads || 1 });
    return p;
  }).catch(e => {
    loading = null;
    postMessage({ type: 'error', message: String(e?.message || e) });
  });
}

onmessage = async ({ data }) => {
  if (data.type === 'load') load(data.model, data.dtype);
  if (data.type === 'run') {
    await loading;
    if (!asr) return;
    try {
      const t = performance.now();
      const out = await asr(data.audio, { language: 'arabic', task: 'transcribe' });
      postMessage({ type: 'text', id: data.id, text: out.text || '', ms: performance.now() - t });
    } catch (e) {
      postMessage({ type: 'error', id: data.id, message: String(e?.message || e) });
    }
  }
};
