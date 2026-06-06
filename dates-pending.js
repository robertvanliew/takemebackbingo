/* =============================================================
 * DATES-PENDING TOGGLE - single source of truth.
 *
 * The public event calendar is intentionally down right now while
 * the client finalizes dates. While that's true, every primary
 * "Buy Tickets" CTA on the site is repointed to the footer
 * newsletter form so users can subscribe to the date drop instead
 * of dead-ending on an empty events page.
 *
 * HOW TO TURN THE CALENDAR BACK ON (single change):
 *   1. Set TMB_DATES_PENDING below to false.
 *   2. That's it. On the next deploy, every CTA marked
 *      data-cta-when-live="buy" reverts to its long-term state
 *      (href = data-href-live, text = data-text-live) - i.e.
 *      "Buy Tickets" → events.html - and the newsletter focus
 *      behavior turns off.
 *
 *   You don't need to touch the HTML. The "Buy Tickets" + URL
 *   values are stashed on each CTA in those two data-* attributes.
 *
 * AFFECTED ELEMENTS:
 *   - .nav__cta on every page (5 pages)
 *   - The hero "Buy Tickets" strip on index, events, gallery
 *
 * Loaded with <script src="/dates-pending.js" defer></script> on
 * each page so it runs after the DOM is parsed.
 * ============================================================= */
(function () {
  // ===== TOGGLE =====
  var TMB_DATES_PENDING = false;
  // ==================

  if (!TMB_DATES_PENDING) {
    // Calendar is live again: restore each CTA to its long-term state.
    var ctas = document.querySelectorAll('[data-cta-when-live="buy"]');
    for (var i = 0; i < ctas.length; i++) {
      var el = ctas[i];
      var liveHref = el.getAttribute('data-href-live');
      var liveText = el.getAttribute('data-text-live');
      if (liveHref) el.setAttribute('href', liveHref);
      if (liveText) el.textContent = liveText;
    }
    return;
  }

  // --- Dates pending: focus the email input when the user lands on #newsletter
  // either by clicking a CTA or by arriving with the hash already set
  // (e.g. cross-page jump from play.html or legal.html).
  var newsletterForm = document.getElementById('newsletter');
  if (!newsletterForm) return; // play.html and legal.html: cross-page anchor
                               // handles itself via the URL hash on the
                               // destination page.
  var emailInput = newsletterForm.querySelector('input[type="email"]');
  if (!emailInput) return;

  function focusEmail() {
    try { emailInput.focus({ preventScroll: true }); }
    catch (e) { emailInput.focus(); }
  }

  // Click on any in-page CTA: wait for smooth-scroll to settle, then focus.
  var inPageCtas = document.querySelectorAll('a[data-cta-when-live="buy"][href="#newsletter"]');
  for (var j = 0; j < inPageCtas.length; j++) {
    inPageCtas[j].addEventListener('click', function () {
      setTimeout(focusEmail, 450);
    });
  }

  // Arrived with #newsletter already in the URL (e.g. coming from play.html).
  if (window.location.hash === '#newsletter') {
    setTimeout(focusEmail, 250);
  }
  window.addEventListener('hashchange', function () {
    if (window.location.hash === '#newsletter') focusEmail();
  });
})();
