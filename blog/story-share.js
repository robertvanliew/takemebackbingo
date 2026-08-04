// Take Me Back Bingo · Blog post "Share to Story" composer.
//
// Composes a 1080x1920 Instagram/Facebook-Story-formatted card on page
// load — cover photo cropped 62% top, dark gradient fade, gold kicker,
// article headline in italic Newsreader serif, brand line, and a URL
// pill burned in as readable text (Instagram Story blocks clickable
// links from third-party apps, so a readable URL is the closest we
// can get — same pattern The Athletic / ESPN / NYT use).
//
// Reads config from data-* attributes on the trigger button — one script
// serves every blog post. Add the share button + this script tag to any
// post and it works.
//
// Required data attributes on the button:
//   id="magShareBtn"
//   data-share-title       Text passed to navigator.share (SMS/DM preview)
//   data-share-text        Description text passed to navigator.share
//   data-share-image       Path to cover image (background of the card)
//   data-share-filename    File name for the downloaded/shared image
//   data-share-headline    Headline burned into the card (2-4 lines max)
//   data-share-kicker      Top-left gold kicker (default: SONG OF THE WEEK)
//   data-share-brand       Brand line below headline (default: TAKE ME BACK BINGO)
//
// The iOS Safari trap: navigator.share() with a file must be called
// SYNCHRONOUSLY inside the click handler. Awaiting anything first kills
// the user activation and iOS throws NotAllowedError. So we pre-compose
// on page load, cache the File, and read the cache on tap — no await.

(function () {
  var btn = document.getElementById('magShareBtn');
  var hint = document.getElementById('magShareHint');
  if (!btn) return;

  var title    = btn.getAttribute('data-share-title')    || document.title;
  var text     = btn.getAttribute('data-share-text')     || title;
  var imgPath  = btn.getAttribute('data-share-image');
  var filename = btn.getAttribute('data-share-filename') || 'take-me-back-bingo.jpg';
  var headline = btn.getAttribute('data-share-headline') || title;
  var kicker   = btn.getAttribute('data-share-kicker')   || 'SONG OF THE WEEK';
  var brand    = btn.getAttribute('data-share-brand')    || 'TAKE ME BACK BINGO';
  var url      = window.location.href;

  // Human-readable URL for the burned-in card. Only the root domain fits
  // legibly in the pill at Story dimensions — the full path was getting
  // clipped when Instagram cropped the image for the preview. Full URL
  // still passes to navigator.share as text so it's clickable on any
  // platform that supports link previews (X, FB feed, WhatsApp, iMessage).
  var displayUrl = 'takemebackbingo.com';

  var storyFile = null;         // fully-composed 1080x1920 story card
  var rawPhotoFile = null;      // raw cover photo as a fallback

  // ------- Compose the 9:16 Story card via Canvas -------
  function composeStoryCard() {
    return new Promise(function (resolve, reject) {
      var W = 1080, H = 1920;
      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');

      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = draw;
      img.onerror = draw; // draw without the photo if load fails
      img.src = imgPath;

      function draw() {
        ctx.fillStyle = '#141111';
        ctx.fillRect(0, 0, W, H);

        // Cover photo — cropped to the top ~62% (rows 0..1180), object-fit:cover
        var photoH = 1180;
        if (img.naturalWidth && img.naturalHeight) {
          var srcRatio = img.naturalWidth / img.naturalHeight;
          var dstRatio = W / photoH;
          var sx = 0, sy = 0, sW = img.naturalWidth, sH = img.naturalHeight;
          if (srcRatio > dstRatio) {
            sW = img.naturalHeight * dstRatio;
            sx = (img.naturalWidth - sW) / 2;
          } else {
            sH = img.naturalWidth / dstRatio;
            sy = (img.naturalHeight - sH) / 2;
          }
          ctx.drawImage(img, sx, sy, sW, sH, 0, 0, W, photoH);
        }

        // Dark gradient fade at the bottom of the photo so overlaid text is legible
        var grad = ctx.createLinearGradient(0, photoH - 260, 0, photoH);
        grad.addColorStop(0, 'rgba(20,17,17,0)');
        grad.addColorStop(1, 'rgba(20,17,17,0.95)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, photoH - 260, W, 260);

        // Gold kicker over the photo (top-left)
        ctx.fillStyle = '#f1c33b';
        ctx.font = 'bold 32px "Bungee", "Impact", system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(spaced(kicker, 4), 64, 64);

        // Underline accent
        ctx.fillRect(64, 118, 80, 4);

        // Article headline — italic Newsreader serif, up to 4 lines
        ctx.fillStyle = '#f6e9c8';
        ctx.font = 'italic 700 82px "Newsreader", Georgia, serif';
        var titleLines = wrapText(ctx, headline, W - 128);
        var titleY = 1260;
        for (var i = 0; i < Math.min(titleLines.length, 4); i++) {
          ctx.fillText(titleLines[i], 64, titleY);
          titleY += 96;
        }

        // Divider
        ctx.strokeStyle = 'rgba(241, 195, 59, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(64, 1670);
        ctx.lineTo(W - 64, 1670);
        ctx.stroke();

        // Brand line
        ctx.fillStyle = '#9d9484';
        ctx.font = '500 28px "Sora", system-ui, sans-serif';
        ctx.fillText(brand, 64, 1710);

        // URL pill (gold bg, dark text)
        ctx.font = 'bold 30px "Sora", system-ui, sans-serif';
        var pillPadX = 28, pillPadY = 16, pillR = 8;
        var textW = ctx.measureText(displayUrl).width;
        var pillW = textW + pillPadX * 2, pillH = 30 + pillPadY * 2;
        var pillX = 64, pillY = 1770;
        roundRect(ctx, pillX, pillY, pillW, pillH, pillR);
        ctx.fillStyle = '#f1c33b';
        ctx.fill();
        ctx.fillStyle = '#1a1408';
        ctx.textBaseline = 'top';
        ctx.fillText(displayUrl, pillX + pillPadX, pillY + pillPadY + 2);

        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
          try {
            var f = new File([blob], filename, { type: 'image/jpeg' });
            resolve(f);
          } catch (e) { reject(e); }
        }, 'image/jpeg', 0.94);
      }
    });
  }

  function wrapText(ctx, s, maxWidth) {
    var words = s.split(/\s+/);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // canvas letterSpacing has spotty support; approximate by padding with spaces
  function spaced(s, gap) {
    return s.split('').join(' '.repeat(gap));
  }

  // Wait for fonts to load so canvas draws in Newsreader + Bungee, not fallback
  var ready = (document.fonts && document.fonts.ready) || Promise.resolve();
  ready.then(composeStoryCard).then(function (file) { storyFile = file; }).catch(function () {});

  // Prefetch raw cover photo as a fallback (canvas fails, CORS issues, etc.)
  if (imgPath && typeof fetch === 'function' && typeof File !== 'undefined') {
    fetch(imgPath)
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (blob) {
        if (!blob) return;
        try { rawPhotoFile = new File([blob], filename, { type: blob.type || 'image/jpeg' }); } catch (e) {}
      })
      .catch(function () {});
  }

  // Adapt hint copy based on file-share capability
  var canShareFiles = navigator.canShare && (function () {
    try { return navigator.canShare({ files: [new File([new Blob()], 't.jpg', { type: 'image/jpeg' })] }); }
    catch (e) { return false; }
  })();
  if (hint) {
    hint.innerHTML = canShareFiles
      ? '<strong>On mobile:</strong> the share card has the headline and link baked in &mdash; ready to post as an Instagram, Facebook, or TikTok Story from your phone&rsquo;s share sheet.'
      : '<strong>To post as a Story:</strong> tap the button to download the share card, then open Instagram / TikTok / Facebook on your phone and add it as a Story.';
  }

  btn.addEventListener('click', function () {
    var fileToShare = storyFile || rawPhotoFile;

    // 1. Best path: native share with the composed story card (mobile)
    if (fileToShare && navigator.canShare && navigator.canShare({ files: [fileToShare] })) {
      try {
        navigator.share({ files: [fileToShare], title: title, text: text + '\n' + url }).catch(function () {});
        return;
      } catch (e) {}
    }
    // 2. Native share without file
    if (navigator.share) {
      try {
        navigator.share({ title: title, text: text, url: url }).catch(function () {});
        return;
      } catch (e) {}
    }
    // 3. Desktop fallback: download the card + copy URL to clipboard
    if (storyFile) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(storyFile);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    } else if (imgPath) {
      var a2 = document.createElement('a');
      a2.href = imgPath;
      a2.download = filename;
      document.body.appendChild(a2);
      a2.click();
      document.body.removeChild(a2);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(function () {});
    }
  });
})();
