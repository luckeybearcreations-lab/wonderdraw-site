import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import test from "node:test";

const pub = new URL("../public/", import.meta.url);
const pages = (await readdir(pub)).filter((f) => f.endsWith(".html"));
const read = (f) => readFile(new URL(f, pub), "utf8");

test("every page has a title, description and canonical URL", async () => {
  for (const file of pages) {
    const html = await read(file);
    assert.match(html, /<title>[^<]+<\/title>/, file);
    assert.match(html, /<meta name="description" content="[^"]+">/, file);
    assert.match(html, /<link rel="canonical" href="https:\/\/(wonderdraw\.net|wonderdraw\.shopluckybears\.com)\/[^"]*">/, file);
  }
});

test("internal links point at pages that exist", async () => {
  for (const file of pages) {
    const html = await read(file);
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
      if (href === "/") continue;
      const target = href.slice(1);
      const candidates = [target, `${target}.html`];
      const found = await Promise.any(candidates.map((c) => access(new URL(c, pub)))).then(() => true, () => false);
      assert.ok(found, `${file} links to missing ${href}`);
    }
  }
});

test("no MadeThis or old platform leftovers", async () => {
  for (const file of [...pages, "config.js", "site.js"]) {
    assert.doesNotMatch(await read(file), /madethis|convex\.cloud/i, file);
  }
});

test("thank-you and 404 pages stay out of search", async () => {
  assert.match(await read("thanks.html"), /noindex/);
  assert.match(await read("404.html"), /noindex/);
  assert.doesNotMatch(await read("index.html"), /noindex/);
});

test("every package button has a fallback and a config entry", async () => {
  const html = await read("index.html");
  const config = await read("config.js");
  for (const key of ["spark", "reveal", "bundle", "club"]) {
    assert.match(html, new RegExp(`data-buy="${key}" href="/contact\\?`), key);
    assert.match(config, new RegExp(`${key}: \\{ price:`), key);
  }
});

test("Stripe links in config are real Payment Links when set", async () => {
  const config = await read("config.js");
  for (const [, link] of config.matchAll(/link: "([^"]*)"/g)) {
    if (link) assert.match(link, /^https:\/\/(buy|checkout)\.stripe\.com\//);
  }
});
