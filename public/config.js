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
};
