# wonderdraw.net

WonderDraw's own site, replacing the MadeThis version. Plain HTML/CSS served by a
Cloudflare Worker (static assets only, free plan). Checkout runs on Stripe Payment
Links in Luckey Bear Creations' own Stripe account.

## Change prices or checkout links

Edit `public/config.js`. Each package has a `price` (text shown on the card) and a
`link` (a `https://buy.stripe.com/...` Payment Link). A package with no link sends
visitors to the contact page to order by email, so the site works before Stripe is set up.

To make a Payment Link: Stripe Dashboard → Payment Links → New. Use a one-time price for
Spark Sketch, Magic Reveal and Big Imagination Bundle, and a $12/month recurring price for
Little Artist Club. Under **After payment**, choose "Don't show confirmation page" and
redirect to `https://wonderdraw.net/thanks`.

## Orders (automatic)

1. Each Stripe Payment Link redirects to `/thanks?session_id={CHECKOUT_SESSION_ID}`.
2. `/thanks` checks the order is paid and shows an upload form (photo, style, story,
   guardian consent). Without a session id it falls back to "reply to your receipt".
3. The drawing goes to R2 and Replicate (`REPLICATE_MODEL`) makes the art.
4. Gus gets an email with the drawing, the art and **Approve** / **Redo** buttons.
5. Approve emails the customer a private, watermarked proof page with a before/after
   slider. They approve (final download page + reveal video) or ask for changes, up to
   the package's revision rounds (Spark 0, Magic Reveal 1, Bundle 2).

Code: `src/index.js` (Worker), `public/order.js` (upload form), `public/reveal.js`
(slider and browser-made reveal video). Orders are in KV `wonderdraw-orders`, files in
R2 `wonderdraw-orders`.

### Turning it on

1. `npx wrangler secret put STRIPE_SECRET_KEY` (restricted key, Checkout Sessions: read)
2. `npx wrangler secret put REPLICATE_API_TOKEN`
3. `npx wrangler secret put LINK_SECRET` (any long random string)
4. Verify shopluckybears.com in Resend (resend.com/domains, auto-configure with
   Cloudflare), make a sending-only API key, and save it as the `RESEND_API_KEY` secret
5. In Stripe, set each Payment Link's after-payment redirect to
   `https://wonderdraw.shopluckybears.com/thanks?session_id={CHECKOUT_SESSION_ID}`
6. `npm run deploy`

Little Artist Club renewals don't get a new upload link yet; handle those by email.

## Contact email

The site uses `hello@wonderdraw.net`. Once the domain is on Cloudflare, turn on
Email Routing (Cloudflare → wonderdraw.net → Email → Email Routing) and forward
`hello@` to your Gmail. It's free.

## Commands

- `npm install`
- `npm test`: checks titles, canonicals, links, and that no MadeThis leftovers remain
- `npm run dev`: preview at http://localhost:8787
- `npm run deploy`: deploy the `wonderdraw` Worker

## Going live (in order)

1. Make sure you hold wonderdraw.net (Namecheap, or the transfer code from MadeThis).
2. Add wonderdraw.net to Cloudflare and point the Namecheap nameservers at it.
3. `npm run deploy`, then attach the domain: Workers & Pages → wonderdraw → Settings → Domains & Routes → Add custom domain.
4. Cancel MadeThis only after the new site is live on the domain.
