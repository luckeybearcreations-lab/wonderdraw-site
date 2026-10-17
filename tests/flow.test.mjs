import assert from "node:assert/strict";
import test from "node:test";
import worker, { buildPrompt, sign, verify, esc } from "../src/index.js";

// Fake Cloudflare bindings + fake Stripe/Replicate so the whole order flow runs in Node.
function fakeEnv() {
  const kv = new Map();
  const files = new Map();
  const mail = [];
  return {
    mail,
    files,
    SITE_URL: "https://wd.test",
    ADMIN_EMAIL: "gus@test",
    FROM_EMAIL: "wonderdraw@test",
    REPLY_TO: "hello@test",
    REPLICATE_MODEL: "owner/model",
    STRIPE_SECRET_KEY: "sk_test",
    REPLICATE_API_TOKEN: "r8_test",
    LINK_SECRET: "secret",
    ASSETS: { fetch: () => new Response("asset") },
    ORDERS: {
      get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
      put: async (k, v) => void kv.set(k, v),
    },
    FILES: {
      put: async (k, body, opts) => void files.set(k, { body: await new Response(body).arrayBuffer(), type: opts?.httpMetadata?.contentType }),
      get: async (k) => {
        const f = files.get(k);
        return f && { body: f.body, writeHttpMetadata: (h) => h.set("Content-Type", f.type) };
      },
    },
    RESEND_API_KEY: "re_test",
  };
}

let mailbox = [];
function stubFetch(predictions, env) {
  mailbox = env ? env.mail : [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url === "https://api.resend.com/emails") {
      const m = JSON.parse(init.body);
      mailbox.push({ ...m, to: m.to[0] });
      return Response.json({ id: "e1" });
    }
    if (url.startsWith("https://api.stripe.com/v1/checkout/sessions/cs_paid")) {
      return Response.json({ id: "cs_paid", payment_status: "paid", payment_link: "plink_1UQjJdK5pTjjyr2KFGhdcSj5", customer_details: { email: "mom@test", name: "Pat Lee" } });
    }
    if (url.startsWith("https://api.stripe.com/v1/checkout/sessions/cs_other")) {
      return Response.json({ id: "cs_other", payment_status: "paid", payment_link: "plink_somethingelse", customer_details: { email: "x@test" } });
    }
    if (url.startsWith("https://api.stripe.com/")) return Response.json({ payment_status: "unpaid" });
    if (url.startsWith("https://api.replicate.com/")) {
      predictions.push(JSON.parse(init.body));
      return Response.json({ id: "p1", status: "starting" });
    }
    if (url === "https://replicate.delivery/out.png") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    throw new Error("unexpected fetch " + url);
  };
}

const ctx = () => {
  const waits = [];
  return { waits, waitUntil: (p) => waits.push(p) };
};

function upload(session) {
  const fd = new FormData();
  fd.append("session_id", session);
  fd.append("photo", new File([new Uint8Array([9, 9])], "d.jpg", { type: "image/jpeg" }));
  fd.append("story", "Our dog Max flying");
  fd.append("style", "watercolor");
  fd.append("consent", "yes");
  return new Request("https://wd.test/api/order", { method: "POST", body: fd });
}

test("full order: upload, AI art, Gus approves, customer approves", async () => {
  const env = fakeEnv();
  const predictions = [];
  stubFetch(predictions, env);

  const c = ctx();
  const res = await worker.fetch(upload("cs_paid"), env, c);
  const body = await res.json();
  assert.equal(body.ok, true);
  await Promise.all(c.waits);
  assert.equal(predictions.length, 1);
  assert.match(predictions[0].input.prompt, /watercolor/);
  assert.match(predictions[0].input.prompt, /Our dog Max flying/);
  assert.match(predictions[0].input.input_image, /^https:\/\/wd\.test\/media\/[a-f0-9]{16}\/drawing\?t=/);

  // a second upload for the same checkout is refused
  assert.equal((await worker.fetch(upload("cs_paid"), env, ctx())).status, 409);

  // Replicate calls back
  const hook = new URL(predictions[0].webhook);
  const done = await worker.fetch(new Request(hook, { method: "POST", body: JSON.stringify({ status: "succeeded", output: "https://replicate.delivery/out.png" }) }), env, ctx());
  assert.equal(done.status, 200);
  const review = env.mail.at(-1);
  assert.equal(review.to, "gus@test");
  const approve = review.text.match(/Approve and send the proof: (\S+)/)[1];

  // Gus approves -> customer gets the proof link
  await worker.fetch(new Request(approve), env, ctx());
  const proofMail = env.mail.at(-1);
  assert.equal(proofMail.to, "mom@test");
  const proofUrl = proofMail.text.match(/(https:\/\/wd\.test\/proof\/\S+)/)[1];
  const proofPage = await (await worker.fetch(new Request(proofUrl), env, ctx())).text();
  assert.match(proofPage, /watermarked/);
  assert.match(proofPage, /Ask for changes \(1 left\)/);

  // customer approves -> final files
  const fd = new FormData();
  fd.append("action", "approve");
  const fin = await worker.fetch(new Request(proofUrl, { method: "POST", body: fd }), env, ctx());
  assert.equal(fin.status, 303);
  assert.equal(env.mail.at(-2).to, "mom@test");
  const finalPage = await (await worker.fetch(new Request("https://wd.test" + fin.headers.get("Location")), env, ctx())).text();
  assert.match(finalPage, /Download full-size art/);
});

test("unpaid checkout and bad links are rejected", async () => {
  const env = fakeEnv();
  stubFetch([], env);
  assert.equal((await worker.fetch(upload("cs_unpaid"), env, ctx())).status, 400);
  assert.equal((await worker.fetch(upload("cs_other"), env, ctx())).status, 400, "non-WonderDraw purchase");
  assert.equal((await worker.fetch(new Request("https://wd.test/admin/approve?order=0123456789abcdef&t=bad"), env, ctx())).status, 403);
  assert.equal((await worker.fetch(new Request("https://wd.test/media/0123456789abcdef/drawing?t=bad"), env, ctx())).status, 403);
  assert.equal(await (await worker.fetch(new Request("https://wd.test/"), env, ctx())).text(), "asset");
});

test("links are signed per scope", async () => {
  const env = { LINK_SECRET: "s" };
  const t = await sign(env, "customer", "abc");
  assert.equal(await verify(env, "customer", "abc", t), true);
  assert.equal(await verify(env, "final", "abc", t), false);
  assert.equal(await verify(env, "customer", "abd", t), false);
});

test("prompt keeps the drawing and adds notes", () => {
  const p = buildPrompt({ style: "papercut", story: "a cat", scene: "" }, "make it brighter");
  assert.match(p, /paper-cutout/);
  assert.match(p, /a cat/);
  assert.match(p, /make it brighter/);
  assert.equal(esc('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
});
