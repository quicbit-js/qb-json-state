// Software License Agreement (ISC License)
//
// Copyright (c) 2017, Matthew Voss
//
// Permission to use, copy, modify, and/or distribute this software for
// any purpose with or without fee is hereby granted, provided that the
// above copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

var test = require('test-kit').tape()
var utf8 = require('qb-utf8-ez')
var next = require('qb-json-next')
var jstate = require('.')
var ECODE = next.ECODE
var POS = next.POS

function args2ps (args) {
  var i = 0
  var ret = jstate.obj2ps({
    src: null,
    next_src: null,
    lim: 0,
    vcount: args[i++],
    koff:   args[i++],
    klim:   args[i++],
    tok:    args[i++],
    voff:   args[i++],
    vlim:   args[i++],
    stack:  args[i++],
    pos:    args[i++],
    ecode:  args[i++],
  })
  ret.lim = ret.vlim
  return ret
}

function ps2args (ps) {
  var obj = jstate.ps2obj(ps)
  return [ obj.vcount, obj.koff, obj.klim, obj.tok, obj.voff, obj.vlim, obj.stack, obj.pos, obj.ecode ]
}

function assert_encode (args, exp, t) {
  var ps = args2ps(args)
  t.same(jstate.encode(ps), exp, t.desc('encode', args, exp))
  var ps_dec = jstate.decode(exp)
  var exp2 = ps2args(ps_dec)
  t.same(ps_dec, ps, t.desc('decode', [exp], exp2))
}

test('pos2char', function (t) {
  t.table_assert([
    [ 'pos',         'trunc',      'exp' ],
    [ 'O_BF',     1,      'FKK'  ],
    [ 'O_BK',     1,      'JKK'  ],
    [ 'O_AK',     0,      'L'  ],
    [ 'O_BV',     1,      'UVV'  ],
    [ 'O_AV',     0,      'W'  ],

    [ 'A_BF',     1,      'FVV'  ],
    [ 'A_BV',     1,      'UVV'  ],
    [ 'A_AV',     0,      'W'  ],
  ], function (pos, trunc) {
    var ret = jstate.pos2char(POS[pos], 0)
    if (trunc) {
      ret += jstate.pos2char(POS[pos], ECODE.TRUNCATED) + jstate.pos2char(POS[pos], ECODE.TRUNC_DEC)
    }
    return ret
  })
})

test('char2pos', function (t) {
  t.table_assert([
    [ 'char',   'stack',      'exp' ],
    [ null,    '{',           POS.A_BF  ],
    [ 'F',     '{',           POS.O_BF  ],
    [ 'J',     '{',           POS.O_BK  ],
    [ 'K',     '{',           POS.O_BK  ],
    [ 'L',     '{',           POS.O_AK  ],
    [ 'U',     '{',           POS.O_BV  ],
    [ 'V',     '{',           POS.O_BV  ],
    [ 'W',     '{',           POS.O_AV  ],
    [ 'F',     '[',           POS.A_BF  ],
    [ 'U',     '[',           POS.A_BV  ],
    [ 'V',     '[',           POS.A_BV  ],
    [ 'W',     '[',           POS.A_AV  ],
  ], function (char, stack) {
    return jstate.char2pos(char, stack.split('').map(function (c) { return c.charCodeAt(0) }))
  })
})

test('encode/decode object', function (t) {
  t.table_assert([
    [ 'vcount', 'koff', 'klim', 'tok',  'voff', 'vlim', 'stack',   'pos', 'ecode', 'exp'  ],
    [  3,        0,      0,     '',      5,      5,     '{',       'F',   '',       '5/3/{F' ],
    [  3,        0,      0,     '',      5,      5,     '[{',      'F',   '',       '5/3/[{F' ],
    [  3,        0,      0,     '',      5,      5,     '[{',      'F',   '',       '5/3/[{F' ],
    [  3,        0,      0,     '',      5,      5,     '[{',      'J',   '',       '5/3/[{J' ],
    [  3,        2,      5,     '',      5,      5,     '[{',      'J',   'T',      '5/3/[{K3' ],
    [  3,        2,      5,     '',      5,      5,     '{',       'L',   '',       '5/3/{L3' ],
    [  3,        2,      5,     '',      6,      6,     '{',       'L',   '',       '6/3/{L3.1' ],
    [  3,        2,      5,     '',      7,      7,     '{',       'L',   '',       '7/3/{L3.2' ],
    [  3,        2,      5,     '',      6,      6,     '{',       'U',   '',       '6/3/{U3' ],
    [  3,        2,      5,     '',      7,      7,     '{',       'U',   '',       '7/3/{U3.2' ],
    [  3,        2,      5,     '',      8,      8,     '{',       'U',   '',       '8/3/{U3.3' ],
    [  3,        2,      5,     '',      8,      9,     '{',       'U',   'T',      '9/3/{V3.3:1' ],
    [  3,        2,      5,     '',      6,      9,     '{',       'U',   'T',      '9/3/{V3:3' ],
    [  3,        0,      0,     '',     10,     10,     '{',       'W',   '',       '10/3/{W' ],

  ], function () {
    var args = Array.prototype.slice.call(arguments)
    var exp = args.pop()
    assert_encode(args, exp, t)
  }, {assert: 'none'})

  t.end()
})

test('encode/decode array', function (t) {
  t.table_assert([
    [ 'vcount', 'koff', 'klim', 'tok', 'voff', 'vlim', 'stack',  'pos', 'ecode', 'exp'  ],
    [  3,        0,      0,      '',   0,      0,      '[',      'F',   '',       '0/3/[F' ],
    [  3,        0,      0,      '',   1,      1,      '[',      'F',   '',       '1/3/[F' ],
    [  3,        0,      0,      '',   2,      2,      '[',      'U',   '',       '2/3/[U' ],
    [  3,        0,      0,      '',   2,      3,      '[',      'U',   'T',      '3/3/[V1' ],
    [  3,        0,      0,      '',   2,      4,      '[',      'U',   'T',      '4/3/[V2' ],
    [  3,        0,      0,      '',   4,      4,      '[',      'W',   '',       '4/3/[W' ],
  ], function () {
    var args = Array.prototype.slice.call(arguments)
    var exp = args.pop()
    assert_encode(args, exp, t)
  }, {assert: 'none'})

  t.end()
})

test('encode/decode root', function (t) {
  t.table_assert([
    [ 'vcount', 'koff', 'klim',  'tok', 'voff', 'vlim', 'stack',  'pos', 'ecode', 'exp'  ],
    [ 3,        0,      0,       '',    0,      0,      '',       'F',   '',       '0/3/F' ],
    [ 3,        0,      0,       '',    1,      1,      '',       'F',   '',       '1/3/F' ],
    [ 3,        0,      0,       '',    2,      2,      '',       'U',   '',       '2/3/U' ],
    [ 3,        0,      0,       '',    2,      3,      '',       'U',   'T',      '3/3/V1' ],
    [ 3,        0,      0,       '',    2,      4,      '',       'U',   'T',      '4/3/V2' ],
    [ 3,        0,      0,       '',    4,      4,      '',       'W',   '',       '4/3/W' ],
  ], function () {
    var args = Array.prototype.slice.call(arguments)
    var exp = args.pop()
    assert_encode(args, exp, t)
  }, {assert: 'none'})

  t.end()
})

test('error encoding', function (t) {
  t.table_assert([
    [ 'vcount', 'koff', 'klim', 'tok',  'voff', 'vlim', 'stack',   'pos', 'ecode', 'exp'  ],
    [  3,        2,      5,     '',    5,      5,      '{',       'J',   'B',     '5/3/{J3!B' ],
    // [  3,        2,      5,     '',    6,      7,      '{',       'L',   'U',     '5/3/{K3!U' ],

  ], function () {
    var args = Array.prototype.slice.call(arguments)
    var exp = args.pop()
    assert_encode(args, exp, t)
  }, {assert: 'none'})

  t.end()
})

test('decode errors', function (t) {
  t.table_assert([
    [ 's',   'exp' ],
    [ '5/3/{Q',  /could not decode/ ],
    [ '5/3/{Q',  /could not decode/ ],
  ], jstate.decode, {assert: 'throws'})
})

