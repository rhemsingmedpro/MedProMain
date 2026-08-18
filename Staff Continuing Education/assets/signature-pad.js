/**
 * Minimal canvas-based signature pad, shared by staff-app (employee
 * signature at submission) and admin-app (manager signature at signoff).
 * No dependency — mouse + touch drawing on a <canvas>.
 *
 * Usage: var pad = createSignaturePad(canvasEl); pad.clear(); pad.isEmpty();
 * pad.toDataURL() -> "data:image/png;base64,...."
 *
 * The canvas's `width`/`height` attributes (not its CSS size) set the
 * drawing resolution — keep them consistent everywhere a signature is
 * captured so images come out at the same aspect ratio wherever they're
 * later embedded (the CE report PDF).
 */
function createSignaturePad(canvas) {
  var ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1D2B3A';

  function fillWhite() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  fillWhite();

  var drawing = false;
  var hasInk = false;
  var last = null;

  function pos(e) {
    var rect = canvas.getBoundingClientRect();
    var t = e.touches && e.touches[0];
    var clientX = t ? t.clientX : e.clientX;
    var clientY = t ? t.clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    last = pos(e);
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    var p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    hasInk = true;
  }
  function end() { drawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  return {
    clear: function () { fillWhite(); hasInk = false; },
    isEmpty: function () { return !hasInk; },
    toDataURL: function () { return canvas.toDataURL('image/png'); }
  };
}
