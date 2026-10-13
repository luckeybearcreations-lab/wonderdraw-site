(function () {
  var config = window.WONDERDRAW || { packages: {} };
  var packages = config.packages || {};

  document.querySelectorAll("[data-price]").forEach(function (el) {
    var item = packages[el.getAttribute("data-price")];
    if (item && item.price) {
      el.textContent = item.price;
      el.classList.add("is-set");
    }
  });

  document.querySelectorAll("[data-buy]").forEach(function (el) {
    var item = packages[el.getAttribute("data-buy")];
    if (item && /^https:\/\/(buy|checkout)\.stripe\.com\//.test(item.link)) el.href = item.link;
  });

  if (config.contactEmail) {
    document.querySelectorAll("[data-email]").forEach(function (el) {
      el.href = "mailto:" + config.contactEmail;
      el.textContent = config.contactEmail;
    });
  }

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  var form = document.querySelector("[data-contact-form]");
  if (!form) return;
  var params = new URLSearchParams(location.search);
  var topic = params.get("topic");
  if (topic && form.topic.querySelector('option[value="' + topic + '"]')) form.topic.value = topic;
  var names = { spark: "Spark Sketch", reveal: "Magic Reveal", bundle: "Big Imagination Bundle", club: "Little Artist Club" };
  var wanted = names[params.get("package")];
  if (wanted && !form.message.value) form.message.value = "I'd like to order the " + wanted + ".";

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var label = form.topic.options[form.topic.selectedIndex].text;
    var subject = "WonderDraw: " + label + (form.order.value ? " (" + form.order.value + ")" : "");
    var body = form.message.value + "\n\n" + form.name.value;
    location.href = "mailto:" + (config.contactEmail || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  });
})();
