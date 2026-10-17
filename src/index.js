// WonderDraw order automation.
// Static pages come from ./public (env.ASSETS). This Worker adds the order flow:
//   Stripe checkout -> /thanks upload -> Replicate makes the art -> Gus approves by email
//   -> customer gets a private proof -> customer approves -> final files.
// Orders live in KV (ORDERS), images in R2 (FILES), email goes out through EMAIL.

// Only checkouts from WonderDraw's own Stripe Payment Links can upload a drawing.
// (The Stripe account also sells Lucky Bear Tap, Fluid Pour, etc.)
export const PACKAGES = {
  plink_1UQjJNK5pTjjyr2KnCmamdKW: { key: "spark", name: "Spark Sketch", revisions: 0 },
  plink_1UQjJdK5pTjjyr2KFGhdcSj5: { key: "reveal", name: "Magic Reveal", revisions: 1 },
  plink_1UQjJyK5pTjjyr2K3FfN76N4: { key: "bundle", name: "Big Imagination Bundle", revisions: 2 },
  plink_1UQjKHK5pTjjyr2K9yrToT17: { key: "club", name: "Little Artist Club", revisions: 1 },
};

export const STYLES = {
  storybook: "a vibrant, high-quality children's storybook illustration with soft lighting, rich textures and gentle depth",
  watercolor: "a soft, luminous watercolor painting with delicate washes and paper texture",
  cartoon3d: "a polished 3D animated-film style render with soft shadows and friendly, rounded shapes",
  papercut: "a layered paper-cutout collage with crisp edges, soft drop shadows and bright craft-paper colors",
};

const MAX_UPLOAD = 15 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/api/order" && request.method === "POST") return await createOrder(request, env, ctx);
      if (path === "/api/session" && request.method === "GET") return await sessionInfo(url, env);
      if (path === "/api/replicate" && request.method === "POST") return await replicateDone(request, url, env);
      if (path.startsWith("/media/")) return await media(url, env);
      if (path === "/admin/approve") return await adminApprove(url, env);
      if (path === "/admin/redo") return await adminRedo(request, url, env);
      if (path.startsWith("/proof/")) return await proof(request, url, env);
      if (path.startsWith("/final/")) return await finalPage(url, env);
    } catch (err) {
      console.error(err);
      return page("Something went wrong", `<p>Sorry, something went wrong on our side. Please try again, or <a href="/contact?topic=existing-order">contact us</a>.</p>`, 500);
    }
    return env.ASSETS.fetch(request);
  },
};

// ---------- Stripe ----------

async function stripeSession(env, sessionId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId || "")) return null;
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) return null;
  const s = await res.json();
  const paid = s.payment_status === "paid" || (s.mode === "subscription" && s.status === "complete");
  const pkg = PACKAGES[s.payment_link];
  if (!paid || !pkg) return null;
  return {
    id: s.id,
    email: s.customer_details?.email || s.customer_email || "",
    name: s.customer_details?.name || "",
    pkg,
  };
}

async function sessionInfo(url, env) {
  const s = await stripeSession(env, url.searchParams.get("session_id"));
  if (!s) return json({ ok: false }, 404);
  const existing = await env.ORDERS.get(`session:${s.id}`);
  return json({ ok: true, package: s.pkg.name, key: s.pkg.key, uploaded: Boolean(existing), styles: Object.keys(STYLES) });
}

// ---------- Upload ----------

async function createOrder(request, env, ctx) {
  const form = await request.formData();
  const s = await stripeSession(env, String(form.get("session_id") || ""));
  if (!s) return json({ ok: false, error: "We couldn't find a paid order for this link." }, 400);
  if (await env.ORDERS.get(`session:${s.id}`)) return json({ ok: false, error: "We already have the drawing for this order." }, 409);

  const photo = form.get("photo");
  if (!photo || typeof photo === "string") return json({ ok: false, error: "Please add a photo of the drawing." }, 400);
  if (photo.size > MAX_UPLOAD) return json({ ok: false, error: "That photo is too large (15 MB max)." }, 400);
  if (photo.type && !IMAGE_TYPES.includes(photo.type)) return json({ ok: false, error: "Please upload a JPG, PNG, WEBP or HEIC photo." }, 400);
  if (form.get("consent") !== "yes") return json({ ok: false, error: "Please confirm you're the child's parent or guardian." }, 400);

  const style = STYLES[form.get("style")] ? String(form.get("style")) : "storybook";
  const order = {
    id: randomId(),
    session: s.id,
    email: s.email,
    name: s.name,
    pkg: s.pkg,
    style,
    story: clean(form.get("story"), 600),
    scene: s.pkg.key === "bundle" ? clean(form.get("scene"), 300) : "",
    status: "generating",
    round: 0,
    revisionsUsed: 0,
    notes: [],
    created: new Date().toISOString(),
  };
  await env.FILES.put(`orders/${order.id}/drawing`, photo.stream(), { httpMetadata: { contentType: photo.type || "image/jpeg" } });
  await env.ORDERS.put(`session:${s.id}`, order.id);
  await saveOrder(env, order);
  ctx.waitUntil(startArt(env, order));
  return json({ ok: true, order: order.id });
}

// ---------- Replicate ----------

export function buildPrompt(order, note) {
  let p = `Transform this child's drawing into ${STYLES[order.style] || STYLES.storybook}. ` +
    "Keep the same composition, characters, shapes, poses and color choices as the original drawing so the child instantly recognizes their own picture. " +
    "Make it look finished and magical, but stay true to the drawing. Family-friendly. No text, letters or watermarks.";
  if (order.story) p += ` What the drawing shows, in the family's words: ${order.story}`;
  if (order.scene) p += ` Place it in this background scene: ${order.scene}`;
  if (note) p += ` Changes requested: ${note}`;
  return p;
}

async function startArt(env, order, note = "") {
  const drawingUrl = `${env.SITE_URL}/media/${order.id}/drawing?t=${await sign(env, "media", order.id)}`;
  const hook = `${env.SITE_URL}/api/replicate?order=${order.id}&t=${await sign(env, "hook", order.id)}`;
  const res = await fetch(`https://api.replicate.com/v1/models/${env.REPLICATE_MODEL}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { prompt: buildPrompt(order, note), input_image: drawingUrl, aspect_ratio: "match_input_image", output_format: "png" },
      webhook: hook,
      webhook_events_filter: ["completed"],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    order.status = "error";
    await saveOrder(env, order);
    await sendEmail(env, env.ADMIN_EMAIL, `WonderDraw: art failed to start (${order.id})`,
      `Replicate refused the job for order ${order.id} (${order.email}).\n\n${detail.slice(0, 500)}\n\nReply to the customer by hand or try Redo: ${await adminLink(env, "redo", order.id)}`);
  }
}

async function replicateDone(request, url, env) {
  const id = url.searchParams.get("order");
  if (!(await verify(env, "hook", id, url.searchParams.get("t")))) return new Response("forbidden", { status: 403 });
  const order = await loadOrder(env, id);
  if (!order) return new Response("gone", { status: 410 });
  const pred = await request.json();
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (pred.status !== "succeeded" || !out) {
    order.status = "error";
    await saveOrder(env, order);
    await sendEmail(env, env.ADMIN_EMAIL, `WonderDraw: art failed (${order.id})`,
      `The AI couldn't make art for order ${order.id} (${order.email}): ${pred.error || pred.status}.\n\nTry again: ${await adminLink(env, "redo", order.id)}`);
    return new Response("ok");
  }
  const img = await fetch(out);
  order.round += 1;
  await env.FILES.put(`orders/${order.id}/art-${order.round}`, img.body, { httpMetadata: { contentType: img.headers.get("content-type") || "image/png" } });
  order.status = "review";
  await saveOrder(env, order);

  const t = await sign(env, "media", order.id);
  const drawing = `${env.SITE_URL}/media/${order.id}/drawing?t=${t}`;
  const art = `${env.SITE_URL}/media/${order.id}/art-${order.round}?t=${t}`;
  const approve = await adminLink(env, "approve", order.id);
  const redo = await adminLink(env, "redo", order.id);
  const last = order.notes[order.notes.length - 1];
  await sendEmail(env, env.ADMIN_EMAIL, `WonderDraw: approve art for ${order.name || order.email} (${order.pkg.name})`,
    `New art is ready for review.\n\nCustomer: ${order.name} <${order.email}>\nPackage: ${order.pkg.name}\nStyle: ${order.style}\nStory: ${order.story || "-"}\n${last ? `Latest change request: ${last}\n` : ""}\nDrawing: ${drawing}\nArt: ${art}\n\nApprove and send the proof: ${approve}\nRedo it: ${redo}`,
    `<p>New art is ready for review.</p><p><b>${esc(order.name)}</b> &lt;${esc(order.email)}&gt;<br>${esc(order.pkg.name)} · ${esc(order.style)}<br>Story: ${esc(order.story || "-")}${last ? `<br>Latest change request: ${esc(last)}` : ""}</p>
     <table><tr><td><img src="${drawing}" width="260" alt="Original drawing"></td><td><img src="${art}" width="260" alt="New art"></td></tr></table>
     <p><a href="${approve}" style="background:#5b3fd6;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Approve &amp; send proof</a>
     &nbsp; <a href="${redo}">Redo it</a></p>`);
  return new Response("ok");
}

// ---------- Gus (admin) ----------

async function adminLink(env, action, id) {
  return `${env.SITE_URL}/admin/${action}?order=${id}&t=${await sign(env, `admin-${action}`, id)}`;
}

async function adminApprove(url, env) {
  const id = url.searchParams.get("order");
  if (!(await verify(env, "admin-approve", id, url.searchParams.get("t")))) return page("Link expired", "<p>This link isn't valid.</p>", 403);
  const order = await loadOrder(env, id);
  if (!order) return page("Not found", "<p>That order doesn't exist.</p>", 404);
  if (order.status !== "review") return page("Already handled", `<p>This order is already <b>${esc(order.status)}</b>.</p>`);
  order.status = "proof";
  await saveOrder(env, order);
  const link = `${env.SITE_URL}/proof/${order.id}?t=${await sign(env, "customer", order.id)}`;
  await sendEmail(env, order.email, "Your WonderDraw proof is ready!",
    `Hi${order.name ? " " + order.name.split(" ")[0] : ""},\n\nYour child's WonderDraw proof is ready. See the before-and-after reveal here:\n${link}\n\nIf you love it, click Approve on that page and we'll send your final files.${order.pkg.revisions - order.revisionsUsed > 0 ? " You can also ask for changes there." : ""}\n\nThanks,\nGus at WonderDraw`,
    `<p>Hi${order.name ? " " + esc(order.name.split(" ")[0]) : ""},</p><p>Your child's WonderDraw proof is ready!</p><p><a href="${link}" style="background:#5b3fd6;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">See the reveal</a></p><p>If you love it, click Approve on that page and we'll send your final files.</p><p>Thanks,<br>Gus at WonderDraw</p>`);
  return page("Proof sent", `<p>Sent the proof to <b>${esc(order.email)}</b>.</p>`);
}

async function adminRedo(request, url, env) {
  const id = url.searchParams.get("order");
  const t = url.searchParams.get("t");
  if (!(await verify(env, "admin-redo", id, t))) return page("Link expired", "<p>This link isn't valid.</p>", 403);
  const order = await loadOrder(env, id);
  if (!order) return page("Not found", "<p>That order doesn't exist.</p>", 404);
  if (request.method === "POST") {
    const form = await request.formData();
    const note = clean(form.get("note"), 400);
    if (STYLES[form.get("style")]) order.style = String(form.get("style"));
    order.status = "generating";
    await saveOrder(env, order);
    await startArt(env, order, note || order.notes[order.notes.length - 1] || "");
    return page("Making a new version", "<p>A new version is on its way. You'll get another email when it's ready.</p>");
  }
  const options = Object.keys(STYLES).map((k) => `<option value="${k}"${k === order.style ? " selected" : ""}>${k}</option>`).join("");
  return page("Redo the art", `<form method="post" class="stack">
    <label>What should change? (optional)<br><textarea name="note" rows="4" maxlength="400"></textarea></label>
    <label>Style<br><select name="style">${options}</select></label>
    <button class="btn btn-primary" type="submit">Make a new version</button></form>`);
}

// ---------- Customer proof + final ----------

async function proof(request, url, env) {
  const id = url.pathname.split("/")[2];
  const t = url.searchParams.get("t");
  if (!(await verify(env, "customer", id, t))) return page("Link expired", "<p>This link isn't valid. Please use the link in your email.</p>", 403);
  const order = await loadOrder(env, id);
  if (!order) return page("Not found", "<p>We couldn't find that order.</p>", 404);
  const left = order.pkg.revisions - order.revisionsUsed;

  if (request.method === "POST") {
    const form = await request.formData();
    if (order.status !== "proof") return redirect(`/proof/${id}?t=${t}`);
    if (form.get("action") === "approve") {
      order.status = "delivered";
      await saveOrder(env, order);
      const link = `${env.SITE_URL}/final/${order.id}?t=${await sign(env, "final", order.id)}`;
      await sendEmail(env, order.email, "Your WonderDraw art is ready to download",
        `Thank you! Your final WonderDraw files are here:\n${link}\n\nYou can download the full-size art and the reveal video. Want it on a canvas or mug? Reply to this email.\n\nGus at WonderDraw`,
        `<p>Thank you! Your final WonderDraw files are ready.</p><p><a href="${link}" style="background:#5b3fd6;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Download your art</a></p><p>Want it on a canvas or mug? Just reply to this email.</p><p>Gus at WonderDraw</p>`);
      await sendEmail(env, env.ADMIN_EMAIL, `WonderDraw: ${order.email} approved their art`, `Order ${order.id} (${order.pkg.name}) is delivered.`);
      return redirect(link.replace(env.SITE_URL, ""));
    }
    if (form.get("action") === "change" && left > 0) {
      const note = clean(form.get("note"), 400);
      order.revisionsUsed += 1;
      order.notes.push(note || "Customer asked for another version.");
      order.status = "generating";
      await saveOrder(env, order);
      await startArt(env, order, note);
      return page("Thanks, we're on it", "<p>We're making a new version with your changes. You'll get an email when the new proof is ready.</p>");
    }
    return redirect(`/proof/${id}?t=${t}`);
  }

  if (order.status === "delivered") return redirect(`/final/${id}?t=${await sign(env, "final", id)}`);
  if (order.status !== "proof") return page("Your art is being made", "<p>We're still working on your proof. You'll get an email as soon as it's ready.</p>");
  const mt = await sign(env, "media", id);
  const changeForm = left > 0
    ? `<details><summary class="btn btn-ghost">Ask for changes (${left} left)</summary>
         <form method="post" class="stack"><input type="hidden" name="action" value="change">
         <label>What would you like changed?<br><textarea name="note" rows="4" maxlength="400" required></textarea></label>
         <button class="btn btn-ghost" type="submit">Send my changes</button></form></details>`
    : "";
  return page("Your WonderDraw proof", `
    <p class="lead">Drag the slider to see the drawing become art. This is a private, watermarked proof.</p>
    ${reveal(`/media/${id}/drawing?t=${mt}`, `/media/${id}/art-${order.round}?t=${mt}`, true)}
    <form method="post" class="cta-row"><input type="hidden" name="action" value="approve"><button class="btn btn-primary" type="submit">Approve, send my final files</button></form>
    ${changeForm}`);
}

async function finalPage(url, env) {
  const id = url.pathname.split("/")[2];
  if (!(await verify(env, "final", id, url.searchParams.get("t")))) return page("Link expired", "<p>This link isn't valid. Please use the link in your email.</p>", 403);
  const order = await loadOrder(env, id);
  if (!order || order.status !== "delivered") return page("Not ready yet", "<p>Your files aren't ready yet.</p>", 404);
  const mt = await sign(env, "media", id);
  const drawing = `/media/${id}/drawing?t=${mt}`;
  const art = `/media/${id}/art-${order.round}?t=${mt}`;
  return page("Your WonderDraw art", `
    <p class="lead">Here's your finished art. Thank you for letting us bring it to life!</p>
    ${reveal(drawing, art, false)}
    <p class="cta-row"><a class="btn btn-primary" href="${art}&download=1">Download full-size art</a>
    <button class="btn btn-ghost" type="button" data-record>Download reveal video</button></p>
    <p><a href="/keepsakes">Put it on a canvas or mug</a></p>`);
}

function reveal(before, after, watermark) {
  return `<div class="reveal${watermark ? " watermarked" : ""}" data-reveal>
      <img src="${after}" alt="Finished WonderDraw art" crossorigin="anonymous">
      <div class="reveal-before"><img src="${before}" alt="Original drawing" crossorigin="anonymous"></div>
      <input type="range" min="0" max="100" value="50" aria-label="Reveal slider">
    </div>
    <script src="/reveal.js" defer></script>`;
}

// ---------- Files ----------

async function media(url, env) {
  const [, , id, file] = url.pathname.split("/");
  if (!/^(drawing|art-\d+)$/.test(file || "")) return new Response("not found", { status: 404 });
  if (!(await verify(env, "media", id, url.searchParams.get("t")))) return new Response("forbidden", { status: 403 });
  const obj = await env.FILES.get(`orders/${id}/${file}`);
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers({ "Cache-Control": "private, max-age=3600" });
  obj.writeHttpMetadata(headers);
  if (url.searchParams.get("download")) headers.set("Content-Disposition", `attachment; filename="wonderdraw-${id}.png"`);
  return new Response(obj.body, { headers });
}

// ---------- Helpers ----------

async function loadOrder(env, id) {
  if (!/^[a-f0-9]{16}$/.test(id || "")) return null;
  return env.ORDERS.get(`order:${id}`, "json");
}

async function saveOrder(env, order) {
  order.updated = new Date().toISOString();
  await env.ORDERS.put(`order:${order.id}`, JSON.stringify(order));
}

async function sendEmail(env, to, subject, text, html) {
  if (!to) return;
  try {
    await env.EMAIL.send({
      from: { email: env.FROM_EMAIL, name: "WonderDraw" },
      replyTo: env.REPLY_TO,
      to,
      subject,
      text,
      html: html || `<pre style="font-family:inherit;white-space:pre-wrap">${esc(text)}</pre>`,
    });
  } catch (err) {
    console.error("email failed", err.code, err.message);
  }
}

export async function sign(env, scope, id) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LINK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${scope}:${id}`));
  return [...new Uint8Array(mac)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verify(env, scope, id, token) {
  if (!id || !token) return false;
  const expected = await sign(env, scope, id);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clean(value, max) {
  return String(value || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | WonderDraw</title><meta name="robots" content="noindex, nofollow"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"></head>
<body><header class="site-header"><a class="brand" href="/"><img src="/images/logo.jpg" alt="Luckey Bear Creations" width="48" height="42"><span>WonderDraw</span></a></header>
<main><section class="section narrow"><h1>${esc(title)}</h1>${body}</section></main>
<footer class="site-footer"><p class="fine">&copy; Luckey Bear Creations LLC · <a href="/contact">Contact</a></p></footer></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
