// dev mode (the foot of the settings): code being tried on this device only. index.html writes
// this script in after the others, only with q.ui.dev on; isDev() (app.js) is true there.
// (The redesign tried here first now lives in ui.js.)
(() => {
  if (!isDev()) return;
})();
