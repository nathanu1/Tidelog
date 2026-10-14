// Quick-entry parser. Turns a line like
//   "45m deep work on the renderer @work #focus #art !4 ~5"
// into { title, duration_min, category, tags, intensity, mood }.
//
// Tokens:  45m | 1h | 1h30m | 90min   duration
//          @work                      category (slug or name prefix)
//          #tag                       tags (any number)
//          !1..5                      intensity
//          ~1..5                      mood
// Anything else becomes the title. Category is inferred from keywords when no @ token is given.

const KEYWORDS = {
  exercise: ['run', 'ran', 'jog', 'gym', 'lift', 'workout', 'yoga', 'swim', 'bike', 'cycling', 'walk', 'hike', 'stretch', 'climb', 'cardio', 'pushups', 'training'],
  learning: ['read', 'reading', 'study', 'studied', 'course', 'lecture', 'tutorial', 'book', 'learn', 'learned', 'research', 'paper', 'flashcards', 'lesson'],
  work: ['work', 'meeting', 'standup', 'code', 'coding', 'coded', 'debug', 'deploy', 'review', 'pr', 'email', 'emails', 'ship', 'shipped', 'client', 'spec', 'planning', 'sprint', 'ticket', 'commit', 'refactor', 'interview'],
  creative: ['write', 'wrote', 'writing', 'draw', 'drew', 'sketch', 'paint', 'music', 'guitar', 'piano', 'design', 'compose', 'photo', 'photography', 'edit', 'video', 'art', 'journal', 'poem'],
  social: ['dinner', 'lunch', 'coffee', 'friends', 'friend', 'family', 'call', 'called', 'party', 'date', 'hangout', 'visit', 'chat', 'game night', 'drinks'],
  rest: ['nap', 'sleep', 'slept', 'rest', 'meditate', 'meditation', 'breathe', 'relax', 'bath', 'chill', 'break', 'tv', 'movie', 'show', 'podcast', 'music listening'],
  admin: ['chores', 'clean', 'cleaning', 'laundry', 'dishes', 'groceries', 'shopping', 'errand', 'errands', 'bills', 'taxes', 'cook', 'cooked', 'cooking', 'organize', 'tidy', 'commute', 'drive', 'appointment', 'doctor'],
};

const DURATION_RE = /(?:^|\s)(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d+)\s*m(?:in(?:utes?)?)?)?|(\d+)\s*m(?:in(?:utes?)?)?)(?=\s|$)/i;

export function parseQuick(text, categories = []) {
  const out = { title: '', duration_min: null, category: null, tags: [], intensity: null, mood: null };
  if (typeof text !== 'string') return out;
  let rest = text.trim();

  // duration
  const d = rest.match(DURATION_RE);
  if (d) {
    if (d[1] !== undefined) {
      out.duration_min = Math.round(parseFloat(d[1]) * 60 + (d[2] ? parseInt(d[2], 10) : 0));
    } else if (d[3] !== undefined) {
      out.duration_min = parseInt(d[3], 10);
    }
    rest = (rest.slice(0, d.index) + ' ' + rest.slice(d.index + d[0].length)).trim();
  }

  // tags
  rest = rest.replace(/(?:^|\s)#([\w-]{1,30})/g, (_, tag) => {
    const t = tag.toLowerCase();
    if (!out.tags.includes(t)) out.tags.push(t);
    return ' ';
  });

  // intensity / mood
  rest = rest.replace(/(?:^|\s)!([1-5])(?=\s|$)/g, (_, n) => { out.intensity = parseInt(n, 10); return ' '; });
  rest = rest.replace(/(?:^|\s)~([1-5])(?=\s|$)/g, (_, n) => { out.mood = parseInt(n, 10); return ' '; });

  // category
  rest = rest.replace(/(?:^|\s)@([\w-]{1,40})/g, (_, raw) => {
    out.category = matchCategory(raw, categories);
    return ' ';
  });

  out.title = rest.replace(/\s+/g, ' ').trim();
  if (!out.category) out.category = inferCategory(out.title, categories);
  return out;
}

export function matchCategory(raw, categories = []) {
  const q = String(raw).toLowerCase();
  const slugs = categories.length ? categories : Object.keys(KEYWORDS).map((slug) => ({ slug, name: slug }));
  const exact = slugs.find((c) => c.slug === q || String(c.name).toLowerCase() === q);
  if (exact) return exact.slug;
  const prefix = slugs.find((c) => c.slug.startsWith(q) || String(c.name).toLowerCase().startsWith(q));
  return prefix ? prefix.slug : q;
}

export function inferCategory(title, categories = []) {
  const words = String(title).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return null;
  const available = categories.length ? new Set(categories.map((c) => c.slug)) : null;
  let best = null;
  let bestScore = 0;
  for (const [slug, keys] of Object.entries(KEYWORDS)) {
    if (available && !available.has(slug)) continue;
    let score = 0;
    for (const k of keys) {
      if (k.includes(' ')) { if (String(title).toLowerCase().includes(k)) score += 2; }
      else if (words.includes(k)) score += 1;
    }
    if (score > bestScore) { best = slug; bestScore = score; }
  }
  return best;
}

export const QUICK_HELP = '45m deep work @work #focus !4 ~5  →  45 min · Work · #focus · intensity 4 · mood 5';
