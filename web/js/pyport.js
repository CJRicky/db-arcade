// Python semantics the port of db_core.py depends on.
//
// PyRandom is CPython's Mersenne Twister with the random.Random methods the question
// generators call, so a seeded JS game asks exactly the questions Python asks.
// The number helpers reproduce Python's round-half-even formatting ("{:.2f}", round())
// and floor modulo, which differ from toFixed / Math.round / % for ties and negatives.

const N = 624;
const M = 397;

export class PyRandom {
  /** seed: non-negative integer as in random.Random(seed), or omitted for a random seed. */
  constructor(seed) {
    this.mt = new Uint32Array(N);
    this.mti = N;
    if (seed === undefined || seed === null) {
      this.initByArray(Array.from(crypto.getRandomValues(new Uint32Array(N))));
    } else {
      // random.Random(int): the absolute value split into 32-bit words, least significant first
      let n = Math.abs(Math.trunc(seed));
      const key = [];
      do {
        key.push(n % 4294967296);
        n = Math.floor(n / 4294967296);
      } while (n > 0);
      this.initByArray(key);
    }
  }

  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
    }
    this.mti = N;
  }

  initByArray(key) {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const s = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(s, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const s = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(s, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  uint32() {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0;
      let y;
      for (; kk < N - M; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** Float in [0, 1) with 53 random bits, as random.random(). */
  random() {
    const a = this.uint32() >>> 5;
    const b = this.uint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** k random bits, 1 <= k <= 32. */
  getrandbits(k) {
    return this.uint32() >>> (32 - k);
  }

  randbelow(n) {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  randrange(start, stop, step = 1) {
    const width = stop - start;
    if (step === 1) {
      if (width <= 0) throw new RangeError("empty range for randrange");
      return start + this.randbelow(width);
    }
    const n = Math.floor((width + step - 1) / step);
    if (step <= 0 || n <= 0) throw new RangeError("empty range for randrange");
    return start + step * this.randbelow(n);
  }

  randint(a, b) {
    return this.randrange(a, b + 1);
  }

  choice(seq) {
    return seq[this.randbelow(seq.length)];
  }

  shuffle(x) {
    for (let i = x.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      [x[i], x[j]] = [x[j], x[i]];
    }
  }
}

/** [mantissa, exponent] with |x| = mantissa * 2 ** exponent exactly (x finite). */
function decompose(x) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0);
  const exp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(view.getUint32(4));
  if (exp === 0) return [mant, -1074];      // subnormal
  mant |= 1n << 52n;
  return [mant, exp - 1075];
}

/**
 * Python "{:.<d>f}".format(x): the exact binary value rounded to d decimals, ties to even.
 * (toFixed sends ties away from zero, switches to exponent notation from 1e21 and stops at 100 digits.)
 */
export function pyFixed(x, d) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const neg = x < 0 || Object.is(x, -0);
  const [mant, e] = decompose(x);
  // |x| * 10^d as the fraction num / den, then round to an integer
  let num = mant * 10n ** BigInt(d);
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  let q = num / den;
  const twice = 2n * (num % den);
  if (twice > den || (twice === den && (q & 1n))) q += 1n;
  let s = q.toString();
  if (d > 0) {
    s = s.padStart(d + 1, "0");
    s = s.slice(0, -d) + "." + s.slice(-d);
  }
  return (neg ? "-" : "") + s;
}

/** Python round(x, nd) for a float. */
export function pyRound(x, nd) {
  return Number(pyFixed(x, nd));
}

/** Python round(x) for a float: nearest integer, ties to even. */
export function pyRoundInt(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Python a % b for b > 0 (result has the sign of b). */
export function pyMod(a, b) {
  return ((a % b) + b) % b;
}

/** 10 ** x, exact (correctly rounded) for whole exponents like Python's 10.0 ** e. */
export function pow10(x) {
  return Number.isInteger(x) ? Number("1e" + x) : Math.pow(10, x);
}

/** Python sum() of floats (3.12+ uses Neumaier compensated summation). */
export function pySum(values) {
  let s = 0;
  let c = 0;
  for (const x of values) {
    const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s;
    s = t;
  }
  return c && Number.isFinite(c) ? s + c : s;
}
