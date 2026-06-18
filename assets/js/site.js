const DATA_URL = "assets/data/site-data.json?v=20260617-16";
const TRANSLATIONS_URL = "assets/data/translations.json?v=20260617-1";
const THEME_KEY = "syed-tahir-theme";
const LANGUAGE_KEY = "syed-tahir-language";

let baseData = null;
let siteData = null;
let translationData = null;
let sectionObserver = null;
let interactionsBound = false;
const state = {
  publicationCategory: "all",
  publicationQuery: "",
  publicationSort: "newest",
  publicationYear: "all",
  publicationAwardedOnly: false,
  theme: document.documentElement.dataset.theme || "light",
  language: "en"
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function createLink(item, className) {
  const link = document.createElement("a");
  const rawHref = item.href || item.url;
  link.href = rawHref;
  link.textContent = item.label || item.title;
  if (className) link.className = className;
  if (item.external !== false && /^https?:\/\//i.test(rawHref)) {
    link.target = "_blank";
    link.rel = "noopener";
  }
  return link;
}

function setText(selector, text) {
  const element = $(selector);
  if (element) element.textContent = text || "";
}

function savedLanguage() {
  try {
    return localStorage.getItem(LANGUAGE_KEY) || "";
  } catch (error) {
    return "";
  }
}

function requestedLanguage() {
  return new URLSearchParams(window.location.search).get("lang") || "";
}

function availableLanguages() {
  return translationData?.languages?.length ? translationData.languages : [{ code: "en", short: "EN", label: "English", dir: "ltr" }];
}

function currentLanguageMeta() {
  return availableLanguages().find((language) => language.code === state.language) || availableLanguages()[0];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  }
  return value;
}

function mergeArray(baseArray, overrideArray) {
  if (!baseArray.every(isPlainObject) || !overrideArray.every(isPlainObject)) {
    return cloneValue(overrideArray);
  }

  return baseArray.map((item, index) => (
    overrideArray[index] ? deepMerge(item, overrideArray[index]) : cloneValue(item)
  ));
}

function deepMerge(base, override) {
  if (Array.isArray(base) && Array.isArray(override)) return mergeArray(base, override);
  if (!isPlainObject(base) || !isPlainObject(override)) return cloneValue(override ?? base);

  const merged = cloneValue(base);
  Object.entries(override).forEach(([key, value]) => {
    if (key in merged) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = cloneValue(value);
    }
  });
  return merged;
}

function localizedData() {
  const content = translationData?.content?.[state.language];
  return content ? deepMerge(baseData, content) : cloneValue(baseData);
}

function uiText(key, fallback) {
  return translationData?.ui?.[state.language]?.[key]
    || translationData?.ui?.en?.[key]
    || fallback
    || "";
}

function applyLanguageMetadata() {
  const language = currentLanguageMeta();
  document.documentElement.lang = language.code;
  document.documentElement.dir = language.dir || "ltr";
  document.body.classList.toggle("is-rtl", language.dir === "rtl");
}

function derivedDoi(item) {
  if (item.doi) return item.doi;
  const match = String(item.url || "").match(/10\.\d{4,9}\/\S+/i);
  return match ? match[0].replace(/[.)\]]$/, "") : "";
}

function isAwardedPublication(item) {
  return item.statusType === "award" || /award/i.test(`${item.status || ""} ${item.note || ""}`);
}

function appendIcon(parent, iconClass) {
  if (!iconClass) return null;
  const icon = document.createElement("i");
  icon.className = iconClass;
  icon.setAttribute("aria-hidden", "true");
  parent.appendChild(icon);
  return icon;
}

function createButtonLink(item, extraClass = "") {
  const link = createLink(item, `btn ${extraClass}`.trim());
  link.textContent = "";
  appendIcon(link, item.icon);
  link.append(document.createTextNode(item.label));
  return link;
}

function setIconText(element, iconClass, text) {
  element.innerHTML = "";
  appendIcon(element, iconClass);
  element.append(document.createTextNode(text));
}

function updateThemeToggle() {
  const toggle = $("#theme-toggle");
  if (!toggle) return;

  const isDark = state.theme === "dark";
  toggle.setAttribute("aria-label", isDark ? uiText("switchToLight", "Switch to light mode") : uiText("switchToDark", "Switch to dark mode"));
  toggle.setAttribute("aria-pressed", String(isDark));
  toggle.innerHTML = "";
  appendIcon(toggle, isDark ? "fas fa-sun" : "fas fa-moon");
  toggle.appendChild(document.createTextNode(isDark ? uiText("themeLight", "Light") : uiText("themeDark", "Dark")));
}

function applyTheme(theme, persist = false) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = state.theme === "dark" ? "#020617" : "#0f172a";

  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, state.theme);
    } catch (error) {
      console.warn("Theme preference could not be saved.", error);
    }
  }

  updateThemeToggle();
}

function createThemeToggle() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle";
  button.id = "theme-toggle";
  button.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark", true);
  });
  return button;
}

function createLanguageSelector() {
  const wrapper = document.createElement("label");
  const label = createElement("span", "sr-only", uiText("languageLabel", "Language"));
  const select = document.createElement("select");

  wrapper.className = "language-select";
  select.id = "language-select";
  select.setAttribute("aria-label", uiText("languageLabel", "Language"));

  availableLanguages().forEach((language) => {
    const option = document.createElement("option");
    option.value = language.code;
    option.textContent = language.short;
    option.label = `${language.short} - ${language.label}`;
    select.appendChild(option);
  });

  select.value = state.language;
  select.addEventListener("change", () => {
    setLanguage(select.value, true);
  });

  wrapper.append(label, select);
  return wrapper;
}

function setLanguage(languageCode, persist = false) {
  const exists = availableLanguages().some((language) => language.code === languageCode);
  state.language = exists ? languageCode : translationData?.defaultLanguage || "en";

  if (persist) {
    try {
      localStorage.setItem(LANGUAGE_KEY, state.language);
    } catch (error) {
      console.warn("Language preference could not be saved.", error);
    }
  }

  renderSite();
}

function highlightName(text) {
  const fragment = document.createDocumentFragment();
  const name = siteData.site.name;
  const parts = String(text).split(name);

  parts.forEach((part, index) => {
    if (part) fragment.append(document.createTextNode(part));
    if (index < parts.length - 1) {
      const strong = document.createElement("strong");
      strong.textContent = name;
      fragment.append(strong);
    }
  });

  return fragment;
}

function renderNavigation() {
  const navLinks = $("#nav-links");
  navLinks.innerHTML = "";
  setText("[data-brand]", siteData.site.name);

  siteData.navigation.forEach((item) => {
    const link = createLink({ ...item, external: false });
    navLinks.appendChild(link);
  });

  navLinks.appendChild(createLanguageSelector());
  navLinks.appendChild(createThemeToggle());
  navLinks.appendChild(createButtonLink(siteData.cvLink));
  updateThemeToggle();
}

function renderHero() {
  const hero = siteData.hero;
  const background = $("#hero-bg");
  const actions = $("#hero-actions");

  background.innerHTML = "";
  hero.images.forEach((image, index) => {
    const img = document.createElement("img");
    img.src = image.src;
    img.alt = image.alt;
    img.decoding = "async";
    img.loading = index === 0 ? "eager" : "lazy";
    if (index === 0) img.classList.add("active");
    background.appendChild(img);
  });

  setText("#hero-subtitle", hero.subtitle);
  setText("#hero-title", hero.title);
  setText("#hero-summary", hero.summary);

  actions.innerHTML = "";
  hero.actions.forEach((action, index) => {
    actions.appendChild(createButtonLink(action, index === 0 ? "btn-ghost" : ""));
  });
}

function renderBio() {
  const bio = siteData.bio;
  const imageHolder = $("#bio-image");
  const copy = $("#bio-copy");
  const img = document.createElement("img");

  img.src = bio.image.src;
  img.alt = bio.image.alt;
  img.loading = "lazy";
  img.decoding = "async";

  imageHolder.innerHTML = "";
  imageHolder.appendChild(img);

  setText("#bio-title", bio.title);
  copy.innerHTML = "";
  bio.paragraphs.forEach((paragraph) => {
    copy.appendChild(createElement("p", null, paragraph));
  });
}

function renderTimeline(selector, items, animation = "fade-right") {
  const timeline = $(selector);
  timeline.innerHTML = "";

  items.forEach((item, index) => {
    const entry = createElement("div", "timeline-item");
    entry.dataset.aos = animation;
    if (index > 2 && selector === "#education-timeline") entry.classList.add("timeline-spaced");

    entry.appendChild(createElement("span", "timeline-date", item.date));
    entry.appendChild(createElement("h3", null, item.title));
    entry.appendChild(createElement("h4", null, item.organization));
    if (item.description) entry.appendChild(createElement("p", null, item.description));
    timeline.appendChild(entry);
  });
}

function renderResearch() {
  setText("#research-title", siteData.research.title);
  const grid = $("#research-grid");
  grid.innerHTML = "";

  siteData.research.items.forEach((item, index) => {
    const card = createElement("article", "research-card");
    card.dataset.aos = "zoom-in";
    card.dataset.aosDelay = String((index + 1) * 100);
    appendIcon(card, item.icon);
    card.appendChild(createElement("h3", null, item.title));
    card.appendChild(createElement("p", null, item.description));
    grid.appendChild(card);
  });
}

function renderLanguages() {
  setText("#languages-title", siteData.languages.title);
  const table = $("#languages-table");
  table.innerHTML = "";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  siteData.languages.columns.forEach((column) => headRow.appendChild(createElement("th", null, column)));
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  siteData.languages.rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    row.forEach((cell, index) => {
      const td = document.createElement("td");
      if (index === 0) {
        const strong = document.createElement("strong");
        strong.textContent = cell.primary;
        td.appendChild(strong);
        if (cell.note) td.append(document.createTextNode(` (${cell.note})`));
      } else {
        td.textContent = cell;
      }
      tableRow.appendChild(td);
    });
    tbody.appendChild(tableRow);
  });

  table.append(thead, tbody);
}

function certificateType(file) {
  if (!file) return "none";
  return /\.pdf($|\?)/i.test(file) ? "pdf" : "image";
}

function findCertificate(id) {
  if (!id || !siteData?.certificates?.items) return null;
  return siteData.certificates.items.find((item) => item.id === id) || null;
}

function openCertificateModal(item) {
  const modal = $("#certificate-modal");
  const title = $("#certificate-modal-title");
  const body = $("#certificate-modal-body");
  const fullLink = $("#certificate-modal-link");
  const verifyLink = $("#certificate-modal-verify");
  const type = certificateType(item.file);

  title.textContent = item.title;
  body.innerHTML = "";
  fullLink.href = item.file;
  setIconText(fullLink, "fas fa-external-link-alt", uiText("openFullCertificate", "Open Full Certificate"));

  if (type === "pdf") {
    const frame = document.createElement("iframe");
    frame.src = item.file;
    frame.title = item.title;
    body.appendChild(frame);
  } else {
    const image = document.createElement("img");
    image.src = item.file;
    image.alt = item.title;
    image.decoding = "async";
    body.appendChild(image);
  }

  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  if (item.verifyUrl) {
    verifyLink.href = item.verifyUrl;
    setIconText(verifyLink, "fas fa-check-circle", item.verifyLabel || uiText("verifyOnline", "Verify Online"));
    verifyLink.style.display = "inline-flex";
  } else {
    verifyLink.removeAttribute("href");
    verifyLink.style.display = "none";
  }
  document.body.classList.add("modal-open");
}

function closeCertificateModal() {
  const modal = $("#certificate-modal");
  const body = $("#certificate-modal-body");
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
  body.innerHTML = "";
  document.body.classList.remove("modal-open");
}

function revealCertificates(options = {}) {
  const section = $("#certificates");
  if (!section) return;

  document.body.classList.add("certificate-view");
  section.classList.remove("is-hidden");
  section.setAttribute("aria-hidden", "false");

  if (options.updateHash) {
    history.pushState(null, "", "#certificates");
  }

  if (window.AOS) {
    window.AOS.refreshHard();
  }

  window.setTimeout(() => {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 30);
}

function hideCertificates() {
  const section = $("#certificates");
  if (!section) return;

  document.body.classList.remove("certificate-view");
  section.classList.add("is-hidden");
  section.setAttribute("aria-hidden", "true");
}

function renderCertificates() {
  const certificates = siteData.certificates;
  const grid = $("#certificate-grid");

  setText("#certificates-title", certificates.title);
  setText("#certificates-subtitle", certificates.subtitle);
  grid.innerHTML = "";

  if (!certificates.items.length) {
    grid.appendChild(createElement("p", "empty-state", certificates.emptyMessage));
    return;
  }

  certificates.items.forEach((item) => {
    const card = createElement("article", "certificate-card");
    const preview = createElement("div", "certificate-preview");
    const meta = createElement("div", "certificate-meta");
    const actions = createElement("div", "certificate-actions");
    const button = document.createElement("button");

    if (item.thumbnail) {
      const image = document.createElement("img");
      image.src = item.thumbnail;
      image.alt = item.title;
      image.loading = "lazy";
      image.decoding = "async";
      preview.appendChild(image);
    } else {
      appendIcon(preview, certificateType(item.file) === "pdf" ? "fas fa-file-pdf" : "fas fa-certificate");
    }

    meta.appendChild(createElement("h3", null, item.title));
    if (item.issuer) meta.appendChild(createElement("p", "certificate-issuer", item.issuer));
    if (item.date) meta.appendChild(createElement("span", "certificate-date", item.date));
    if (item.description) meta.appendChild(createElement("p", null, item.description));

    button.type = "button";
    button.className = "btn";
    button.appendChild(document.createTextNode(item.file ? (item.buttonLabel || "View Certificate") : "Certificate Pending"));
    button.disabled = !item.file;
    if (item.file) {
      button.addEventListener("click", () => openCertificateModal(item));
    }
    actions.appendChild(button);

    if (item.verifyUrl) {
      actions.appendChild(createButtonLink({
        label: item.verifyLabel || "Verify Online",
        href: item.verifyUrl,
        icon: "fas fa-check-circle"
      }, "btn-accent"));
    }

    card.append(preview, meta, actions);
    grid.appendChild(card);
  });
}

function categoryCounts() {
  return siteData.publications.items.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    counts.all += 1;
    return counts;
  }, { all: 0 });
}

function publicationYears() {
  return [...new Set(siteData.publications.items.map((item) => Number(item.year)).filter(Boolean))]
    .sort((first, second) => second - first);
}

function bindPublicationControls() {
  const search = $("#publication-search");
  const sort = $("#publication-sort");
  const year = $("#publication-year");
  const awarded = $("#publication-awarded");
  const searchLabel = $(".publication-search .sr-only");
  const yearLabel = $(".publication-filter span");
  const sortLabel = $(".publication-sort span");
  const awardedLabel = $(".publication-awarded span");
  const sortLabels = {
    newest: uiText("sortNewest", "Newest first"),
    oldest: uiText("sortOldest", "Oldest first"),
    title: uiText("sortTitle", "Title A-Z"),
    award: uiText("sortAward", "Award first")
  };

  if (search) {
    search.value = state.publicationQuery;
    search.placeholder = uiText("publicationSearchPlaceholder", "Search publications, authors, DOI");
    if (searchLabel) searchLabel.textContent = uiText("publicationSearchLabel", "Search publications");
    search.oninput = () => {
      state.publicationQuery = search.value.trim().toLowerCase();
      renderPublications();
    };
  }

  if (sort) {
    [...sort.options].forEach((option) => {
      option.textContent = sortLabels[option.value] || option.textContent;
    });
    sort.value = state.publicationSort;
    if (sortLabel) sortLabel.textContent = uiText("sort", "Sort");
    sort.onchange = () => {
      state.publicationSort = sort.value;
      renderPublications();
    };
  }

  if (year) {
    year.innerHTML = "";
    year.appendChild(new Option(uiText("allYears", "All years"), "all"));
    publicationYears().forEach((value) => {
      year.appendChild(new Option(String(value), String(value)));
    });
    year.value = state.publicationYear;
    if (yearLabel) yearLabel.textContent = uiText("year", "Year");
    year.onchange = () => {
      state.publicationYear = year.value;
      renderPublications();
    };
  }

  if (awarded) {
    awarded.checked = state.publicationAwardedOnly;
    if (awardedLabel) awardedLabel.textContent = uiText("awardedOnly", "Awarded only");
    awarded.onchange = () => {
      state.publicationAwardedOnly = awarded.checked;
      renderPublications();
    };
  }
}

function renderPublicationTabs() {
  const tabs = $("#publication-tabs");
  const counts = categoryCounts();
  tabs.innerHTML = "";

  siteData.publications.categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab-btn";
    button.dataset.category = category.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(category.id === state.publicationCategory));
    button.textContent = `${category.label} (${counts[category.id] || 0})`;
    if (category.id === state.publicationCategory) button.classList.add("active");
    button.addEventListener("click", () => {
      state.publicationCategory = category.id;
      renderPublications();
    });
    tabs.appendChild(button);
  });
}

function publicationMatches(item) {
  const categoryMatch = state.publicationCategory === "all" || item.category === state.publicationCategory;
  if (!categoryMatch) return false;

  if (state.publicationYear !== "all" && String(item.year) !== state.publicationYear) return false;
  if (state.publicationAwardedOnly && !isAwardedPublication(item)) return false;

  if (!state.publicationQuery) return true;

  const searchable = [
    item.title,
    item.venue,
    item.authors,
    item.status,
    item.note,
    item.year,
    item.category,
    derivedDoi(item)
  ].join(" ").toLowerCase();

  return searchable.includes(state.publicationQuery);
}

function sortPublications(items) {
  const sorted = [...items];
  sorted.sort((first, second) => {
    if (state.publicationSort === "title") {
      return String(first.title || "").localeCompare(String(second.title || ""));
    }

    if (state.publicationSort === "award") {
      const firstAward = isAwardedPublication(first);
      const secondAward = isAwardedPublication(second);
      if (firstAward !== secondAward) return firstAward ? -1 : 1;
    }

    const firstYear = Number(first.year || 0);
    const secondYear = Number(second.year || 0);
    if (state.publicationSort === "oldest") {
      return firstYear - secondYear || String(first.title || "").localeCompare(String(second.title || ""));
    }
    return secondYear - firstYear || String(first.title || "").localeCompare(String(second.title || ""));
  });
  return sorted;
}

function sanitizeBibValue(value) {
  return String(value || "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bibAuthors(authors) {
  return sanitizeBibValue(authors)
    .replace(/\.$/, "")
    .split(/\s*,\s*/)
    .filter(Boolean)
    .join(" and ");
}

function citationKey(item) {
  const firstAuthor = sanitizeBibValue(item.authors)
    .split(",")[0]
    .replace(/\./g, "")
    .trim()
    .split(/\s+/)
    .pop() || "publication";
  const firstWord = sanitizeBibValue(item.title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .find((word) => word.length > 3) || "work";

  return `${firstAuthor.toLowerCase()}${item.year || ""}${firstWord}`.replace(/[^a-z0-9]/g, "");
}

function createBibTeX(item) {
  const doi = derivedDoi(item);
  const type = item.category === "conference" ? "inproceedings" : "article";
  const venueField = item.category === "conference" ? "booktitle" : "journal";
  const fields = [
    ["title", sanitizeBibValue(item.title)],
    ["author", bibAuthors(item.authors)],
    ["year", item.year || ""],
    [venueField, sanitizeBibValue(item.venue)]
  ];

  if (doi) fields.push(["doi", doi]);
  if (item.url) fields.push(["url", item.url]);
  if (item.note) fields.push(["note", sanitizeBibValue(item.note)]);

  const body = fields
    .filter(([, value]) => value)
    .map(([key, value]) => `  ${key} = {${value}}`)
    .join(",\n");

  return `@${type}{${citationKey(item)},\n${body}\n}`;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function setTemporaryButtonLabel(button, label, iconClass) {
  const original = button.dataset.originalLabel;
  const originalIcon = button.dataset.originalIcon;
  button.innerHTML = "";
  appendIcon(button, iconClass);
  button.appendChild(document.createTextNode(label));

  window.setTimeout(() => {
    button.innerHTML = "";
    appendIcon(button, originalIcon);
    button.appendChild(document.createTextNode(original));
  }, 1500);
}

function createPubActionButton(label, iconClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pub-action";
  button.dataset.originalLabel = label;
  button.dataset.originalIcon = iconClass;
  appendIcon(button, iconClass);
  button.appendChild(document.createTextNode(label));
  return button;
}

function downloadBibTeX(item) {
  const blob = new Blob([createBibTeX(item)], { type: "application/x-bibtex;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const fileName = citationKey(item) || "citation";
  link.href = url;
  link.download = `${fileName}.bib`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function publicationLinkLabel(item) {
  return item.linkLabel && item.linkLabel !== "Read Article"
    ? item.linkLabel
    : uiText("readArticle", "Read Article");
}

function createPublicationItem(item) {
  const article = createElement("article", "pub-item");
  article.dataset.category = item.category;
  const awarded = isAwardedPublication(item);
  if (awarded) article.classList.add("is-awarded");

  if (item.status) {
    article.appendChild(createElement("span", `status-badge status-${item.statusType}`, item.status));
  }

  if (awarded && item.statusType !== "award") {
    article.appendChild(createElement("span", "status-badge status-award", uiText("awarded", "Awarded")));
  }

  const title = item.url
    ? createLink({ href: item.url, label: item.title }, "pub-title")
    : createElement("span", "pub-title", item.title);
  article.appendChild(title);
  article.appendChild(createElement("span", "pub-meta", item.venue));

  const authors = createElement("p", "pub-authors");
  authors.appendChild(highlightName(item.authors));
  article.appendChild(authors);

  const doi = derivedDoi(item);
  if (doi) {
    const doiLink = createLink({ href: `https://doi.org/${doi}`, label: doi }, "pub-doi-badge");
    doiLink.textContent = "";
    doiLink.appendChild(createElement("span", null, "DOI"));
    doiLink.appendChild(document.createTextNode(doi));
    article.appendChild(doiLink);
  }

  if (item.note) {
    const note = createElement("p", "pub-note");
    if (item.certificateId) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pub-note-link";
      button.textContent = item.note;
      button.addEventListener("click", () => {
        const certificate = findCertificate(item.certificateId);
        if (certificate) openCertificateModal(certificate);
      });
      note.appendChild(button);
    } else {
      const emphasis = document.createElement("em");
      emphasis.textContent = item.note;
      note.appendChild(emphasis);
    }
    article.appendChild(note);
  }

  const actions = createElement("div", "pub-actions");

  if (item.url) {
    const link = createLink({ href: item.url, label: publicationLinkLabel(item) }, "pub-action pub-link");
    link.textContent = "";
    appendIcon(link, "fas fa-external-link-alt");
    link.append(document.createTextNode(publicationLinkLabel(item)));
    actions.appendChild(link);
  }

  const copyButton = createPubActionButton(uiText("copyBibtex", "Copy BibTeX"), "fas fa-copy");
  copyButton.addEventListener("click", async () => {
    try {
      await copyText(createBibTeX(item));
      setTemporaryButtonLabel(copyButton, uiText("copied", "Copied"), "fas fa-check");
    } catch (error) {
      console.error(error);
      setTemporaryButtonLabel(copyButton, uiText("copyFailed", "Copy failed"), "fas fa-exclamation-triangle");
    }
  });
  actions.appendChild(copyButton);

  const downloadButton = createPubActionButton(uiText("downloadBib", "Download .bib"), "fas fa-download");
  downloadButton.addEventListener("click", () => downloadBibTeX(item));
  actions.appendChild(downloadButton);

  article.appendChild(actions);

  return article;
}

function renderPublications() {
  renderPublicationTabs();
  const list = $("#publication-list");
  const matches = sortPublications(siteData.publications.items.filter(publicationMatches));
  list.innerHTML = "";

  if (!matches.length) {
    list.appendChild(createElement("p", "empty-state", uiText("noPublicationMatches", "No publications match the selected filters.")));
    return;
  }

  matches.forEach((item) => list.appendChild(createPublicationItem(item)));
}

function renderSoftware() {
  const software = siteData.software;
  const showcase = $("#software-showcase");
  const info = createElement("div", "software-info");
  const frame = createElement("div", "slideshow-frame");

  setText("#software-title", software.title);
  setText("#projects-title", software.projectsTitle);

  info.dataset.aos = "fade-right";
  info.appendChild(createElement("span", "badge", software.featured.badge));
  info.appendChild(createElement("h3", null, software.featured.title));
  info.appendChild(createElement("p", null, software.featured.description));

  const features = createElement("ul", "feature-list");
  software.featured.features.forEach((feature) => {
    const li = document.createElement("li");
    appendIcon(li, "fas fa-check-circle");
    li.append(document.createTextNode(feature));
    features.appendChild(li);
  });
  info.appendChild(features);
  info.appendChild(createButtonLink(software.featured.cta));

  frame.dataset.aos = "fade-left";
  software.featured.images.forEach((image, index) => {
    const img = document.createElement("img");
    img.src = image.src;
    img.alt = image.alt;
    img.loading = "lazy";
    img.decoding = "async";
    if (index === 0) img.classList.add("active");
    frame.appendChild(img);
  });

  showcase.innerHTML = "";
  showcase.append(info, frame);

  const projectGrid = $("#project-grid");
  projectGrid.innerHTML = "";
  software.projects.forEach((project) => {
    const card = createElement("article", "project-card");
    card.appendChild(createElement("h3", null, project.title));
    card.appendChild(createElement("p", "project-role", project.role));
    card.appendChild(createElement("p", "pub-meta", project.meta));
    projectGrid.appendChild(card);
  });
}

function renderContact() {
  const contact = siteData.contact;
  const grid = $("#contact-grid");
  const profileLinks = $("#profile-links");
  const socials = $("#footer-socials");

  setText("#contact-title", contact.title);
  setText("#contact-subtitle", contact.subtitle);
  grid.innerHTML = "";

  contact.cards.forEach((card) => {
    const wrapper = card.href ? createLink({ href: card.href, label: "" }, "contact-card") : createElement("div", "contact-card");
    appendIcon(wrapper, card.icon);
    wrapper.appendChild(createElement("h3", null, card.title));
    const text = createElement("p");
    card.lines.forEach((line, index) => {
      if (index > 0) text.appendChild(document.createElement("br"));
      text.append(document.createTextNode(line));
    });
    wrapper.appendChild(text);
    grid.appendChild(wrapper);
  });

  profileLinks.innerHTML = "";
  contact.profileLinks.forEach((item) => {
    const link = createButtonLink(item);
    if (item.color) {
      link.style.background = item.color;
      link.style.borderColor = item.color;
    }
    profileLinks.appendChild(link);
  });

  setText(
    "#footer-copy",
    `${uiText("copyrightPrefix", "Copyright")} ${new Date().getFullYear()} ${siteData.site.name}. ${uiText("copyrightSuffix", "All Rights Reserved.")}`
  );
  socials.innerHTML = "";
  contact.socials.forEach((item) => {
    const link = createLink({ href: item.href, label: item.label }, null);
    link.textContent = "";
    link.setAttribute("aria-label", item.label);
    appendIcon(link, item.icon);
    socials.appendChild(link);
  });
}

function startSlideshow(container, interval = 5000) {
  const images = $$("img", container);
  if (images.length < 2) return;
  let currentIndex = 0;

  window.setInterval(() => {
    images[currentIndex].classList.remove("active");
    currentIndex = (currentIndex + 1) % images.length;
    images[currentIndex].classList.add("active");
  }, interval);
}

function bindInteractions() {
  if (interactionsBound) return;
  interactionsBound = true;

  const nav = $("#navbar");
  const navLinks = $("#nav-links");
  const toggle = $("#mobile-toggle");
  const certificateModal = $("#certificate-modal");
  const certificateClose = $("#certificate-modal-close");

  window.addEventListener("scroll", () => {
    nav.classList.toggle("scrolled", window.scrollY > 50);
  });

  toggle.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("active");
    toggle.setAttribute("aria-expanded", String(isOpen));
    $("i", toggle).className = isOpen ? "fas fa-times" : "fas fa-bars";
  });

  navLinks.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      navLinks.classList.remove("active");
      toggle.setAttribute("aria-expanded", "false");
      $("i", toggle).className = "fas fa-bars";
    }
  });

  document.addEventListener("click", (event) => {
    const internalLink = event.target.closest("a[href^='#']");
    if (!internalLink) return;

    if (internalLink.getAttribute("href") === "#certificates") {
      event.preventDefault();
      revealCertificates({ updateHash: true });
      return;
    }

    hideCertificates();
  });

  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#certificates") {
      revealCertificates();
    } else {
      hideCertificates();
    }
  });

  certificateClose.addEventListener("click", closeCertificateModal);
  certificateModal.addEventListener("click", (event) => {
    if (event.target === certificateModal) closeCertificateModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && certificateModal.classList.contains("active")) {
      closeCertificateModal();
    }
  });
}

function observeSections() {
  if (sectionObserver) sectionObserver.disconnect();

  const links = $$("#nav-links a[href^='#']");
  const sections = links
    .map((link) => $(link.getAttribute("href")))
    .filter(Boolean);

  sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
      });
    });
  }, { rootMargin: "-42% 0px -52% 0px", threshold: 0 });

  sections.forEach((section) => sectionObserver.observe(section));
}

function renderSite() {
  siteData = localizedData();
  applyLanguageMetadata();
  applyTheme(state.theme);
  document.title = siteData.site.pageTitle;
  const certificateClose = $("#certificate-modal-close");
  if (certificateClose) certificateClose.setAttribute("aria-label", uiText("closeCertificate", "Close certificate"));
  renderNavigation();
  renderHero();
  renderBio();
  setText("#education-title", siteData.education.title);
  renderTimeline("#education-timeline", siteData.education.items);
  renderCertificates();
  renderResearch();
  renderLanguages();
  setText("#publications-title", siteData.publications.title);
  setText("#publications-updated", siteData.publications.lastUpdated);
  bindPublicationControls();
  renderPublications();
  renderSoftware();
  setText("#service-title", siteData.service.title);
  renderTimeline("#service-timeline", siteData.service.items, "fade-left");
  renderContact();
  bindInteractions();
  observeSections();
  startSlideshow($("#hero-bg"), 6000);
  startSlideshow($(".slideshow-frame"), 4000);

  if (window.AOS) {
    window.AOS.init({
      duration: 900,
      easing: "ease-out-cubic",
      once: true,
      offset: 50
    });
  }

  if (window.location.hash === "#certificates") {
    revealCertificates();
  }
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}

Promise.all([loadJson(DATA_URL), loadJson(TRANSLATIONS_URL)])
  .then(([data, translations]) => {
    baseData = data;
    translationData = translations;
    const preferredLanguage = requestedLanguage() || savedLanguage() || translationData.defaultLanguage || "en";
    state.language = availableLanguages().some((language) => language.code === preferredLanguage)
      ? preferredLanguage
      : translationData.defaultLanguage || "en";
    renderSite();
  })
  .catch((error) => {
    console.error(error);
    $("#app").innerHTML = `
      <section class="load-error">
        <h2>${uiText("loadErrorTitle", "Content could not be loaded")}</h2>
        <p>${uiText("loadErrorText", "Run the site through a local server or GitHub Pages so the JSON content file can be fetched.")}</p>
      </section>
    `;
  });
