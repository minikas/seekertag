const dialog = document.querySelector("#download-dialog");

const SUPPORTED_LANGUAGES = ["pt", "en", "es"];
const STORAGE_KEY = "seekertag-language";
const HTML_LANG = { pt: "pt-BR", en: "en", es: "es" };
const SCREEN_SRC = {
  pt: "/app-screen-pt.png",
  en: "/app-screen-en.png",
  es: "/app-screen-es.png",
};

const normalizeLanguage = (language) =>
  SUPPORTED_LANGUAGES.includes(language) ? language : "pt";

async function loadResources() {
  const entries = await Promise.all(
    SUPPORTED_LANGUAGES.map(async (lng) => {
      const response = await fetch(`/locales/${lng}.json`);
      if (!response.ok) throw new Error(`Cannot load locale ${lng}`);
      return [lng, { translation: await response.json() }];
    }),
  );
  return Object.fromEntries(entries);
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = i18next.t(element.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    element.innerHTML = i18next.t(element.getAttribute("data-i18n-html"));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute(
      "aria-label",
      i18next.t(element.getAttribute("data-i18n-aria")),
    );
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
    element.setAttribute(
      "alt",
      i18next.t(element.getAttribute("data-i18n-alt")),
    );
  });
  document.querySelectorAll("[data-i18n-content]").forEach((element) => {
    element.setAttribute(
      "content",
      i18next.t(element.getAttribute("data-i18n-content")),
    );
  });
  const screen = document.querySelector(".app-screen");
  if (screen) {
    const src = SCREEN_SRC[i18next.language] || SCREEN_SRC.pt;
    if (screen.getAttribute("src") !== src) screen.setAttribute("src", src);
  }
}

async function setLanguage(language) {
  const lng = normalizeLanguage(language);
  await i18next.changeLanguage(lng);
  document.documentElement.lang = HTML_LANG[lng];
  document.querySelector("#language-select").value = lng;
  applyTranslations();
  localStorage.setItem(STORAGE_KEY, lng);
}

const languageSelect = document.querySelector("#language-select");
languageSelect.addEventListener("change", (event) => {
  setLanguage(event.target.value).catch(() => {});
});

(async () => {
  try {
    const resources = await loadResources();
    const initial = normalizeLanguage(
      localStorage.getItem(STORAGE_KEY) || "pt",
    );
    await i18next.init({ lng: initial, fallbackLng: "pt", resources });
    document.documentElement.lang = HTML_LANG[initial];
    languageSelect.value = initial;
    applyTranslations();
    localStorage.setItem(STORAGE_KEY, initial);
  } catch {
    // Sem os JSONs de locale, mantém o conteúdo estático em português.
  }
})();

document
  .querySelectorAll("[data-download]")
  .forEach((button) =>
    button.addEventListener("click", () => dialog.showModal()),
  );
document
  .querySelector(".close-dialog")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  const box = dialog.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    dialog.close();
});
document.querySelector("#year").textContent = new Date().getFullYear();
