# baseball-cards

What is a card actually worth? Not the asking price — the price someone paid.

This reads eBay's **sold** listings for a card or a sealed product, throws out the
junk that pollutes every card search, splits graded sales from raw ones, and
reports the **median** of each.

The shape of a run (illustrative figures — real ones depend on the day):

```
$ node scripts/ebay_comps.mjs "1989 Upper Deck Ken Griffey Jr rookie" --require "griffey,1989"

QUERY: 1989 Upper Deck Ken Griffey Jr rookie
matched 54 sold listings after filtering

  RAW / UNGRADED   n=31  median $38.00     IQR $24.00–$61.00   range $9.99–$180.00
  PSA 10           n=8   median $1150.00   IQR $995.00–$1300.00
  PSA 9            n=9   median $92.00     IQR $80.00–$110.00

  recent sales:
   Aug 19, 2026  $1150.00  PSA 10   1989 Upper Deck #1 Ken Griffey Jr RC PSA 10 GEM MINT
   Aug 18, 2026  $41.00    raw      1989 Upper Deck Ken Griffey Jr Rookie #1 Mariners
   ...
```

## Why the filtering is the whole point

A naive average of an eBay card search describes nothing. Three things wreck it:

- **Graded sales are 3–20× raw sales.** A PSA 10 and a shoebox copy are not the
  same asset. Averaged together they produce a number that is true of neither, so
  grades are bucketed separately (`PSA/BGS/SGC/CSG/BVG`, parsed out of the title).
- **The results are full of things that aren't the card.** Reprints, customs,
  digital, stickers, wrappers, empty boxes, "lot of 500", "you pick". There's a
  default exclusion list for these, and `--exclude` for whatever is specific to
  your search.
- **One idiot overpaying moves a mean.** So every figure here is a **median**,
  reported with its interquartile range. The IQR is the honest answer to "what
  would this sell for" — a single number pretends to a precision the market
  doesn't have.

## Setup

```bash
npm install
npx playwright install chrome
```

eBay gates sold listings behind a signed-in session, so put your login in `.env`:

```
EBAY_USER=you@example.com
EBAY_PASS=...
```

Then sign in once:

```bash
node scripts/ebay_login.mjs
```

The session persists in `.browser-profile/` and is reused by every later run.
Both `.env` and `.browser-profile/` are gitignored — the profile holds live
cookies, so treat that directory as a credential.

## Usage

```bash
node scripts/ebay_comps.mjs "<search>" [options]

  --require a,b     every term must appear in the title
  --exclude x,y     drop titles containing any of these (added to the defaults)
  --limit N         stop after N matched sales (default 60)
  --label <id>      also append the result to catalog/comps.jsonl
  --json            print the full result object instead of the table
```

Tracking a collection over time means running with `--label` and letting
`catalog/comps.jsonl` accumulate — one line per run, so a re-run months later
sits next to the old one instead of overwriting it.

## The bot wall

eBay fingerprints headless browsers and answers them with a 403, so **these runs
are always headed** — a real Chrome window opens and you can watch it work. That
is deliberate, not an oversight.

Sign-in is also frequently challenged with a CAPTCHA or a one-time code sent to
your email. `ebay_login.mjs` makes no attempt to defeat either. It pauses, tells
you what eBay is asking for, and waits while you clear it by hand in the open
window; then it verifies the session by checking that a sold-search page actually
renders result rows, rather than trusting that the login "succeeded."

If comps start failing with an HTTP 4xx, you're rate-limited. Wait a few minutes.

## Layout

```
scripts/ebay_comps.mjs   the comps run — search, filter, bucket, report
scripts/ebay_login.mjs   one-time sign-in, human-in-the-loop for challenges
scripts/_browser.mjs     shared Chrome launch config
catalog/                 comps.jsonl, appended to by --label runs
```

No database, no API keys, no server. One folder and a browser.
