/*
 * Json — reading a plugin payload, and building the answer.
 *
 * The payloads come from the page as JSON strings and the answers go back the same way.
 *
 * ArkTS has no dynamic typing: `any` and `unknown` are refused, and an object literal must
 * name a class or interface. JSON.parse() would hand back exactly the kind of value ArkTS
 * will not let loose in a program. So this reads the payload as text: it finds a field by
 * name and returns its value as a string, a number or a boolean, and it can hand back a
 * nested object or array as the raw JSON it already is.
 *
 * That last part is what keeps the plugins simple: a nested value the page sent can go
 * straight into the answer, unchanged, without ever being turned into an object.
 */

export class Json {
  private text: string = '';

  constructor(text: string) {
    this.text = text ? text : '';
  }

  /**
   * The raw JSON of a field, or undefined when the field is not there.
   *
   * A string comes back quoted and escaped; an object or an array comes back whole.
   */
  raw(name: string): string | undefined {
    const key: string = '"' + name + '"';
    let at: number = this.text.indexOf(key);
    while (at >= 0) {
      let i: number = at + key.length;
      while (i < this.text.length && this.isSpace(this.text.charAt(i))) {
        i++;
      }
      if (i < this.text.length && this.text.charAt(i) === ':') {
        i++;
        while (i < this.text.length && this.isSpace(this.text.charAt(i))) {
          i++;
        }
        return this.readValue(i);
      }
      at = this.text.indexOf(key, at + 1);
    }
    return undefined;
  }

  /** A string field, or the fallback. */
  str(name: string, fallback: string = ''): string {
    const v: string | undefined = this.raw(name);
    if (v === undefined || v.length === 0 || v.charAt(0) !== '"') {
      return fallback;
    }
    // Strip the quotes and unescape.
    return this.unescape(v.substring(1, v.length - 1));
  }

  /** A number field, or the fallback. */
  num(name: string, fallback: number = 0): number {
    const v: string | undefined = this.raw(name);
    if (v === undefined || v.length === 0) {
      return fallback;
    }
    const n: number = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** A boolean field, or the fallback. */
  bool(name: string, fallback: boolean = false): boolean {
    const v: string | undefined = this.raw(name);
    if (v === undefined) {
      return fallback;
    }
    if (v === 'true') {
      return true;
    }
    if (v === 'false') {
      return false;
    }
    return fallback;
  }

  /** Whether the field is there at all. */
  has(name: string): boolean {
    return this.raw(name) !== undefined;
  }

  /**
   * The names of the fields of this object.
   *
   * A JSON object's keys are found by walking its text: every "name" that is followed by a
   * colon is a key. That is enough for the flat maps the app sends.
   */
  keys(): string[] {
    const out: string[] = [];
    let i: number = 0;
    while (i < this.text.length) {
      const c: string = this.text.charAt(i);
      if (c !== '"') {
        i++;
        continue;
      }
      const key: string | undefined = this.readString(i);
      if (key === undefined) {
        break;
      }
      let j: number = i + key.length;
      while (j < this.text.length && this.isSpace(this.text.charAt(j))) {
        j++;
      }
      if (j < this.text.length && this.text.charAt(j) === ':') {
        out.push(key.substring(1, key.length - 1));
      }
      i += key.length;
    }
    return out;
  }

  /**
   * The elements of an array field, each as its raw JSON.
   * A plain list of objects (the notification list, the file list) is what the app sends.
   */
  arrItems(name: string): string[] {
    const out: string[] = [];
    const v: string | undefined = this.raw(name);
    if (v === undefined || v.length === 0 || v.charAt(0) !== '[') {
      return out;
    }
    let i: number = 1;
    const end: number = v.length - 1;
    while (i < end) {
      const c: string = v.charAt(i);
      if (this.isSpace(c)) {
        i++;
        continue;
      }
      if (c === ',') {
        i++;
        continue;
      }
      const item: string | undefined = this.readValue(i);
      if (item === undefined) {
        break;
      }
      out.push(item);
      i += item.length;
    }
    return out;
  }

  /** How many elements an array field has. */
  arrLen(name: string): number {
    return this.arrItems(name).length;
  }

  /**
   * The numbers of an array field.
   * The scanner's format list is the only one: a short list of plain integers.
   */
  numList(name: string): number[] {
    const out: number[] = [];
    const items: string[] = this.arrItems(name);
    for (let i = 0; i < items.length; i++) {
      const n: number = Number(items[i]);
      if (Number.isFinite(n)) {
        out.push(n);
      }
    }
    return out;
  }

  /** The value that starts at `at`, as raw JSON. */
  private readValue(at: number): string | undefined {
    if (at >= this.text.length) {
      return undefined;
    }
    const c: string = this.text.charAt(at);
    if (c === '"') {
      return this.readString(at);
    }
    if (c === '{' || c === '[') {
      return this.readNested(at);
    }
    // A number, a boolean or null: up to the next comma or closing bracket.
    let i: number = at;
    while (i < this.text.length) {
      const ch: string = this.text.charAt(i);
      if (ch === ',' || ch === '}' || ch === ']' || this.isSpace(ch)) {
        break;
      }
      i++;
    }
    const literal: string = this.text.substring(at, i);
    return literal.length > 0 ? literal : undefined;
  }

  /** A quoted string, starting at the opening quote. */
  private readString(at: number): string | undefined {
    let i: number = at + 1;
    let out: string = '"';
    while (i < this.text.length) {
      const c: string = this.text.charAt(i);
      if (c === '\\') {
        out += c;
        if (i + 1 < this.text.length) {
          out += this.text.charAt(i + 1);
        }
        i += 2;
        continue;
      }
      if (c === '"') {
        return out + '"';
      }
      out += c;
      i++;
    }
    return undefined;
  }

  /** An object or an array, starting at its opening bracket. */
  private readNested(at: number): string | undefined {
    const open: string = this.text.charAt(at);
    const close: string = open === '{' ? '}' : ']';
    let depth: number = 0;
    let i: number = at;
    while (i < this.text.length) {
      const c: string = this.text.charAt(i);
      if (c === '"') {
        const s: string | undefined = this.readString(i);
        if (s === undefined) {
          return undefined;
        }
        i += s.length;
        continue;
      }
      if (c === '{' || c === '[') {
        depth++;
      } else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          return this.text.substring(at, i + 1);
        }
      }
      i++;
    }
    return undefined;
  }

  private isSpace(c: string): boolean {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r';
  }

  /** Undo the escapes a JSON string carries. */
  private unescape(s: string): string {
    let out: string = '';
    let i: number = 0;
    while (i < s.length) {
      const c: string = s.charAt(i);
      if (c === '\\' && i + 1 < s.length) {
        const next: string = s.charAt(i + 1);
        if (next === 'n') { out += '\n'; i += 2; continue; }
        if (next === 'r') { out += '\r'; i += 2; continue; }
        if (next === 't') { out += '\t'; i += 2; continue; }
        if (next === 'u') {
          const hex: string = s.substring(i + 2, i + 6);
          const code: number = parseInt(hex, 16);
          if (Number.isFinite(code)) {
            out += String.fromCharCode(code);
            i += 6;
            continue;
          }
        }
        out += next;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  /** Escape a string so it can go into a JSON string value. */
  static esc(value: string): string {
    if (!value) {
      return '';
    }
    let out: string = value.replace(/\\/g, '\\\\');
    out = out.replace(/"/g, '\\"');
    out = out.replace(/\n/g, '\\n');
    out = out.replace(/\r/g, '\\r');
    out = out.replace(/\t/g, '\\t');
    return out;
  }

  /** A JSON string value, quoted and escaped. */
  static str(value: string): string {
    return '"' + Json.esc(value) + '"';
  }

  /** A JSON object built from key/value pairs whose values are already JSON. */
  static build(pairs: string[]): string {
    return '{' + pairs.join(',') + '}';
  }

  /** The shape the bridge uses for a failure. */
  static error(message: string): string {
    return '{"__error":' + Json.str(message) + '}';
  }
}
