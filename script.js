const username = "MR-kartoshki";
const apiEndpoint = "/api/repos";

const projectsGrid = document.getElementById("projectsGrid");
const statusMessage = document.getElementById("statusMessage");
const searchInput = document.getElementById("searchInput");
const languageFilter = document.getElementById("languageFilter");
const hideForksToggle = document.getElementById("hideForksToggle");
const sortSelect = document.getElementById("sortSelect");
const reverseSortToggle = document.getElementById("reverseSortToggle");
const homeGithubLink = document.getElementById("homeGithubLink");
const contactGithubLink = document.getElementById("contactGithubLink");
const contactFormToggle = document.getElementById("contactFormToggle");
const contactFormPanel = document.getElementById("contactFormPanel");
const contactNameInput = document.getElementById("contactName");
const contactForm = document.querySelector(".contact-form");
const contactSubmitButton = document.getElementById("contactSubmitButton");
const contactFormStatus = document.getElementById("contactFormStatus");

const state = {
  repos: [],
  repoLanguages: new Map(),
  hasIncompleteLanguageData: false,
};
const skeletonCardCount = 6;
const maxExpandedLanguageCount = 3;
const messageCooldownMs = 10_000;
const cooldownStorageKey = "contactFormLastSentAt";
const cooldownTickMs = 250;

let contactCooldownIntervalId;
let contactSending = false;

const updatedDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

homeGithubLink.href = `https://github.com/${username}`;
contactGithubLink.href = `https://github.com/${username}`;

if (contactFormToggle && contactFormPanel) {
  contactFormToggle.addEventListener("click", () => {
    const isHidden = contactFormPanel.hasAttribute("hidden");

    if (isHidden) {
      contactFormPanel.removeAttribute("hidden");
      contactFormToggle.setAttribute("aria-expanded", "true");
      contactFormToggle.textContent = "Hide email form";
      contactNameInput?.focus();
      return;
    }

    contactFormPanel.setAttribute("hidden", "");
    contactFormToggle.setAttribute("aria-expanded", "false");
    contactFormToggle.textContent = "Send email";
  });
}

function setContactFormMessage(message, type = "info") {
  if (!contactFormStatus) {
    return;
  }

  contactFormStatus.textContent = message;
  contactFormStatus.classList.remove("contact-form-status--warning");

  if (type === "warning") {
    contactFormStatus.classList.add("contact-form-status--warning");
  }
}

function formatCooldownSeconds(remainingMs) {
  return `${Math.ceil(remainingMs / 1000)}s`;
}

function getRemainingCooldownMs() {
  const lastSentAt = Number(localStorage.getItem(cooldownStorageKey));

  if (!Number.isFinite(lastSentAt) || lastSentAt <= 0) {
    return 0;
  }

  return Math.max(0, messageCooldownMs - (Date.now() - lastSentAt));
}

function triggerSendButtonReaction(reactionClassName) {
  if (!contactSubmitButton) {
    return;
  }

  contactSubmitButton.classList.remove("button--pressed", "button--blocked");
  // Force a reflow so repeated clicks replay the animation.
  void contactSubmitButton.offsetWidth;
  contactSubmitButton.classList.add(reactionClassName);
}

function updateContactSubmitButton(remainingMs) {
  if (!contactSubmitButton) {
    return;
  }

  if (contactSending) {
    contactSubmitButton.disabled = true;
    contactSubmitButton.textContent = "Sending...";
    return;
  }

  if (remainingMs > 0) {
    contactSubmitButton.disabled = true;
    contactSubmitButton.classList.add("button--cooldown");
    contactSubmitButton.textContent = `Wait ${formatCooldownSeconds(remainingMs)}`;
    return;
  }

  contactSubmitButton.disabled = false;
  contactSubmitButton.classList.remove("button--cooldown");
  contactSubmitButton.textContent = "Send message";
}

function startContactCooldown() {
  if (contactCooldownIntervalId) {
    window.clearInterval(contactCooldownIntervalId);
    contactCooldownIntervalId = undefined;
  }

  const startingRemainingMs = getRemainingCooldownMs();
  updateContactSubmitButton(startingRemainingMs);

  if (startingRemainingMs <= 0) {
    return;
  }

  contactCooldownIntervalId = window.setInterval(() => {
    const remainingMs = getRemainingCooldownMs();
    updateContactSubmitButton(remainingMs);

    if (remainingMs <= 0) {
      window.clearInterval(contactCooldownIntervalId);
      contactCooldownIntervalId = undefined;
    }
  }, cooldownTickMs);
}

if (contactForm && contactSubmitButton) {
  startContactCooldown();

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (contactSending) return;
    const remainingMs = getRemainingCooldownMs();

    if (remainingMs > 0) {
      event.preventDefault();
      triggerSendButtonReaction("button--blocked");
      setContactFormMessage(
        `Please wait ${formatCooldownSeconds(remainingMs)} before sending another message.`,
        "warning"
      );
      startContactCooldown();
      return;
    }

    const body = new URLSearchParams(new FormData(contactForm));
    contactSending = true;
    triggerSendButtonReaction("button--pressed");
    setContactFormMessage("Sending your message...");
    updateContactSubmitButton(0);
    try {
      const response = await fetch(contactForm.action, {
        method: "POST",
        headers: { Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Your message could not be sent. Please try again.");
      }
      contactForm.reset();
      localStorage.setItem(cooldownStorageKey, String(Date.now()));
      setContactFormMessage("Your message was sent. Thanks for getting in touch!");
    } catch (error) {
      setContactFormMessage(
        error.name === "TimeoutError" || error instanceof TypeError
          ? "Could not reach the server. Please try again shortly."
          : error.message,
        "warning"
      );
    } finally {
      contactSending = false;
      startContactCooldown();
    }
  });
}

function setStatus(message, type = "info") {
  statusMessage.textContent = message;
  statusMessage.classList.remove("error");
  statusMessage.classList.remove("loading");

  if (type === "error") {
    statusMessage.classList.add("error");
  }

  if (type === "loading") {
    statusMessage.classList.add("loading");
  }
}

function formatUpdatedDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return updatedDateFormatter.format(date);
}

function formatRepoLanguages(repo) {
  const languages = state.repoLanguages.get(repo.id);

  if (!Array.isArray(languages) || languages.length === 0) {
    return repo.language ? repo.language : "Not specified";
  }

  if (languages.length <= maxExpandedLanguageCount) {
    return languages.join(", ");
  }

  const [mainLanguage, ...otherLanguages] = languages;
  return `${mainLanguage} + ${otherLanguages.length} others`;
}

function createProjectCard(repo) {
  const card = document.createElement("article");
  card.className = "project-card";

  const description = repo.description ? repo.description : "No description provided.";
  const languageSummary = formatRepoLanguages(repo);
  const stars = typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0;
  const forks = typeof repo.forks_count === "number" ? repo.forks_count : 0;
  const lastUpdated = formatUpdatedDate(repo.updated_at);

  const title = document.createElement("h3");
  title.className = "project-title";
  title.textContent = repo.name;

  const descriptionText = document.createElement("p");
  descriptionText.textContent = description;

  const meta = document.createElement("p");
  meta.className = "project-meta";
  meta.textContent = `Language: ${languageSummary}`;

  const stats = document.createElement("div");
  stats.className = "project-stats";
  const statsLine = document.createElement("p");
  statsLine.className = "project-stats-line";
  statsLine.textContent = `Stars: ${stars} · Forks: ${forks}`;

  const updatedLine = document.createElement("p");
  updatedLine.className = "project-updated";
  updatedLine.textContent = `Updated: ${lastUpdated}`;
  stats.append(statsLine, updatedLine);

  const link = document.createElement("a");
  link.className = "button";
  link.href = repo.html_url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View repository";

  card.append(title, descriptionText, meta, stats, link);

  return card;
}

function createSkeletonCard() {
  const card = document.createElement("article");
  card.className = "project-card project-card--skeleton";
  card.setAttribute("aria-hidden", "true");

  const title = document.createElement("div");
  title.className = "skeleton-line skeleton-title";

  const description = document.createElement("div");
  description.className = "skeleton-line skeleton-description";

  const shortDescription = document.createElement("div");
  shortDescription.className = "skeleton-line skeleton-description short";

  const spacer = document.createElement("div");
  spacer.className = "skeleton-spacer";

  const meta = document.createElement("div");
  meta.className = "skeleton-line skeleton-meta";

  const stats = document.createElement("div");
  stats.className = "project-stats";

  const statsLine = document.createElement("div");
  statsLine.className = "skeleton-line skeleton-stats-line";

  const updatedLine = document.createElement("div");
  updatedLine.className = "skeleton-line skeleton-updated-line";
  stats.append(statsLine, updatedLine);

  const button = document.createElement("div");
  button.className = "skeleton-line skeleton-button";

  card.append(title, description, shortDescription, spacer, meta, stats, button);
  return card;
}

function renderLoadingSkeletons(count = skeletonCardCount) {
  projectsGrid.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < count; index += 1) {
    fragment.append(createSkeletonCard());
  }

  projectsGrid.append(fragment);
}

function updateLanguageFilterOptions(repos) {
  const languages = Array.from(
    new Set(repos.map((repo) => repo.language).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const currentValue = languageFilter.value;
  languageFilter.innerHTML = '<option value="all">All languages</option>';

  for (const language of languages) {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    languageFilter.append(option);
  }

  if (languages.includes(currentValue)) {
    languageFilter.value = currentValue;
  }
}

function getFilteredRepos() {
  const searchTerm = searchInput.value.trim().toLowerCase();
  const selectedLanguage = languageFilter.value;
  const hideForks = hideForksToggle.checked;

  return state.repos.filter((repo) => {
    if (hideForks && repo.fork) {
      return false;
    }

    if (selectedLanguage !== "all" && repo.language !== selectedLanguage) {
      return false;
    }

    if (searchTerm && !repo.name.toLowerCase().includes(searchTerm)) {
      return false;
    }

    return true;
  });
}

function getSortValue(repo, sortKey) {
  switch (sortKey) {
    case "created":
      return Date.parse(repo.created_at ?? repo.updated_at) || 0;
    case "stars":
      return typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0;
    case "forks":
      return typeof repo.forks_count === "number" ? repo.forks_count : 0;
    case "pushed":
    default:
      return Date.parse(repo.pushed_at ?? repo.updated_at) || 0;
  }
}

function getSortedRepos(repos) {
  const sortKey = sortSelect ? sortSelect.value : "pushed";
  const reverse = reverseSortToggle ? reverseSortToggle.checked : false;
  const direction = reverse ? 1 : -1;
  const nameTiebreak = reverse ? 1 : -1;

  return [...repos].sort((a, b) => {
    const av = getSortValue(a, sortKey);
    const bv = getSortValue(b, sortKey);
    if (av !== bv) {
      return (av < bv ? -1 : 1) * direction;
    }
    return a.name.localeCompare(b.name) * nameTiebreak;
  });
}

function renderProjects() {
  projectsGrid.innerHTML = "";
  const filteredRepos = getSortedRepos(getFilteredRepos());

  if (filteredRepos.length === 0) {
    setStatus("No repositories match the current filters.");
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const repo of filteredRepos) {
    fragment.append(createProjectCard(repo));
  }

  projectsGrid.append(fragment);
  const languageWarning = state.hasIncompleteLanguageData
    ? " Some language details are unavailable."
    : "";
  setStatus(`Showing ${filteredRepos.length} repositories.${languageWarning}`);
  syncPageScrollbar();
}

function sortReposByUpdatedDate(repos) {
  return repos.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

async function fetchRepositoriesFromApi() {
  const response = await fetch(apiEndpoint, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Repository API returned status ${response.status}.`);
  }

  const payload = await response.json();

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Unexpected API payload.");
  }

  if (!Array.isArray(payload.repos)) {
    throw new Error("Unexpected API repositories payload.");
  }

  const repoLanguages = new Map();

  if (
    payload.repo_languages &&
    typeof payload.repo_languages === "object" &&
    !Array.isArray(payload.repo_languages)
  ) {
    for (const [repoId, languages] of Object.entries(payload.repo_languages)) {
      const numericRepoId = Number(repoId);

      if (Number.isNaN(numericRepoId) || !Array.isArray(languages)) {
        continue;
      }

      repoLanguages.set(
        numericRepoId,
        languages.filter((language) => typeof language === "string")
      );
    }
  }

  return {
    repos: sortReposByUpdatedDate(payload.repos),
    repoLanguages,
    hasIncompleteLanguageData: Boolean(payload.has_incomplete_language_data),
  };
}

function applyRepositories(data) {
  state.repos = data.repos;
  state.repoLanguages = data.repoLanguages;
  state.hasIncompleteLanguageData = data.hasIncompleteLanguageData;
  updateLanguageFilterOptions(state.repos);
  renderProjects();
}

async function fetchRepositories() {
  setStatus("Loading repositories...", "loading");
  renderLoadingSkeletons();

  try {
    applyRepositories(await fetchRepositoriesFromApi());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    setStatus(`Failed to load repositories: ${message}`, "error");
  }
}

searchInput.addEventListener("input", renderProjects);
languageFilter.addEventListener("change", renderProjects);
hideForksToggle.addEventListener("change", renderProjects);
sortSelect?.addEventListener("change", renderProjects);
reverseSortToggle?.addEventListener("change", renderProjects);

fetchRepositories();

// Custom page scrollbar (adapted from Jhey's rounded SVG scrollbar demo)
// -------------------------------------------------------------
const pageScrollbar = document.querySelector(".page-scrollbar");
const pageScrollbarTrack = pageScrollbar?.querySelector(".page-scrollbar__track");
const pageScrollbarThumb = pageScrollbar?.querySelector(".page-scrollbar__thumb");

const PAGE_SCROLLBAR = {
  radius: 32,
  stroke: 7,
  inset: 4,
  thumb: 80,
  finish: 5,
  scrollPadding: 100,
  trail: 0,
  cornerLength: 0,
  trackLength: 0,
};

function readScrollbarCssVars() {
  const cs = getComputedStyle(document.documentElement);
  const num = (name, fallback) => {
    const raw = cs.getPropertyValue(name).trim();
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  PAGE_SCROLLBAR.radius = num("--page-scrollbar-radius", PAGE_SCROLLBAR.radius);
  PAGE_SCROLLBAR.stroke = num("--page-scrollbar-stroke", PAGE_SCROLLBAR.stroke);
  PAGE_SCROLLBAR.inset = num("--page-scrollbar-inset", PAGE_SCROLLBAR.inset);
  PAGE_SCROLLBAR.thumb = num("--page-scrollbar-thumb", PAGE_SCROLLBAR.thumb);
  PAGE_SCROLLBAR.finish = num("--page-scrollbar-finish", PAGE_SCROLLBAR.finish);
  PAGE_SCROLLBAR.scrollPadding = num("--page-scrollbar-scroll-padding", PAGE_SCROLLBAR.scrollPadding);
  PAGE_SCROLLBAR.trail = num("--page-scrollbar-trail", PAGE_SCROLLBAR.trail);
}

function scrollbarGeometry() {
  const c = PAGE_SCROLLBAR;
  const innerRad = Math.max(0, c.radius - (c.inset + c.stroke * 0.5));
  const padTop = c.inset + c.stroke * 0.5;
  const padLeft = c.radius * 2 - padTop;
  return { mid: c.radius, innerRad, padTop, padLeft, trail: c.trail };
}

function buildScrollbarTopPath() {
  const { mid, innerRad, padTop, padLeft, trail } = scrollbarGeometry();
  const topCorner = innerRad === 0
    ? `L${padLeft},${padTop}`
    : `a${innerRad},${innerRad} 0 0 1 ${innerRad} ${innerRad}`;
  return `M${mid - trail},${padTop}
    ${innerRad === 0 ? "" : `L${mid},${padTop}`}
    ${topCorner}`;
}

function buildScrollbarPath(height) {
  const { mid, innerRad, padTop, padLeft, trail } = scrollbarGeometry();

  const topCorner = innerRad === 0
    ? `L${padLeft},${padTop}`
    : `a${innerRad},${innerRad} 0 0 1 ${innerRad} ${innerRad}`;

  const bottomStraight = `L${padLeft},${height - (padTop + innerRad)}`;

  const bottomCorner = innerRad === 0
    ? `L${padLeft},${height - padTop}`
    : `a${innerRad},${innerRad} 0 0 1 ${-innerRad} ${innerRad}`;

  return `M${mid - trail},${padTop}
    ${innerRad === 0 ? "" : `L${mid},${padTop}`}
    ${topCorner}
    ${bottomStraight}
    ${bottomCorner}
    L${mid - trail},${height - padTop}`;
}

function syncPageScrollbar() {
  if (!pageScrollbar || !pageScrollbarTrack || !pageScrollbarThumb) return;

  readScrollbarCssVars();

  const top = document.querySelector(".site-header").getBoundingClientRect().height;
  const height = Math.max(PAGE_SCROLLBAR.radius * 2, window.innerHeight - top);
  pageScrollbar.style.top = `${top}px`;
  pageScrollbar.style.height = `${height}px`;
  pageScrollbar.setAttribute("viewBox", `0 0 ${PAGE_SCROLLBAR.radius * 2} ${height}`);
  pageScrollbar.style.setProperty("--stroke-width", PAGE_SCROLLBAR.stroke);

  const d = buildScrollbarPath(height);
  pageScrollbarTrack.setAttribute("d", d);
  pageScrollbarThumb.setAttribute("d", d);

  const trackLength = pageScrollbarTrack.getTotalLength();
  PAGE_SCROLLBAR.trackLength = Math.floor(trackLength);

  pageScrollbarThumb.setAttribute("d", buildScrollbarTopPath());
  PAGE_SCROLLBAR.cornerLength = Math.ceil(pageScrollbarThumb.getTotalLength());

  pageScrollbarThumb.setAttribute("d", d);

  document.documentElement.style.setProperty("--page-scrollbar-thumb-size", PAGE_SCROLLBAR.thumb);
  document.documentElement.style.setProperty("--page-scrollbar-track-length", Math.ceil(trackLength));

  const scrollable = getScrollableAmount();
  document.documentElement.toggleAttribute("data-page-scrollbar", scrollable > 0);

  updatePageScrollbarThumb();
}

function getScrollableAmount() {
  return Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight);
}

let scrollbarOverscroll = 0;
let scrollbarOverscrollTarget = 0;
let scrollbarLastInput = 0;
const scrollbarReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const pageContent = document.querySelector("main");

function bouncePageScrollbar(event) {
  if (scrollbarReducedMotion.matches || event.ctrlKey || event.deltaY === 0) return;
  const scrollable = getScrollableAmount();
  if (scrollable <= 0) return;
  const atEdge = (window.scrollY <= 1 && event.deltaY < 0)
    || (window.scrollY >= scrollable - 1 && event.deltaY > 0);
  if (!atEdge) return;
  // Native scroll stays clamped; translate content to show the elastic range.
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  const limit = PAGE_SCROLLBAR.scrollPadding;
  scrollbarOverscrollTarget = Math.max(-limit, Math.min(limit, scrollbarOverscrollTarget + event.deltaY * unit * 0.4));
  scrollbarLastInput = performance.now();
}

function updatePageScrollbarThumb() {
  if (!pageScrollbarThumb) return;

  const scrollable = getScrollableAmount();
  if (scrollable <= 0) {
    document.documentElement.style.setProperty("--page-scrollbar-offset", 0);
    return;
  }

  const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
  if ((scrollbarOverscroll < 0 && scrollTop > 1)
    || (scrollbarOverscroll > 0 && scrollTop < scrollable - 1)
    || scrollbarReducedMotion.matches) {
    scrollbarOverscroll = scrollbarOverscrollTarget = 0;
  }
  if (pageContent) {
    pageContent.style.translate = scrollbarOverscroll === 0
      ? ""
      : `0 ${-scrollbarOverscroll * 0.65}px`;
  }
  const progress = Math.min(1, Math.max(0, scrollTop / scrollable));

  const { thumb, finish, cornerLength, trackLength, scrollPadding } = PAGE_SCROLLBAR;

  const start = -cornerLength;
  const end = -(trackLength - cornerLength - thumb);
  let offset = start + (end - start) * progress;
  const extension = Math.min(1, Math.abs(scrollbarOverscroll) / scrollPadding);
  if (scrollbarOverscroll < 0 && scrollTop <= 1) {
    offset += (thumb - finish - start) * extension;
  } else if (scrollbarOverscroll > 0 && scrollTop >= scrollable - 1) {
    offset += (-(trackLength - finish) - end) * extension;
  }

  document.documentElement.style.setProperty("--page-scrollbar-offset", offset);
}

let scrollbarResizeFrame;
function schedulePageScrollbarResize() {
  if (scrollbarResizeFrame) cancelAnimationFrame(scrollbarResizeFrame);
  scrollbarResizeFrame = requestAnimationFrame(() => {
    scrollbarResizeFrame = 0;
    syncPageScrollbar();
  });
}

if (pageScrollbar) {
  syncPageScrollbar();
  window.addEventListener("scroll", updatePageScrollbarThumb, { passive: true });
  window.addEventListener("wheel", bouncePageScrollbar, { passive: true });
  window.addEventListener("resize", schedulePageScrollbarResize);
  const bodyObserver = new ResizeObserver(schedulePageScrollbarResize);
  bodyObserver.observe(document.body);
  bodyObserver.observe(document.querySelector(".site-header"));
}

const lenis = typeof Lenis === "function" ? new Lenis({
  autoRaf: false,
  autoToggle: true,
  anchors: true,
  allowNestedScroll: true,
  naiveDimensions: true,
  stopInertiaOnNavigate: true,
}) : null;

let lastScrollFrame = 0;
function animatePageScroll(now) {
  lenis?.raf(now);
  const dt = lastScrollFrame ? Math.min((now - lastScrollFrame) / 1000, 0.05) : 0;
  lastScrollFrame = now;
  if (now - scrollbarLastInput > 100) scrollbarOverscrollTarget = 0;
  if (scrollbarReducedMotion.matches || document.hidden) {
    scrollbarOverscroll = scrollbarOverscrollTarget = 0;
  }
  if (scrollbarOverscroll !== 0 || scrollbarOverscrollTarget !== 0) {
    // Pull and release share Lenis's frame clock, including the thumb movement.
    scrollbarOverscroll += (scrollbarOverscrollTarget - scrollbarOverscroll) * (1 - Math.exp(-dt * 12));
    if (scrollbarOverscrollTarget === 0 && Math.abs(scrollbarOverscroll) < 0.1) scrollbarOverscroll = 0;
    updatePageScrollbarThumb();
  } else if (pageContent?.style.translate) {
    updatePageScrollbarThumb();
  }
  requestAnimationFrame(animatePageScroll);
}
requestAnimationFrame(animatePageScroll);
