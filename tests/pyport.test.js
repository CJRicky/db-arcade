// PyRandom and the Python number helpers against values written by CPython.
import { test, assert } from "./harness.js";
import { F } from "./fixtures.js";
import { PyRandom, pyFixed, pyRound, pyRoundInt, pyMod, pySum, pow10 } from "../web/js/pyport.js";

test("PyRandom reproduces random.Random for int seeds (random, randint, randrange, choice, shuffle, getrandbits)", () => {
  for (const { seed, seq } of F.rng) {
    const r = new PyRandom(seed);
    seq.forEach((step, i) => {
      const [op] = step;
      let got;
      let want;
      if (op === "random") [got, want] = [r.random(), step[1]];
      else if (op === "randint") [got, want] = [r.randint(step[1], step[2]), step[3]];
      else if (op === "randrange") [got, want] = [r.randrange(step[1], step[2], step[3]), step[4]];
      else if (op === "choice") [got, want] = [r.choice([...Array(step[1]).keys()]), step[2]];
      else if (op === "shuffle") {
        const x = [...Array(step[1]).keys()];
        r.shuffle(x);
        [got, want] = [x, step[2]];
      } else [got, want] = [r.getrandbits(step[1]), step[2]];
      assert.deepEqual(got, want, `seed ${seed} step ${i} ${op}`);
    });
  }
});

test("unseeded PyRandom gives different streams", () => {
  assert.ok(new PyRandom().random() !== new PyRandom().random());
});

test("pyFixed / pyRound / pyRoundInt match Python formatting and round()", () => {
  for (const row of F.format) {
    const x = row.x;
    const got = [pyFixed(x, 0), pyFixed(x, 1), pyFixed(x, 2), (pyFixed(x, 1).startsWith("-") ? "" : "+") + pyFixed(x, 1)];
    assert.deepEqual(got, row.fixed, `x=${x}`);
    assert.deepEqual([pyRound(x, 1), pyRound(x, 2)], row.round, `round x=${x}`);
    assert.equal(pyRoundInt(x), row.round0, `round0 x=${x}`);
  }
});

test("pyFixed works for every finite double (toFixed throws above 100 digits)", () => {
  assert.equal(pyFixed(1e-200, 203).length, 205);
  assert.equal(pyFixed(5e-324, 2), "0.00");
  assert.equal(pyFixed(1e21, 0), "1000000000000000000000");
  assert.equal(pyFixed(-0.0, 1), "-0.0");
  assert.equal(pyFixed(Number.MAX_VALUE, 0).length, 309);
});

test("ties go to even, like Python", () => {
  assert.equal(pyFixed(0.125, 2), "0.12");      // exactly representable tie
  assert.equal(pyFixed(0.375, 2), "0.38");
  assert.equal(pyFixed(2.5, 0), "2");
  assert.equal(pyFixed(-2.5, 0), "-2");
  assert.equal(pyFixed(2.675, 2), "2.67");      // binary value is below the tie
  assert.equal(pyRoundInt(-2.5), -2);
  assert.equal(pyRoundInt(3.5), 4);
});

test("pyMod is floor modulo, pow10 is exact for whole exponents, pySum compensates", () => {
  assert.equal(pyMod(-17, 10), 3);
  assert.equal(pyMod(-20, 10), 0);
  assert.equal(pyMod(23, 10), 3);
  assert.equal(pow10(-5), 1e-5);
  assert.equal(pow10(-30), 1e-30);
  assert.equal(pow10(3), 1000);
  assert.equal(pySum([0.1, 0.2, 0.3]), 0.6);    // plain left-to-right addition gives 0.6000000000000001
  assert.equal(pySum([]), 0);
});
