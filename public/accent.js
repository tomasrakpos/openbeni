/**
 * Accent theme chooser — runs before React renders so the first paint already
 * carries the visit's accent (no colour flash).
 *
 * One "visit" = a fresh tab/window (or after the browser was closed): the
 * choice lives in sessionStorage for the whole visit and flips between
 * "ember" and "violet" against the last recorded visit in localStorage.
 * ?accent=ember|violet forces a theme for this visit only (dev help) and
 * never touches the stored "last" value.
 */
(function () {
  var SESSION_KEY = "oh-accent";
  var LAST_KEY = "oh-accent-last";

  function sessionGet() {
    try {
      return window.sessionStorage.getItem(SESSION_KEY);
    } catch (error) {
      return null;
    }
  }
  function sessionSet(value) {
    try {
      window.sessionStorage.setItem(SESSION_KEY, value);
    } catch (error) {
      /* private mode: the in-memory default still applies */
    }
  }
  function lastGet() {
    try {
      return window.localStorage.getItem(LAST_KEY);
    } catch (error) {
      return null;
    }
  }
  function lastSet(value) {
    try {
      window.localStorage.setItem(LAST_KEY, value);
    } catch (error) {
      /* nothing sensitive is stored, just the theme name */
    }
  }

  function valid(value) {
    return value === "ember" || value === "violet" ? value : null;
  }

  var accent = valid(sessionGet());
  var forced = false;
  if (!accent) {
    try {
      accent = valid(new URLSearchParams(window.location.search).get("accent"));
      forced = Boolean(accent);
    } catch (error) {
      accent = null;
    }
  }
  if (!accent) {
    // Opposite of the previous visit; nothing stored yet → ember.
    accent = lastGet() === "ember" ? "violet" : "ember";
  }

  sessionSet(accent);
  if (!forced) lastSet(accent);

  document.documentElement.setAttribute("data-accent", accent);
})();
