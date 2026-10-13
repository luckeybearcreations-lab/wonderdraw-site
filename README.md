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

## Orders

After paying, the customer replies to their Stripe receipt with the drawing photo (the
`/thanks` page tells them how). Set Stripe → Settings → Public details → Support email
to the inbox you read, so those replies reach you.

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
