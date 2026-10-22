/* Ustawia motyw jeszcze przed pierwszym rysowaniem strony, żeby nie było błysku jasnego tła. */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('utarg.settings.v1') || '{}');
    if (s.theme === 'light' || s.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', s.theme);
    }
  } catch (e) { /* motyw automatyczny */ }
})();
