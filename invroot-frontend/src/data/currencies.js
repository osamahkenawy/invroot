/**
 * Every currency Invroot can bill in — the single list.
 *
 * There used to be six. Settings offered 140 codes, the invoice form 10, the
 * client form 7, the bank-account form 5, the super-admin form 11, and
 * routes/company.js validated against its own 10. The last one was the
 * gatekeeper, so a tenant in India, Japan, Kenya or Canada could pick their
 * currency from a dropdown of 140 and be told "Unsupported currency." on save:
 * 130 of the 140 options failed. A product sold to every country cannot ship
 * six different answers to "which currencies do you support?".
 *
 * ISO 4217 active codes. Keep sorted — the pickers render it in this order.
 *
 * The backend keeps an identical copy in src/lib/currency.js; they are
 * separate packages, so scripts/currency-parity-check.mjs fails the build if
 * the two ever drift apart.
 */
export const CURRENCIES = [
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AZN','BAM','BBD','BDT','BGN',
  'BHD','BIF','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CHF','CLP',
  'CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB',
  'EUR','FJD','GBP','GEL','GHS','GMD','GNF','GTQ','GYD','HNL','HTG','HUF','IDR',
  'ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KWD',
  'KYD','KZT','LAK','LBP','LKR','LRD','LYD','MAD','MDL','MGA','MKD','MMK','MNT',
  'MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD',
  'OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF',
  'SAR','SBD','SCR','SDG','SEK','SGD','SLL','SOS','SRD','SSP','STN','SYP','SZL',
  'THB','TJS','TMT','TND','TOP','TRY','TTD','TZS','UAH','UGX','USD','UYU','UZS',
  'VES','VND','VUV','WST','XAF','XCD','XOF','YER','ZAR','ZMW',
];

export default CURRENCIES;
