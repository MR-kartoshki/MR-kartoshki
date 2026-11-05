(() => {
  const systemMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let disabled = false;
  try { disabled = localStorage.getItem("effectsDisabled") === "true"; } catch { /* Storage may be blocked. */ }
  const motion = new EventTarget();
  Object.defineProperty(motion, "matches", { get: () => disabled || systemMotion.matches });
  window.siteMotion = motion;
  const button = document.getElementById("effectsToggle");
  function sync() {
    document.documentElement.classList.toggle("effects-off", motion.matches);
    button.textContent = motion.matches ? "Effects off" : "Effects on";
    button.setAttribute("aria-pressed", String(!motion.matches));
    motion.dispatchEvent(new Event("change"));
  }
  button.addEventListener("click", () => {
    disabled = !disabled;
    try { localStorage.setItem("effectsDisabled", String(disabled)); } catch { /* Keep the setting for this visit. */ }
    sync();
  });
  systemMotion.addEventListener("change", sync);
  sync();
})();
