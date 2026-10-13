// The one file to edit when prices or Stripe links change.
// price: text shown on the card, e.g. "$29". Leave "" to show "Price shown at checkout".
// link:  the Stripe Payment Link (https://buy.stripe.com/...). Leave "" and the
//        button sends visitors to the contact page to order by email instead.
// Set each Payment Link's "After payment" redirect to https://wonderdraw.net/thanks
window.WONDERDRAW = {
  contactEmail: "hello@wonderdraw.net",
  packages: {
    spark: { price: "$24", link: "" },
    reveal: { price: "$49", link: "" },
    bundle: { price: "$79", link: "" },
    club: { price: "$12/month", link: "" },
  },
};
