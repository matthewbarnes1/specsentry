// SpecSentry — contract & bid-document risk scanner for construction subcontractors (stateless)
const express = require('express');

const RISKS = [
  { key: 'pay_if_paid', label: 'Pay-if-paid / contingent payment', sev: 3, kw: ['pay-if-paid', 'pay if paid', 'paid-if-paid', 'condition precedent to payment', 'contingent upon receipt of payment', 'only upon receipt of payment from owner'],
    why: 'You may never be paid if the owner stiffs the GC — even for approved work.', ask: 'Convert to pay-WHEN-paid with an outside payment date (e.g. 60 days), or strike.' },
  { key: 'ld', label: 'Liquidated damages flow-down', sev: 3, kw: ['liquidated damages', 'per day of delay', 'per calendar day', '$ per day', 'delay damages'],
    why: 'Daily delay penalties can exceed your entire contract margin.', ask: 'Cap LDs at a % of subcontract value; exclude delays not caused by you.' },
  { key: 'no_delay_damages', label: 'No-damages-for-delay', sev: 3, kw: ['no damages for delay', 'no-damage-for-delay', 'sole remedy shall be an extension of time', 'extension of time shall be the sole'],
    why: 'GC can idle your crews for months and owe you nothing but a schedule slip.', ask: 'Carve out compensable delay for GC/owner-caused suspension beyond X days.' },
  { key: 'broad_indemnity', label: 'Broad-form indemnity', sev: 3, kw: ['indemnify and hold harmless', 'including claims arising from the negligence of', 'regardless of whether caused in whole or in part', 'defend, indemnify'],
    why: 'You could owe defense costs for the GC\'s own negligence — often uninsurable.', ask: 'Limit to claims "to the extent caused by" your own negligence (comparative fault).' },
  { key: 'termination_convenience', label: 'Termination for convenience (bare)', sev: 2, kw: ['terminate for convenience', 'termination for convenience', 'terminate this agreement at any time'],
    why: 'They can drop you mid-job; without recovery language you eat mobilization and committed materials.', ask: 'Add recovery of costs incurred + reasonable overhead/profit on work performed.' },
  { key: 'retainage', label: 'Heavy retainage', sev: 2, kw: ['retainage of ten', '10% retainage', 'retain ten percent', 'retainage shall be 10', 'retention of 10'],
    why: '10% held to final completion can be your whole margin financed for a year.', ask: 'Reduce to 5%, with release at 50% completion and trade-specific final release.' },
  { key: 'flow_down', label: 'Blanket flow-down clause', sev: 2, kw: ['bound by the prime contract', 'flow down', 'assumes toward the contractor all obligations', 'incorporated by reference'],
    why: 'You inherit every prime-contract obligation — including ones you\'ve never seen.', ask: 'Demand the prime contract (or relevant excerpts) before signing; exclude conflicting terms.' },
  { key: 'lien_waiver', label: 'Advance lien waiver', sev: 3, kw: ['waives all lien rights', 'waiver of lien', 'waive any and all liens', 'no lien shall attach'],
    why: 'Lien rights are your strongest payment leverage; waiving them up front is often unenforceable but always dangerous.', ask: 'Replace with conditional waivers exchanged progressively upon payment.' },
  { key: 'schedule_acceleration', label: 'Uncompensated acceleration', sev: 2, kw: ['accelerate the work at no additional cost', 'acceleration without additional compensation', 'overtime as required at no cost'],
    why: 'Mandatory overtime/resequencing on your dime destroys labor budgets.', ask: 'Acceleration only by written directive with agreed compensation.' },
  { key: 'consequential', label: 'No mutual waiver of consequential damages', sev: 1, kw: ['consequential damages'],
    why: 'If the waiver isn\'t mutual, your exposure is unlimited while theirs is capped.', ask: 'Make the consequential-damages waiver mutual.' },
  { key: 'dispute_venue', label: 'Hostile dispute venue/forum', sev: 1, kw: ['venue shall be', 'exclusive jurisdiction', 'arbitration in', 'governed by the laws of'],
    why: 'Litigating in the GC\'s home forum raises your cost to enforce payment.', ask: 'Project-location venue; prevailing-party attorney fees.' },
  { key: 'warranty_extended', label: 'Extended warranty period', sev: 1, kw: ['warranty period of two', 'two-year warranty', '24-month warranty', 'three-year warranty'],
    why: 'Warranty beyond one year extends your risk tail and bonding costs.', ask: 'Standard one-year workmanship warranty from substantial completion.' },
];

const SAMPLE = `SUBCONTRACT AGREEMENT — Section 7, 9, 12 (excerpts)

7.1 Payment. Contractor shall pay Subcontractor within seven (7) days of Contractor's receipt of payment from Owner for Subcontractor's work, receipt of such payment being a condition precedent to payment hereunder. Contractor shall retain ten percent (10%) of each progress payment until final completion and acceptance of the entire Project.

7.4 Liens. Subcontractor hereby waives all lien rights against the Project and Owner's property to the fullest extent permitted by law.

9.2 Schedule. Time is of the essence. Subcontractor shall accelerate the Work, including overtime and additional shifts, as directed by Contractor at no additional cost whenever Contractor determines the Work is behind schedule. In the event of delay to the Project caused by Subcontractor, Subcontractor shall be liable for liquidated damages of $2,500 per calendar day. Subcontractor's sole remedy for delays caused by others shall be an extension of time.

12.1 Indemnity. Subcontractor shall defend, indemnify and hold harmless Contractor and Owner from any and all claims arising out of the Work, regardless of whether caused in whole or in part by the negligence of Contractor. Subcontractor shall be bound by the Prime Contract, all terms of which are incorporated by reference, and assumes toward the Contractor all obligations Contractor assumes toward Owner. Contractor may terminate this Agreement for convenience at any time.`;

function scan(text) {
  const t = text.toLowerCase();
  const found = [];
  for (const r of RISKS) {
    const hit = r.kw.find(k => t.includes(k));
    if (hit) {
      const i = t.indexOf(hit);
      const start = Math.max(0, i - 90), end = Math.min(text.length, i + hit.length + 110);
      found.push({ ...r, excerpt: (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '') });
    }
  }
  const sev3 = found.filter(f => f.sev === 3).length, sev2 = found.filter(f => f.sev === 2).length, sev1 = found.filter(f => f.sev === 1).length;
  const riskScore = Math.min(100, sev3 * 22 + sev2 * 11 + sev1 * 5);
  const verdict = riskScore >= 60 ? 'negotiate_hard' : riskScore >= 30 ? 'negotiate' : 'acceptable';
  return { found, sev3, sev2, sev1, riskScore, verdict };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CSS = `
:root{--bg:#f7f6f2;--panel:#fff;--line:#e3e0d6;--ink:#24231e;--dim:#6e6c60;--yellow:#f4b400;--yellow-dark:#8a6a00;--charcoal:#2b2a25;--green:#2e7d54;--green-soft:#e5f3ec;--red:#c0392b;--red-soft:#fae7e4;--amber:#b7791f;--amber-soft:#fbf1dc;--font:"Avenir Next","Segoe UI",-apple-system,Helvetica,Arial,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);line-height:1.55}
a{color:var(--yellow-dark);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:980px;margin:0 auto;padding:0 22px}
nav{background:var(--charcoal);color:#fff}nav .wrap{display:flex;align-items:center;gap:22px;height:60px}
.logo{font-weight:800;font-size:1.15rem;color:#fff;display:flex;align-items:center;gap:9px}.logo:hover{text-decoration:none}
.mark{width:26px;height:26px;border-radius:6px;background:var(--yellow);color:#2b2a25;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:.95rem}
nav a.nl{color:#c9c6b8}.spacer{flex:1}
.btn{display:inline-block;background:var(--yellow);color:#2b2a25;font-weight:800;padding:10px 18px;border-radius:8px;border:none;font-size:.95rem;cursor:pointer;font-family:var(--font)}
.btn:hover{filter:brightness(1.05);text-decoration:none}.btn.ghost{background:transparent;border:1.5px solid var(--line);color:var(--ink)}nav .btn.ghost{color:#fff;border-color:#4a483f}.btn.small{padding:6px 12px;font-size:.85rem}
.hero{background:repeating-linear-gradient(45deg,var(--charcoal),var(--charcoal) 26px,#33322c 26px,#33322c 52px);color:#fff;padding:74px 0 64px}
.hero h1{font-size:2.7rem;line-height:1.12;letter-spacing:-.02em;margin:0 0 16px;max-width:680px}.hero h1 em{font-style:normal;color:var(--yellow)}
.hero p{color:#d8d5c8;font-size:1.13rem;max-width:620px;margin:0 0 26px}
.statrow{display:flex;gap:40px;flex-wrap:wrap;margin-top:36px}.statrow b{display:block;font-size:1.6rem;color:var(--yellow)}.statrow span{color:#c9c6b8;font-size:.88rem}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px;margin-top:18px}.panel h3{margin-top:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-top:26px}
.kicker{text-transform:uppercase;letter-spacing:.12em;font-size:.75rem;font-weight:700;color:var(--yellow-dark);margin:40px 0 6px}
h2.t{font-size:1.7rem;margin:0 0 10px}
textarea{width:100%;padding:12px 14px;border:1.5px solid var(--line);border-radius:8px;font-size:.88rem;font-family:ui-monospace,Menlo,monospace;background:#fff;color:var(--ink);min-height:220px;resize:vertical}
textarea:focus{outline:none;border-color:var(--yellow)}
.tag{display:inline-block;padding:2px 10px;border-radius:99px;font-size:.76rem;font-weight:700;margin:2px 3px 2px 0}
.tag.red{background:var(--red-soft);color:var(--red)}.tag.amber{background:var(--amber-soft);color:var(--amber)}.tag.green{background:var(--green-soft);color:var(--green)}.tag.dim{background:#efede4;color:var(--dim)}
.riskcard{border-left:4px solid var(--red);background:#fff;border-radius:0 10px 10px 0;border-top:1px solid var(--line);border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:16px 20px;margin-top:12px}
.riskcard.sev2{border-left-color:var(--amber)}.riskcard.sev1{border-left-color:#b8b28f}
.riskcard h4{margin:0 0 4px}
.excerpt{font-family:ui-monospace,Menlo,monospace;font-size:.8rem;background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:9px 12px;color:var(--dim);margin:8px 0}
.score{font-size:2.6rem;font-weight:800}
.meter{height:10px;background:#ece9dd;border-radius:99px;overflow:hidden;max-width:340px}.meter i{display:block;height:100%}
.footer{color:var(--dim);font-size:.85rem;border-top:1px solid var(--line);margin-top:70px;padding:30px 0}
pre.doc{background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:18px;white-space:pre-wrap;font-family:var(--font);font-size:.9rem;line-height:1.6}
@media(max-width:640px){.hero h1{font-size:2rem}}`;
const page = (title, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="SpecSentry — paste subcontract or bid documents and instantly flag the clauses that kill subcontractors: pay-if-paid, liquidated damages, broad indemnity, lien waivers, and more.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='6' fill='%23f4b400'/><path d='M12 4l7 3v5c0 4.4-3 7.6-7 8.6-4-1-7-4.2-7-8.6V7l7-3z' fill='%232b2a25'/><path d='M9 12l2 2 4-4.5' stroke='%23f4b400' stroke-width='2' fill='none' stroke-linecap='round'/></svg>">
<style>${CSS}</style></head><body>
<nav><div class="wrap"><a class="logo" href="/"><span class="mark">⚠</span>SpecSentry</a>
<div class="spacer"></div><a class="nl" href="/whitepaper">Whitepaper</a><a class="btn small" href="/#try">Scan a contract</a></div></nav>
${body}
<div class="footer"><div class="wrap"><b style="color:var(--ink)">SpecSentry</b> — read the contract like a construction lawyer, in 10 seconds. Demo deployment: pattern-based scan, not legal advice; nothing is stored.</div></div></body></html>`;

const app = express();
app.use(express.urlencoded({ extended: true, limit: '500kb' }));

app.get('/', (req, res) => {
  const prefill = req.query.demo ? SAMPLE : '';
  res.send(page('SpecSentry — subcontract risk scanner', `
<div class="hero"><div class="wrap">
<h1>The clause that <em>kills your margin</em> is on page 47.</h1>
<p>Subcontractors sign what GCs send — pay-if-paid, $2,500/day liquidated damages, broad-form indemnity, advance lien waivers — because nobody has time to read 60 pages before bid day. SpecSentry scans the document and flags every margin-killer with what to ask for instead.</p>
<a class="btn" href="#try">Scan a subcontract</a> &nbsp; <a class="btn ghost" href="/?demo=1#try" style="color:#fff">Load a sample contract</a>
<div class="statrow">
<div><b>12</b><span>killer-clause families detected</span></div>
<div><b>10 sec</b><span>from paste to risk report</span></div>
<div><b>$0</b><span>cost of asking for better terms</span></div>
</div></div></div>
<div class="wrap">
<div class="kicker" id="try">Try it</div><h2 class="t">Paste the subcontract or bid-package text</h2>
<div class="panel">
<form method="post" action="/scan">
<textarea name="doc" required minlength="60" placeholder="Paste subcontract clauses, general conditions, or the whole document text…">${esc(prefill)}</textarea>
<div style="display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap">
<button class="btn">Scan for risk clauses</button>
<span style="color:var(--dim);font-size:.85rem">Nothing stored. Pattern-based demo engine; production adds LLM clause interpretation. Not legal advice.</span>
</div></form></div>
<div class="kicker">What it catches</div><h2 class="t">The clauses that turn profit into lawsuits</h2>
<div class="grid">
<div class="panel"><h3>Payment traps</h3><p style="color:var(--dim)">Pay-if-paid conditions precedent, 10% retainage to final completion, advance lien waivers.</p></div>
<div class="panel"><h3>Schedule traps</h3><p style="color:var(--dim)">Daily liquidated damages, no-damages-for-delay, uncompensated acceleration directives.</p></div>
<div class="panel"><h3>Liability traps</h3><p style="color:var(--dim)">Broad-form indemnity for the GC's own negligence, blanket flow-downs, bare termination for convenience.</p></div>
</div></div>`));
});

app.post('/scan', (req, res) => {
  const text = (req.body.doc || '').slice(0, 400000);
  if (text.trim().length < 60) return res.redirect('/');
  const r = scan(text);
  const color = r.verdict === 'negotiate_hard' ? 'var(--red)' : r.verdict === 'negotiate' ? 'var(--amber)' : 'var(--green)';
  res.send(page('Risk report · SpecSentry', `
<div class="wrap" style="padding-top:36px;max-width:860px">
<div class="kicker"><a href="/">← Scan another</a></div>
<h2 class="t">Contract risk report</h2>
<div class="panel"><div style="display:flex;gap:34px;align-items:center;flex-wrap:wrap">
<div><div class="score" style="color:${color}">${r.riskScore}<span style="font-size:1.1rem;color:var(--dim)">/100</span></div>
<div class="meter"><i style="width:${r.riskScore}%;background:${color}"></i></div>
<div style="margin-top:6px"><span class="tag ${r.verdict === 'negotiate_hard' ? 'red' : r.verdict === 'negotiate' ? 'amber' : 'green'}">${r.verdict === 'negotiate_hard' ? 'High risk — negotiate before signing' : r.verdict === 'negotiate' ? 'Moderate — negotiate key clauses' : 'Acceptable risk profile'}</span></div></div>
<div style="flex:1;min-width:240px;color:var(--dim);font-size:.95rem">
<b style="color:var(--ink)">${r.found.length} risk clause${r.found.length === 1 ? '' : 's'} detected:</b> ${r.sev3} critical · ${r.sev2} significant · ${r.sev1} noteworthy.<br>
Every flagged clause below includes the exact excerpt and the counter-ask to bring to the GC. ${r.found.length ? 'Asking costs nothing — GCs expect markups.' : 'This document avoided the classic traps.'}</div>
</div></div>
${r.found.map(f => `<div class="riskcard sev${f.sev}">
<h4>${f.sev === 3 ? '🟥' : f.sev === 2 ? '🟧' : '🟨'} ${f.label}</h4>
<div class="excerpt">${esc(f.excerpt)}</div>
<div style="font-size:.92rem"><b>Why it hurts:</b> <span style="color:var(--dim)">${f.why}</span></div>
<div style="font-size:.92rem;margin-top:4px"><b>Counter-ask:</b> <span style="color:var(--dim)">${f.ask}</span></div>
</div>`).join('') || '<div class="panel"><span class="tag green">No known killer clauses matched</span> <span style="color:var(--dim)">— still have counsel review anything unusual.</span></div>'}
<div class="panel" style="margin-top:22px"><h3>Negotiation cover note (drafted)</h3>
<pre class="doc">Subject: Subcontract comments — [Project name]

Hi [PM name],

Thanks for the subcontract package. We're ready to move quickly — attached are our markups, focused on ${r.found.slice(0, 3).map(f => f.label.toLowerCase()).join(', ') || 'a few standard items'}. These are standard, insurable positions that keep both of us protected without touching price or schedule.

Happy to walk through them on a 15-minute call and return a signed copy this week.

Best,
[Name], [Company]</pre></div>
</div>`));
});

const WHITEPAPER = `SPECSENTRY — WHITEPAPER
Contract risk-scanning for the 700,000 businesses that build everything · July 2026

THE PROBLEM
US construction runs on subcontracts, and subcontracts are written by the other side. Pay-if-paid clauses make payment contingent on money the sub never controls; liquidated damages of thousands per day flow down onto trades with single-digit margins; broad-form indemnity makes subs insure the GC's own negligence; advance lien waivers sign away the strongest payment remedy in the industry. Every construction attorney knows this list — but subs price and sign bid packages in days, under competitive pressure, usually without counsel. The result is a persistent, quantifiable transfer of risk from GCs to the smallest firms on the job. AI contract review exists (Spellbook, ContraVault, Provision et al.) — aimed at GCs, owners, and law firms. The sub with 15 employees reads page 47 at midnight, or doesn't.

THE SOLUTION
SpecSentry is built for that midnight read: paste the subcontract (or the whole bid package) and get, in seconds, a 0-100 risk score; every detected killer clause with the exact excerpt highlighted; a plain-English "why it hurts" for each; the specific counter-ask that industry norms support (pay-WHEN-paid with outside date, LD caps, comparative-fault indemnity, progressive conditional lien waivers); and a drafted negotiation cover note. The demo engine is pattern-based across 12 clause families; production layers LLM interpretation for non-standard language and state-law overlays (anti-pay-if-paid statutes, lien-waiver enforceability by state).

WHY NOW
Subcontractor insolvencies rose through the 2024-26 cycle, and payment-risk clauses are a documented contributor. AI made clause detection nearly free. Sub-side associations (ASA) actively campaign on these exact clauses — a ready channel. And no incumbent owns the sub-side SMB market: existing tools price for enterprises and speak GC.

MARKET
~700,000 construction subcontracting establishments in the US alone. At $59-$149/mo, a 1% beachhead is a $50-125M ARR business, with expansion to bid/no-bid analytics, insurance-requirement checks, and state-law playbooks.

BUSINESS MODEL
$59/mo solo (scans + reports), $149/mo team (state-law overlays, LLM interpretation, markup exports). Channels: trade associations, construction-insurance brokers, surety agents.

SOURCES
- Ment Tech (2026): AI contract review for construction risk: ment.tech/ai-contract-review-for-construction/
- Spellbook (2026): construction contract review landscape: spellbook.com/learn/construction-contract-review
- Arctis AI (2026): bid evaluation and risk: arctisai.com/en/resources/construction-bid-evaluation-risk-reduction-2026`;

app.get('/whitepaper', (req, res) => res.send(page('Whitepaper · SpecSentry', `<div class="wrap" style="padding-top:36px;max-width:760px"><div class="panel"><pre class="doc">${esc(WHITEPAPER)}</pre></div></div>`)));
app.use((req, res) => res.status(404).send(page('Not found', `<div class="wrap" style="padding-top:60px"><div class="panel">Page not found. <a href="/">Home</a></div></div>`)));

if (require.main === module) app.listen(process.env.PORT || 3014, () => console.log('SpecSentry on :' + (process.env.PORT || 3014)));
module.exports = app;
