// The text of a JavaScript module with its comments blanked, for the tests that read a module's imports by pattern. A
// comment is replaced by spaces and every line break is kept, so a line keeps its number and a statement a comment sat
// inside is still one statement. What a string, a template literal or a regular expression holds is left whole, so
// "//" in a URL or a quote inside a pattern is no comment and no string.

// A word after which a slash starts a regular expression rather than divides.
const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'delete', 'throw', 'new', 'instanceof', 'yield', 'await']);
const WORD = /[\w$]/;

export function withoutComments(text) {
  const src = String(text);
  const n = src.length;
  let out = '';
  let i = 0;
  // The last character that is neither blank nor in a comment, and the word it ends: a slash after a name, a number, a
  // closing parenthesis or a closing bracket divides; after anything else (but a keyword's word) it opens a pattern.
  let last = '';
  let word = '';
  let spaced = false;

  const blank = (from, to) => { for (let k = from; k < to; k += 1) out += src[k] === '\n' || src[k] === '\r' ? src[k] : ' '; };
  const skipQuoted = (quote) => {
    const start = i;
    i += 1;
    while (i < n && src[i] !== quote && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
    i = Math.min(i + 1, n);
    out += src.slice(start, i);
  };
  const skipTemplate = () => {
    out += src[i];
    i += 1;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        scan(true);
        continue;
      }
      out += src[i];
      i += 1;
    }
    if (i < n) { out += '`'; i += 1; }
  };
  const skipPattern = () => {
    let k = i + 1;
    let inClass = false;
    while (k < n && src[k] !== '\n') {
      if (src[k] === '\\') k += 2;
      else if (src[k] === '[') { inClass = true; k += 1; } else if (src[k] === ']') { inClass = false; k += 1; } else if (src[k] === '/' && !inClass) break;
      else k += 1;
    }
    if (k >= n || src[k] !== '/') return false;
    k += 1;
    while (k < n && /[a-z]/i.test(src[k])) k += 1;
    out += src.slice(i, k);
    i = k;
    return true;
  };

  // Code up to the end of the text, or, inside a template's ${ }, to its closing brace.
  function scan(inTemplate) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '/' && d === '/') { const from = i; while (i < n && src[i] !== '\n') i += 1; blank(from, i); continue; }
      if (c === '/' && d === '*') {
        const from = i;
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
        i = Math.min(i + 2, n);
        blank(from, i);
        continue;
      }
      if (c === '"' || c === '\'') { skipQuoted(c); last = c; word = ''; continue; }
      if (c === '`') { skipTemplate(); last = c; word = ''; continue; }
      if (c === '/') {
        const divides = (WORD.test(last) && !BEFORE_REGEX.has(word)) || last === ')' || last === ']';
        if (!divides && skipPattern()) { last = '/'; word = ''; continue; }
      }
      if (inTemplate) {
        if (c === '{') depth += 1;
        else if (c === '}') {
          if (depth === 0) { out += c; i += 1; return; }
          depth -= 1;
        }
      }
      out += c;
      i += 1;
      if (/\s/.test(c)) { spaced = true; continue; }
      if (WORD.test(c)) word = !spaced && WORD.test(last) ? word + c : c;
      else word = '';
      spaced = false;
      last = c;
    }
  }

  scan(false);
  return out;
}
