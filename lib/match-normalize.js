// lib/match-normalize.js — Name/zip/address normalization + salted SHA-256,
// ported verbatim from matchbook (voter_match/normalize.py + hashing.py).
//
// CRITICAL: the exact same algorithm runs in the browser (inlined in
// public/match.html). If you change anything here, change it there too —
// client and server hashes must match bit-for-bit or nothing matches.

import { createHash } from 'node:crypto';

const COMBINING = /[̀-ͯ]/g;
const NON_ALNUM = /[^a-z0-9]/g;
const NON_DIGIT = /\D+/g;
const EXT_RE = /\s*(?:x|ext\.?|extension)\s*\d+\s*$/i;

export function normalizePhoneE164(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(EXT_RE, '');
  const hasPlus = s.startsWith('+');
  const digits = s.replace(NON_DIGIT, '');
  if (!digits) return null;
  if (hasPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return '+' + digits;
  }
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length >= 11 && digits.length <= 15) return '+' + digits;
  return null;
}

const ADDR_WORDS = [
  [/\bstreet\b/g, 'st'],
  [/\bavenue\b/g, 'ave'],
  [/\bboulevard\b/g, 'blvd'],
  [/\broad\b/g, 'rd'],
  [/\bdrive\b/g, 'dr'],
  [/\blane\b/g, 'ln'],
  [/\bcourt\b/g, 'ct'],
  [/\bapartment\b/g, 'apt'],
];

export function normalizeName(s) {
  if (!s) return '';
  s = String(s).normalize('NFKD').toLowerCase();
  s = s.replace(COMBINING, '');
  return s.replace(NON_ALNUM, '').trim();
}

export function normalizeZip(s) {
  if (!s) return '';
  return String(s).replace(NON_DIGIT, '').slice(0, 5);
}

export function normalizeAddress(s) {
  if (!s) return '';
  s = String(s).toLowerCase();
  for (const [pat, repl] of ADDR_WORDS) s = s.replace(pat, repl);
  return s.replace(NON_ALNUM, '').trim();
}

function sha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

export function saltedHash(salt, value) {
  return sha256Hex(`${salt}|${value}`);
}

// Hash string formats (matchbook-compatible; `name:` is a walk addition
// for the no-phone, name-only low-confidence tier).
export function nameHash(salt, first, last) {
  return saltedHash(salt, `name:${normalizeName(first)}:${normalizeName(last)}`);
}
export function nameZipHash(salt, first, last, zip) {
  return saltedHash(salt, `namezip:${normalizeName(first)}:${normalizeName(last)}:${normalizeZip(zip)}`);
}
export function nameAddrHash(salt, first, last, addr) {
  return saltedHash(salt, `nameaddr:${normalizeName(first)}:${normalizeName(last)}:${normalizeAddress(addr)}`);
}

// ============================================================================
// Generous variant matching. Hashes are exact-only, so "fuzzy" matching is
// done by generating MANY hashed variants per person; any shared hash is a
// candidate. The volunteer confirms each, so high recall is the goal.
//
// CRITICAL: NICKNAMES, soundex(), and personHashes() are duplicated
// verbatim in public/match.html. Change both together or matching breaks.
// ============================================================================

// Common US given-name nicknames -> canonical. One direction is enough:
// everyone expands to {self, canonical(self)}, so Bob<->Robert collide on
// the shared "robert".
const NICKNAMES = {
  bob: 'robert', bobby: 'robert', rob: 'robert', robbie: 'robert',
  bill: 'william', billy: 'william', will: 'william', willie: 'william',
  jim: 'james', jimmy: 'james', jamie: 'james',
  jack: 'john', johnny: 'john', jon: 'john',
  mike: 'michael', mikey: 'michael', mick: 'michael',
  rick: 'richard', ricky: 'richard', dick: 'richard', rich: 'richard',
  dave: 'david', davey: 'david',
  dan: 'daniel', danny: 'daniel',
  tom: 'thomas', tommy: 'thomas',
  tony: 'anthony', ant: 'anthony',
  chris: 'christopher', topher: 'christopher',
  steve: 'steven', stevie: 'steven', stephen: 'steven',
  joe: 'joseph', joey: 'joseph',
  ed: 'edward', eddie: 'edward', ned: 'edward', ted: 'edward',
  ken: 'kenneth', kenny: 'kenneth',
  greg: 'gregory',
  jeff: 'jeffrey',
  larry: 'lawrence',
  matt: 'matthew',
  nate: 'nathaniel', nathan: 'nathaniel',
  pat: 'patrick', patty: 'patricia',
  sam: 'samuel', sammy: 'samuel',
  tim: 'timothy',
  andy: 'andrew', drew: 'andrew',
  ben: 'benjamin', benny: 'benjamin',
  charlie: 'charles', chuck: 'charles', chas: 'charles',
  frank: 'franklin', frankie: 'franklin',
  fred: 'frederick', freddie: 'frederick',
  gabe: 'gabriel',
  hank: 'henry', harry: 'henry',
  nick: 'nicholas',
  phil: 'philip',
  ron: 'ronald', ronnie: 'ronald',
  sal: 'salvatore',
  vinny: 'vincent', vince: 'vincent',
  walt: 'walter',
  zach: 'zachary', zack: 'zachary',
  abby: 'abigail',
  ali: 'alison', allie: 'alison',
  becky: 'rebecca',
  beth: 'elizabeth', betsy: 'elizabeth', betty: 'elizabeth',
  liz: 'elizabeth', lizzy: 'elizabeth', eliza: 'elizabeth', libby: 'elizabeth',
  cathy: 'catherine', kate: 'catherine', katie: 'catherine', kathy: 'catherine',
  cat: 'catherine', katherine: 'catherine', kathryn: 'catherine',
  cindy: 'cynthia',
  deb: 'deborah', debbie: 'deborah',
  dee: 'deanna',
  ellie: 'eleanor', nell: 'eleanor',
  fran: 'frances', francie: 'frances',
  gail: 'abigail',
  ginny: 'virginia',
  jan: 'janet',
  jen: 'jennifer', jenny: 'jennifer', jenn: 'jennifer',
  jess: 'jessica', jessie: 'jessica',
  jo: 'joanne',
  josie: 'josephine',
  judy: 'judith',
  julie: 'julia',
  kim: 'kimberly',
  laurie: 'laura',
  lily: 'lillian',
  lori: 'lorraine',
  maggie: 'margaret', meg: 'margaret', peggy: 'margaret', marge: 'margaret',
  mandy: 'amanda',
  mel: 'melissa', missy: 'melissa',
  nan: 'nancy',
  pam: 'pamela',
  trish: 'patricia', tricia: 'patricia',
  sandy: 'sandra',
  sue: 'susan', susie: 'susan', suzy: 'susan',
  terri: 'theresa', terry: 'theresa', tess: 'theresa',
  tina: 'christina', chrissy: 'christina',
  val: 'valerie',
  vicky: 'victoria', vickie: 'victoria',
  wendy: 'gwendolyn',
};

export function canonicalFirst(n) {
  return Object.prototype.hasOwnProperty.call(NICKNAMES, n) ? NICKNAMES[n] : n;
}

// Standard American Soundex (letter + 3 digits).
export function soundex(s) {
  s = String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return '';
  const code = (ch) => {
    if ('BFPV'.includes(ch)) return '1';
    if ('CGJKQSXZ'.includes(ch)) return '2';
    if ('DT'.includes(ch)) return '3';
    if (ch === 'L') return '4';
    if ('MN'.includes(ch)) return '5';
    if (ch === 'R') return '6';
    return '';
  };
  let out = s[0];
  let prev = code(s[0]);
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = code(s[i]);
    if (c && c !== prev) out += c;
    if (s[i] !== 'H' && s[i] !== 'W') prev = c;
  }
  return (out + '000').slice(0, 4);
}

const HIGH = 3, MED = 2, LOW = 1;
export const CONF_LABEL = { 3: 'high', 2: 'medium', 1: 'low' };

// person: { first, last, zip, addr } (raw). Returns deduped
// [{ h, conf }] keeping the strongest conf per hash.
export function personHashes(salt, person) {
  const nf = normalizeName(person.first);
  const nl = normalizeName(person.last);
  const nz = normalizeZip(person.zip);
  const na = normalizeAddress(person.addr);
  const cf = canonicalFirst(nf);
  const fi = nf.slice(0, 1);
  const sf = soundex(nf);
  const sl = soundex(nl);

  const specs = [];
  const add = (cond, conf, value) => { if (cond) specs.push([conf, value]); };

  // Strong: a full name plus an address or zip anchor.
  add(nf && nl && na, HIGH, `nameaddr:${nf}:${nl}:${na}`);
  add(cf && nl && na, HIGH, `nameaddr:${cf}:${nl}:${na}`);
  add(nf && nl && nz, HIGH, `namezip:${nf}:${nl}:${nz}`);
  add(cf && nl && nz, HIGH, `namezip:${cf}:${nl}:${nz}`);

  // Medium: full name (incl. nickname-normalized and transposed), or
  // last name + zip.
  add(nf && nl, MED, `name:${nf}:${nl}`);
  add(cf && nl, MED, `name:${cf}:${nl}`);
  add(nf && nl, MED, `name:${nl}:${nf}`);            // first/last swapped
  add(nl && nz, MED, `lastzip:${nl}:${nz}`);

  // Low (noisy — volunteer confirms): initial+last, phonetic, last-only.
  add(fi && nl, LOW, `filast:${fi}:${nl}`);
  add(sf && sl, LOW, `phon:${sf}:${sl}`);
  add(sl && nz, LOW, `phonzip:${sl}:${nz}`);
  // Fuzzy first+last: typo in ONE name, the other anchored exactly.
  add(sf && nl, LOW, `sfln:${sf}:${nl}`);
  add(nf && sl, LOW, `nfsl:${nf}:${sl}`);
  add(cf && sl, LOW, `cfsl:${cf}:${sl}`);
  add(fi && sl, LOW, `fisl:${fi}:${sl}`);
  // Last-name prefix anchored by first — bridges trailing typos /
  // suffix differences (Smith/Smithe, Aarona/Aaronx) Soundex misses.
  const lp = nl.slice(0, 4);
  add(nf && nl.length >= 4, LOW, `pfx:${nf}:${lp}`);
  add(cf && nl.length >= 4, LOW, `pfx:${cf}:${lp}`);
  add(fi && nl.length >= 4, LOW, `pfxi:${fi}:${lp}`);
  add(nl, LOW, `lastonly:${nl}`);

  const best = new Map();
  for (const [conf, value] of specs) {
    const h = saltedHash(salt, value);
    if (!best.has(h) || best.get(h) < conf) best.set(h, conf);
  }
  return [...best.entries()].map(([h, conf]) => ({ h, conf }));
}
