// /thanks?session_id=... : shows the drawing upload form for a paid Stripe order.
// Without a session id (or if the order can't be found) the email instructions stay visible.
(function () {
  var box = document.querySelector("[data-upload]");
  if (!box) return;
  var id = new URLSearchParams(location.search).get("session_id");
  if (!id) return;
  var fallback = document.querySelector("[data-fallback]");
  var done = document.querySelector("[data-upload-done]");
  var form = box.querySelector("[data-upload-form]");
  var error = box.querySelector("[data-error]");

  fetch("/api/session?session_id=" + encodeURIComponent(id))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (info) {
      if (!info || !info.ok) return;
      fallback.hidden = true;
      if (info.uploaded) { done.hidden = false; return; }
      box.querySelector("[data-package]").textContent = info.package;
      if (info.key === "bundle") box.querySelector("[data-scene]").hidden = false;
      box.hidden = false;
    })
    .catch(function () {});

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    error.hidden = true;
    var button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "Uploading...";
    var data = new FormData(form);
    data.append("session_id", id);
    fetch("/api/order", { method: "POST", body: data })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || "Upload failed. Please try again.");
        box.hidden = true;
        done.hidden = false;
      })
      .catch(function (err) {
        error.textContent = err.message;
        error.hidden = false;
        button.disabled = false;
        button.textContent = "Send my drawing";
      });
  });
})();
