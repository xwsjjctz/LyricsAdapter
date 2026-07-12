/**
 * QQ Music QRC (word-timed) lyrics decoder.
 *
 * QQ Music's `PlayLyricInfo.GetPlayLyricInfo` endpoint, when called with
 * `param.qrc = 1`, returns the word-timed lyric as a hex-encoded byte stream
 * that is: triple-DES encrypted (three fixed keys) then zlib-compressed. This
 * module reverses that to recover the plaintext QRC XML (the `<QrcInfos>`
 * document carrying per-word timings), which the renderer's `parseQrc` already
 * knows how to consume.
 *
 * The DES core (S-boxes, permutation tables, key schedule) is a direct
 * TypeScript port of the reference implementation at
 * https://github.com/TLittlePrince/qrcDecrypt (AGPL-3.0-or-later).
 *
 * LyricsAdapter is GPLv3; this file remains available under AGPL-3.0-or-later
 * to preserve the upstream licence requirements. The decoder is deliberately
 * main-process-only: the fixed keys never reach the renderer.
 */
import { inflateSync } from 'node:zlib';

// ── DES primitives (port of the public reference implementation) ──────────

type Schedule = number[][]; // 16 rounds × 6 subkey bytes

const KEY_SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const KEY_PERM_C = [
  56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17,
  9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
];
const KEY_PERM_D = [
  62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
  13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3,
];
const KEY_COMPRESSION = [
  13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9,
  22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
  40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47,
  43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
];

const S_BOX_1 = [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13];
const S_BOX_2 = [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9];
const S_BOX_3 = [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12];
const S_BOX_4 = [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14];
const S_BOX_5 = [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3];
const S_BOX_6 = [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13];
const S_BOX_7 = [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12];
const S_BOX_8 = [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11];

/** Extract bit `b` of the 64-bit `a` (a[0..7]) into position `c`. */
function bitNum(a: Uint8Array, b: number, c: number): number {
  const byteIndex = ((b / 32) | 0) * 4 + 3 - ((b % 32 / 8) | 0);
  const bitPosition = 7 - (b % 8);
  return ((a[byteIndex]! >> bitPosition) & 0x01) << c;
}

/** Right-side permutation bit extraction on a 32-bit int. */
function bitNumIntR(a: number, b: number, c: number): number {
  return ((a >>> (31 - b)) & 0x00000001) << c;
}

/** Left-side permutation bit extraction on a 32-bit int. */
function bitNumIntL(a: number, b: number, c: number): number {
  const extractedBit = ((a << b) & 0x80000000) >>> 0;
  return extractedBit >>> c;
}

/** Row/column packing for the 6→4 S-box lookup. */
function sBoxBit(a: number): number {
  return (a & 0x20) | ((a & 0x1f) >> 1) | ((a & 0x01) << 4);
}

function initialPermutation(state: number[], input: Uint8Array): void {
  state[0] = (
    bitNum(input, 57, 31) | bitNum(input, 49, 30) | bitNum(input, 41, 29) |
    bitNum(input, 33, 28) | bitNum(input, 25, 27) | bitNum(input, 17, 26) |
    bitNum(input, 9, 25) | bitNum(input, 1, 24) | bitNum(input, 59, 23) |
    bitNum(input, 51, 22) | bitNum(input, 43, 21) | bitNum(input, 35, 20) |
    bitNum(input, 27, 19) | bitNum(input, 19, 18) | bitNum(input, 11, 17) |
    bitNum(input, 3, 16) | bitNum(input, 61, 15) | bitNum(input, 53, 14) |
    bitNum(input, 45, 13) | bitNum(input, 37, 12) | bitNum(input, 29, 11) |
    bitNum(input, 21, 10) | bitNum(input, 13, 9) | bitNum(input, 5, 8) |
    bitNum(input, 63, 7) | bitNum(input, 55, 6) | bitNum(input, 47, 5) |
    bitNum(input, 39, 4) | bitNum(input, 31, 3) | bitNum(input, 23, 2) |
    bitNum(input, 15, 1) | bitNum(input, 7, 0)
  ) >>> 0;
  state[1] = (
    bitNum(input, 56, 31) | bitNum(input, 48, 30) | bitNum(input, 40, 29) |
    bitNum(input, 32, 28) | bitNum(input, 24, 27) | bitNum(input, 16, 26) |
    bitNum(input, 8, 25) | bitNum(input, 0, 24) | bitNum(input, 58, 23) |
    bitNum(input, 50, 22) | bitNum(input, 42, 21) | bitNum(input, 34, 20) |
    bitNum(input, 26, 19) | bitNum(input, 18, 18) | bitNum(input, 10, 17) |
    bitNum(input, 2, 16) | bitNum(input, 60, 15) | bitNum(input, 52, 14) |
    bitNum(input, 44, 13) | bitNum(input, 36, 12) | bitNum(input, 28, 11) |
    bitNum(input, 20, 10) | bitNum(input, 12, 9) | bitNum(input, 4, 8) |
    bitNum(input, 62, 7) | bitNum(input, 54, 6) | bitNum(input, 46, 5) |
    bitNum(input, 38, 4) | bitNum(input, 30, 3) | bitNum(input, 22, 2) |
    bitNum(input, 14, 1) | bitNum(input, 6, 0)
  ) >>> 0;
}

function inversePermutation(state: number[], output: Uint8Array): void {
  const l = state[0]!;
  const r = state[1]!;
  output[3] = (bitNumIntR(r, 7, 7) | bitNumIntR(l, 7, 6) | bitNumIntR(r, 15, 5) | bitNumIntR(l, 15, 4) | bitNumIntR(r, 23, 3) | bitNumIntR(l, 23, 2) | bitNumIntR(r, 31, 1) | bitNumIntR(l, 31, 0)) & 0xff;
  output[2] = (bitNumIntR(r, 6, 7) | bitNumIntR(l, 6, 6) | bitNumIntR(r, 14, 5) | bitNumIntR(l, 14, 4) | bitNumIntR(r, 22, 3) | bitNumIntR(l, 22, 2) | bitNumIntR(r, 30, 1) | bitNumIntR(l, 30, 0)) & 0xff;
  output[1] = (bitNumIntR(r, 5, 7) | bitNumIntR(l, 5, 6) | bitNumIntR(r, 13, 5) | bitNumIntR(l, 13, 4) | bitNumIntR(r, 21, 3) | bitNumIntR(l, 21, 2) | bitNumIntR(r, 29, 1) | bitNumIntR(l, 29, 0)) & 0xff;
  output[0] = (bitNumIntR(r, 4, 7) | bitNumIntR(l, 4, 6) | bitNumIntR(r, 12, 5) | bitNumIntR(l, 12, 4) | bitNumIntR(r, 20, 3) | bitNumIntR(l, 20, 2) | bitNumIntR(r, 28, 1) | bitNumIntR(l, 28, 0)) & 0xff;
  output[7] = (bitNumIntR(r, 3, 7) | bitNumIntR(l, 3, 6) | bitNumIntR(r, 11, 5) | bitNumIntR(l, 11, 4) | bitNumIntR(r, 19, 3) | bitNumIntR(l, 19, 2) | bitNumIntR(r, 27, 1) | bitNumIntR(l, 27, 0)) & 0xff;
  output[6] = (bitNumIntR(r, 2, 7) | bitNumIntR(l, 2, 6) | bitNumIntR(r, 10, 5) | bitNumIntR(l, 10, 4) | bitNumIntR(r, 18, 3) | bitNumIntR(l, 18, 2) | bitNumIntR(r, 26, 1) | bitNumIntR(l, 26, 0)) & 0xff;
  output[5] = (bitNumIntR(r, 1, 7) | bitNumIntR(l, 1, 6) | bitNumIntR(r, 9, 5) | bitNumIntR(l, 9, 4) | bitNumIntR(r, 17, 3) | bitNumIntR(l, 17, 2) | bitNumIntR(r, 25, 1) | bitNumIntR(l, 25, 0)) & 0xff;
  output[4] = (bitNumIntR(r, 0, 7) | bitNumIntR(l, 0, 6) | bitNumIntR(r, 8, 5) | bitNumIntR(l, 8, 4) | bitNumIntR(r, 16, 3) | bitNumIntR(l, 16, 2) | bitNumIntR(r, 24, 1) | bitNumIntR(l, 24, 0)) & 0xff;
}

/** The DES feistel function: expansion → key XOR → S-boxes → P-box. */
function feistel(state: number, key: number[]): number {
  // Expansion permutation → two 24-bit halves packed into 32-bit ints.
  const t1 = (
    bitNumIntL(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitNumIntL(state, 4, 5) |
    bitNumIntL(state, 3, 6) | ((state & 0x0f000000) >>> 3) | bitNumIntL(state, 8, 11) |
    bitNumIntL(state, 7, 12) | ((state & 0x00f00000) >>> 5) | bitNumIntL(state, 12, 17) |
    bitNumIntL(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitNumIntL(state, 16, 23)
  ) >>> 0;
  const t2 = (
    bitNumIntL(state, 15, 0) | ((state & 0x0000f000) << 15) | bitNumIntL(state, 20, 5) |
    bitNumIntL(state, 19, 6) | ((state & 0x00000f00) << 13) | bitNumIntL(state, 24, 11) |
    bitNumIntL(state, 23, 12) | ((state & 0x000000f0) << 11) | bitNumIntL(state, 28, 17) |
    bitNumIntL(state, 27, 18) | ((state & 0x0000000f) << 9) | bitNumIntL(state, 0, 23)
  ) >>> 0;

  const lrg = [
    (t1 >>> 24) & 0xff, (t1 >>> 16) & 0xff, (t1 >>> 8) & 0xff,
    (t2 >>> 24) & 0xff, (t2 >>> 16) & 0xff, (t2 >>> 8) & 0xff,
  ];
  for (let i = 0; i < 6; i++) lrg[i] = (lrg[i]! ^ key[i]!) & 0xff;

  // S-box substitution → 32-bit value.
  let next = (
    (S_BOX_1[sBoxBit(lrg[0]! >>> 2)]! << 28) |
    (S_BOX_2[sBoxBit(((lrg[0]! & 0x03) << 4) | (lrg[1]! >>> 4))]! << 24) |
    (S_BOX_3[sBoxBit(((lrg[1]! & 0x0f) << 2) | (lrg[2]! >>> 6))]! << 20) |
    (S_BOX_4[sBoxBit(lrg[2]! & 0x3f)]! << 16) |
    (S_BOX_5[sBoxBit(lrg[3]! >>> 2)]! << 12) |
    (S_BOX_6[sBoxBit(((lrg[3]! & 0x03) << 4) | (lrg[4]! >>> 4))]! << 8) |
    (S_BOX_7[sBoxBit(((lrg[4]! & 0x0f) << 2) | (lrg[5]! >>> 6))]! << 4) |
    S_BOX_8[sBoxBit(lrg[5]! & 0x3f)]!
  ) >>> 0;

  // P-box permutation.
  next = (
    bitNumIntL(next, 15, 0) | bitNumIntL(next, 6, 1) | bitNumIntL(next, 19, 2) |
    bitNumIntL(next, 20, 3) | bitNumIntL(next, 28, 4) | bitNumIntL(next, 11, 5) |
    bitNumIntL(next, 27, 6) | bitNumIntL(next, 16, 7) | bitNumIntL(next, 0, 8) |
    bitNumIntL(next, 14, 9) | bitNumIntL(next, 22, 10) | bitNumIntL(next, 25, 11) |
    bitNumIntL(next, 4, 12) | bitNumIntL(next, 17, 13) | bitNumIntL(next, 30, 14) |
    bitNumIntL(next, 9, 15) | bitNumIntL(next, 1, 16) | bitNumIntL(next, 7, 17) |
    bitNumIntL(next, 23, 18) | bitNumIntL(next, 13, 19) | bitNumIntL(next, 31, 20) |
    bitNumIntL(next, 26, 21) | bitNumIntL(next, 2, 22) | bitNumIntL(next, 8, 23) |
    bitNumIntL(next, 18, 24) | bitNumIntL(next, 12, 25) | bitNumIntL(next, 29, 26) |
    bitNumIntL(next, 5, 27) | bitNumIntL(next, 21, 28) | bitNumIntL(next, 10, 29) |
    bitNumIntL(next, 3, 30) | bitNumIntL(next, 24, 31)
  ) >>> 0;
  return next;
}

/**
 * Generate the 16 round subkeys. `decrypt` reverses the round order, which is
 * the only difference between encryption and decryption in this DES variant.
 */
function keySchedule(key: Uint8Array, decrypt: boolean): Schedule {
  const schedule: Schedule = Array.from({ length: 16 }, () => [0, 0, 0, 0, 0, 0]);
  let c = 0;
  let d = 0;
  for (let i = 0; i < 28; i++) {
    c |= bitNum(key, KEY_PERM_C[i]!, 31 - i);
    d |= bitNum(key, KEY_PERM_D[i]!, 31 - i);
  }
  c >>>= 0;
  d >>>= 0;
  for (let i = 0; i < 16; i++) {
    const shift = KEY_SHIFT[i]!;
    c = (((c << shift) | (c >>> (28 - shift))) & 0xfffffff0) >>> 0;
    d = (((d << shift) | (d >>> (28 - shift))) & 0xfffffff0) >>> 0;
    // Decryption subkeys are the reverse of encryption subkeys.
    const round = decrypt ? 15 - i : i;
    const sub: number[] = [0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 24; j++) {
      const k = (j / 8) | 0;
      sub[k] = sub[k]! | bitNumIntR(c, KEY_COMPRESSION[j]!, 7 - (j % 8));
    }
    for (let j = 24; j < 48; j++) {
      const k = (j / 8) | 0;
      sub[k] = sub[k]! | bitNumIntR(d, KEY_COMPRESSION[j]! - 27, 7 - (j % 8));
    }
    schedule[round] = sub;
  }
  return schedule;
}

function desCrypt(block: Uint8Array, schedule: Schedule): Uint8Array {
  const state = [0, 0];
  initialPermutation(state, block);
  for (let idx = 0; idx < 15; idx++) {
    const right = state[1]!;
    state[1] = (feistel(right, schedule[idx]!) ^ state[0]!) >>> 0;
    state[0] = right;
  }
  // Final round does not swap halves.
  state[0] = (feistel(state[1]!, schedule[15]!) ^ state[0]!) >>> 0;
  inversePermutation(state, block);
  return block;
}

/** ECB-mode DES over every 8-byte block; `decrypt` selects the key order. */
function desEcb(input: Buffer, key: Uint8Array, decrypt: boolean): Buffer {
  const schedule = keySchedule(key, decrypt);
  const output = Buffer.allocUnsafe(input.length);
  for (let i = 0; i < input.length; i += 8) {
    const block = new Uint8Array(input.subarray(i, i + 8));
    desCrypt(block, schedule);
    output.set(block, i);
  }
  return output;
}

// ── QRC triple-DES envelope ────────────────────────────────────────────────

const KEY_1 = Buffer.from('!@#)(NHLiuy*$%^&', 'latin1');
const KEY_2 = Buffer.from('123ZXC!@#)(*$%^&', 'latin1');
const KEY_3 = Buffer.from('!@#)(*$%^&abcDEF', 'latin1');

/**
 * Decode a QQ Music encrypted QRC lyric payload into its plaintext XML.
 *
 * Input is the hex string returned by `PlayLyricInfo` when `qrc === 1`. The
 * pipeline is: hex → D-DES(KEY1) → E-DES(KEY2) → D-DES(KEY3) → zlib inflate.
 * Throws on any malformed input so callers can fall back to line-level LRC.
 */
export function decryptQrc(hexLyric: string): string {
  if (hexLyric.length === 0 || hexLyric.length % 16 !== 0) {
    throw new Error('QRC payload length is not a multiple of a 16-char DES block');
  }
  const encrypted = Buffer.from(hexLyric, 'hex');
  if (encrypted.length === 0 || encrypted.length % 8 !== 0) {
    throw new Error('QRC ciphertext is not aligned to an 8-byte DES block');
  }
  // D-DES(KEY1) → E-DES(KEY2) → D-DES(KEY3)
  const decrypted = desEcb(desEcb(desEcb(encrypted, KEY_1, true), KEY_2, false), KEY_3, true);
  const inflated = inflateSync(decrypted);
  return inflated.toString('utf-8');
}
