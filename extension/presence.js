(() => {
  const root = document.documentElement;
  if (!root || root.dataset.guiaExtension === "1") return;
  root.dataset.guiaExtension = "1";
  root.dispatchEvent(new CustomEvent("guia-extension-present"));
})();
