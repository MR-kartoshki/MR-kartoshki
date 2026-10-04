const motion = matchMedia("(prefers-reduced-motion: reduce)");
const menu = document.querySelector(".nav-menu");
const navLinks = document.querySelector(".nav-links");
function closeMenu() {
  navLinks.classList.remove("is-open");
  menu.setAttribute("aria-expanded", "false");
}
menu.addEventListener("click", () => {
  const open = navLinks.classList.toggle("is-open");
  menu.setAttribute("aria-expanded", String(open));
});
navLinks.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
menu.closest("nav").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
    menu.focus();
  }
});

const repositoryToggle = document.getElementById("repositoryToggle");
const repositoryPanel = document.getElementById("repositoryPanel");
repositoryToggle.addEventListener("click", () => {
  const open = repositoryToggle.getAttribute("aria-expanded") !== "true";
  repositoryToggle.setAttribute("aria-expanded", String(open));
  repositoryToggle.textContent = open ? "Hide repositories ↑" : "Browse repositories ↓";
  repositoryPanel.inert = !open;
  repositoryPanel.classList.toggle("is-open", open);
});

function initCarousel(carousel) {
  const section = carousel.closest("section");
  const track = carousel.querySelector(".carousel-track");
  const slides = [...track.children];
  const dots = [...section.querySelectorAll("[data-slide]")];
  const carouselStatus = section.querySelector(".carousel-controls [aria-live]");
  // End clones keep both neighboring slides visible without reversing a wrap.
  for (const [slide, prepend] of [[slides.at(-1), true], [slides.at(-2), true], [slides[0], false], [slides[1], false]]) {
    const clone = slide.cloneNode(true);
    clone.setAttribute("aria-hidden", "true");
    clone.inert = true;
    clone.querySelector("[data-stats]")?.removeAttribute("data-stats");
    if (prepend) track.prepend(clone);
    else track.append(clone);
  }
  const allSlides = [...track.children];
  const mediaObserver = new IntersectionObserver((entries, observer) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    carousel.querySelectorAll("img").forEach((image) => { image.loading = "eager"; });
    slides.forEach((slide) => {
      const video = slide.querySelector("video");
      if (!video) return;
      const poster = new Image();
      poster.src = video.poster;
    });
    observer.disconnect();
  }, { rootMargin: "600px" });
  mediaObserver.observe(carousel);
  let position = 2;
  let settleTimer;
  let target = null;
  let activeSlide = -1;
  function slideLeft(index) {
    const card = allSlides[index];
    return card.offsetLeft - track.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2;
  }
  function showSlide(index, smooth = true) {
    position = index;
    target = smooth ? index : null;
    updateSlide();
    carousel.scrollTo({ left: slideLeft(index), behavior: smooth && !motion.matches ? "smooth" : "instant" });
  }
  function updateSlide() {
    const active = (position - 2 + slides.length) % slides.length;
    if (active === activeSlide) return;
    activeSlide = active;
    dots.forEach((dot, index) => dot.setAttribute("aria-current", String(index === active)));
    slides.forEach((slide, index) => {
      slide.inert = index !== active;
      if (slide.inert) slide.dispatchEvent(new Event("carouselinactive"));
    });
    carouselStatus.textContent = `${slides[active].querySelector("h3").textContent}, ${section.id === "projects" ? "project" : "video"} ${active + 1} of ${slides.length}`;
  }
  function settle() {
    if (Math.abs(carousel.scrollLeft - slideLeft(position)) > 1) return;
    target = null;
    if (position < 2) showSlide(position + slides.length, false);
    else if (position >= slides.length + 2) showSlide(position - slides.length, false);
    updateSlide();
  }
  carousel.addEventListener("scroll", () => {
    if (target === null) position = allSlides.reduce((nearest, _, index) =>
      Math.abs(slideLeft(index) - carousel.scrollLeft) < Math.abs(slideLeft(nearest) - carousel.scrollLeft) ? index : nearest, 0);
    updateSlide();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 160);
  }, { passive: true });
  carousel.addEventListener("scrollend", settle);
  function step(direction) {
    clearTimeout(settleTimer);
    if (position < 2 || position >= slides.length + 2) {
      settle();
      if (position < 2 || position >= slides.length + 2) return;
    }
    showSlide(position + direction);
  }
  section.querySelectorAll("[data-direction]").forEach((button) => {
    button.addEventListener("click", () => step(Number(button.dataset.direction)));
  });
  dots.forEach((dot) => dot.addEventListener("click", () => showSlide(Number(dot.dataset.slide) + 2)));
  carousel.addEventListener("keydown", (event) => {
    if (event.target.closest("video")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  });
  carousel.addEventListener("pointerdown", () => { target = null; });
  carousel.addEventListener("wheel", () => { target = null; }, { passive: true });
  let width = carousel.clientWidth;
  new ResizeObserver(() => {
    if (carousel.clientWidth === width) return;
    width = carousel.clientWidth;
    showSlide(position, false);
  }).observe(carousel);
  showSlide(2, false);
  updateSlide();
}
document.querySelectorAll(".project-carousel").forEach(initCarousel);

const canPreview = matchMedia("(hover: hover) and (pointer: fine)");
const videoCards = [...document.querySelectorAll(".video-card:not([aria-hidden])")];
const videos = videoCards.map((card) => card.querySelector("video"));
for (const card of videoCards) {
  const stage = card.querySelector(".video-stage");
  const video = card.querySelector("video");
  const button = card.querySelector(".video-play");
  const status = card.querySelector(".video-status");
  let full = false;
  let hovering = false;
  let previewReady = false;
  function stopPreview() {
    hovering = false;
    if (full) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  video.addEventListener("play", () => {
    if (full) videos.forEach((other) => { if (other !== video) other.pause(); });
  });
  async function preview() {
    if (videos.some((other) => other.controls && !other.paused)) return;
    if (card.inert || full || !previewReady || !canPreview.matches || motion.matches || navigator.connection?.saveData) return;
    hovering = true;
    video.muted = true;
    video.loop = true;
    video.src = video.dataset.preview;
    try {
      await video.play();
      if ((!hovering || card.inert) && !full) stopPreview();
    } catch {
      // A blocked preview leaves the poster and manual play button intact.
    }
  }
  card.addEventListener("carouselinactive", () => {
    video.pause();
    stopPreview();
  });
  stage.addEventListener("pointerenter", preview);
  stage.addEventListener("pointerleave", stopPreview);
  button.addEventListener("click", async () => {
    full = true;
    hovering = false;
    video.pause();
    video.src = video.dataset.full;
    video.muted = false;
    video.loop = false;
    video.controls = true;
    button.hidden = true;
    video.focus();
    status.textContent = "";
    try {
      await video.play();
    } catch {
      status.textContent = "Could not play this video. Please try again.";
      full = false;
      video.controls = false;
      button.hidden = false;
      button.focus();
      stopPreview();
    }
  });
  const observer = new IntersectionObserver(([entry]) => {
    previewReady = entry.isIntersecting;
    if (!entry.isIntersecting) {
      video.pause();
      if (!full) stopPreview();
    }
  });
  observer.observe(card);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      video.pause();
      if (!full) stopPreview();
    }
  });
  motion.addEventListener("change", () => { if (motion.matches) stopPreview(); });
}

async function loadFeaturedStats() {
  try {
    const response = await fetch("/api/featured");
    if (!response.ok) return;
    const stats = await response.json();
    for (const [project, text] of Object.entries(stats)) {
      const label = document.querySelector(`[data-stats="${project}"]`);
      if (label && text) {
        label.textContent = text;
        label.hidden = false;
      }
    }
  } catch {
    // Curated cards remain useful when live stats are unavailable.
  }
}
new IntersectionObserver((entries, observer) => {
  if (entries.some((entry) => entry.isIntersecting)) {
    loadFeaturedStats();
    observer.disconnect();
  }
}, { rootMargin: "200px" }).observe(document.querySelector("#projects .project-carousel"));
