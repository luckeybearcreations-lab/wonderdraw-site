// The one file to edit when prices or Stripe links change.
// price: text shown on the card, e.g. "$29". Leave "" to show "Price shown at checkout".
// link:  the Stripe Payment Link (https://buy.stripe.com/...). Leave "" and the
//        button sends visitors to the contact page to order by email instead.
// Each Payment Link's "After payment" redirect is https://wonderdraw.shopluckybears.com/thanks
// (change it in Stripe when the site moves to wonderdraw.net).
window.WONDERDRAW = {
  contactEmail: "hello@shopluckybears.com",
  packages: {
    spark: { price: "$24", link: "https://buy.stripe.com/00w6oI8QI2Nb3uXgxK1sQ0q" },
    reveal: { price: "$49", link: "https://buy.stripe.com/fZu9AU6IA87v0iL81e1sQ0r" },
    bundle: { price: "$79", link: "https://buy.stripe.com/5kQ28sgjadrP3uX0yM1sQ0s" },
    club: { price: "$12/month", link: "https://buy.stripe.com/8x2aEYc2UfzXghJ95i1sQ0t" },
  },
  // Temporary promotion. Everything marked data-promo (banner, Club price swap, button text)
  // renders only while the visitor's clock is before endsAt, then disappears on its own.
  // endsAt = Mon Nov 30, 2026 11:59:59 PM Central = 2026-12-01T05:59:59Z (same instant the Stripe code CLUB6 expires).
  promo: {
    endsAt: "2026-12-01T05:59:59Z",
    bannerText: "WonderDraw Club launch deal — first month $6 with code CLUB6. Ends Nov 30.",
    clubPrice: "$6 first month, then $12/month",
    clubButton: "$6 first month, then $12/month",
  },
};
