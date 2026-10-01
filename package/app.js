(() => {
  const unmount = WebCompare.mount(document.getElementById('app'));
  window.addEventListener('pagehide', () => void unmount(), { once: true });
})();
