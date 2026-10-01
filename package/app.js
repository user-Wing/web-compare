(() => {
  const unmount = WebCompare.mount(document.getElementById('app'), new URL('.', document.currentScript.src).href);
  window.addEventListener('pagehide', () => void unmount(), { once: true });
})();
