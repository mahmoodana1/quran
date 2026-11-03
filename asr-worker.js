// Speech recognition for التسميع, off the main thread: Tarteel's Whisper base
// model fine-tuned on Quran recitation (ONNX, int8), run by transformers.js.
// The model is downloaded once on request and kept in the browser's cache
// ('transformers-cache'); after that it works offline and audio never leaves
// the device.
// Messages in: { type: 'load' }, { type: 'run', id, audio: Float32Array (16 kHz) }
// Messages out: progress { file, loaded, total }, ready, text { id, text }, error { message }
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';

const MODEL = 'An0xity/whisper-base-ar-quran-onnx-timestamped';
env.allowLocalModels = false;

let asr = null, loading = null;

function load() {
  return loading ||= pipeline('automatic-speech-recognition', MODEL, {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    device: 'wasm',
    progress_callback: p => {
      if (p.status === 'progress') postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
    },
  }).then(p => {
    asr = p;
    postMessage({ type: 'ready' });
    return p;
  }).catch(e => {
    loading = null;
    postMessage({ type: 'error', message: String(e?.message || e) });
  });
}

onmessage = async ({ data }) => {
  if (data.type === 'load') load();
  if (data.type === 'run') {
    await load();
    if (!asr) return;
    try {
      const out = await asr(data.audio, { language: 'arabic', task: 'transcribe' });
      postMessage({ type: 'text', id: data.id, text: out.text || '' });
    } catch (e) {
      postMessage({ type: 'error', id: data.id, message: String(e?.message || e) });
    }
  }
};
