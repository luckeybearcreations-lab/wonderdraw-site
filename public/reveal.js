// Before/after slider on proof and final pages, plus "Download reveal video"
// (records a short canvas animation in the browser, no server work needed).
(function () {
  var box = document.querySelector("[data-reveal]");
  if (!box) return;
  var slider = box.querySelector("input[type=range]");
  var before = box.querySelector(".reveal-before");
  function set(v) { before.style.clipPath = "inset(0 " + (100 - v) + "% 0 0)"; }
  slider.addEventListener("input", function () { set(slider.value); });
  set(slider.value);

  var button = document.querySelector("[data-record]");
  if (!button) return;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { button.hidden = true; return; }
  var imgs = box.querySelectorAll("img");
  var artImg = imgs[0], drawImg = imgs[1];

  button.addEventListener("click", function () {
    button.disabled = true;
    button.textContent = "Making your video...";
    var w = Math.min(artImg.naturalWidth || 1080, 1080);
    var h = Math.round(w * (artImg.naturalHeight || w) / (artImg.naturalWidth || w));
    var canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d");
    var type = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find(function (t) { return MediaRecorder.isTypeSupported(t); });
    var rec = new MediaRecorder(canvas.captureStream(30), type ? { mimeType: type } : undefined);
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var blob = new Blob(chunks, { type: rec.mimeType });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "wonderdraw-reveal." + (rec.mimeType.indexOf("mp4") > -1 ? "mp4" : "webm");
      a.click();
      button.disabled = false;
      button.textContent = "Download reveal video";
    };
    var total = 6000, start = performance.now();
    function frame(now) {
      var t = Math.min((now - start) / total, 1);
      // hold the drawing, sweep to the art, hold the art
      var p = t < 0.25 ? 0 : t > 0.75 ? 1 : (t - 0.25) / 0.5;
      p = p * p * (3 - 2 * p);
      ctx.drawImage(artImg, 0, 0, w, h);
      var edge = w * p;
      ctx.save();
      ctx.beginPath(); ctx.rect(edge, 0, w - edge, h); ctx.clip();
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
      fit(ctx, drawImg, w, h);
      ctx.restore();
      if (p > 0 && p < 1) { ctx.fillStyle = "#fff"; ctx.fillRect(edge - 3, 0, 6, h); }
      if (t < 1) requestAnimationFrame(frame); else setTimeout(function () { rec.stop(); }, 200);
    }
    rec.start();
    requestAnimationFrame(frame);
  });

  function fit(ctx, img, w, h) {
    var r = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    var dw = img.naturalWidth * r, dh = img.naturalHeight * r;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
})();
