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
var jstate = require('.')
var TOK = jstate.TOK
var ECODE = jstate.ECODE
var POS = jstate.POS

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
    [ 'OBJ_BFK',     1,      'FKK'  ],
    [ 'OBJ_B_K',     1,      'JKK'  ],
    [ 'OBJ_A_K',     0,      'L'  ],
    [ 'OBJ_B_V',     1,      'UVV'  ],
    [ 'OBJ_A_V',     0,      'W'  ],

    [ 'ARR_BFV',     1,      'FVV'  ],
    [ 'ARR_B_V',     1,      'UVV'  ],
    [ 'ARR_A_V',     0,      'W'  ],
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
    [ null,    '{',           POS.ARR_BFV  ],
    [ 'F',     '{',           POS.OBJ_BFK  ],
    [ 'J',     '{',           POS.OBJ_B_K  ],
    [ 'K',     '{',           POS.OBJ_B_K  ],
    [ 'L',     '{',           POS.OBJ_A_K  ],
    [ 'U',     '{',           POS.OBJ_B_V  ],
    [ 'V',     '{',           POS.OBJ_B_V  ],
    [ 'W',     '{',           POS.OBJ_A_V  ],
    [ 'F',     '[',           POS.ARR_BFV  ],
    [ 'U',     '[',           POS.ARR_B_V  ],
    [ 'V',     '[',           POS.ARR_B_V  ],
    [ 'W',     '[',           POS.ARR_A_V  ],
  ], function (char, stack) {
    return jstate.char2pos(char, stack.split('').map(function (c) { return c.charCodeAt(0) }))
  })
})

test('encode/decode object', function (t) {
  t.table_assert([
    [ 'vcount', 'koff', 'klim', 'tok',  'voff', 'vlim', 'stack',   'pos', 'ecode', 'exp'  ],
    [  3,        0,      0,     'E',     5,      5,     '{',       'F',   '',       '5/3/{F' ],
    [  3,        0,      0,     'E',     5,      5,     '[{',      'F',   '',       '5/3/[{F' ],
    [  3,        0,      0,     'E',     5,      5,     '[{',      'F',   '',       '5/3/[{F' ],
    [  3,        0,      0,     'E',     5,      5,     '[{',      'J',   '',       '5/3/[{J' ],
    [  3,        2,      5,     'E',     5,      5,     '[{',      'J',   'T',      '5/3/[{K3' ],
    [  3,        2,      5,     'E',     5,      5,     '{',       'L',   '',       '5/3/{L3' ],
    [  3,        2,      5,     'E',     6,      6,     '{',       'L',   '',       '6/3/{L3.1' ],
    [  3,        2,      5,     'E',     7,      7,     '{',       'L',   '',       '7/3/{L3.2' ],
    [  3,        2,      5,     'E',     6,      6,     '{',       'U',   '',       '6/3/{U3' ],
    [  3,        2,      5,     'E',     7,      7,     '{',       'U',   '',       '7/3/{U3.2' ],
    [  3,        2,      5,     'E',     8,      8,     '{',       'U',   '',       '8/3/{U3.3' ],
    [  3,        2,      5,     'E',     8,      9,     '{',       'U',   'T',      '9/3/{V3.3:1' ],
    [  3,        2,      5,     'E',     6,      9,     '{',       'U',   'T',      '9/3/{V3:3' ],
    [  3,        0,      0,     'E',    10,     10,     '{',       'W',   '',       '10/3/{W' ],

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
    [  3,        0,      0,      'E',  0,      0,      '[',      'F',   '',       '0/3/[F' ],
    [  3,        0,      0,      'E',  1,      1,      '[',      'F',   '',       '1/3/[F' ],
    [  3,        0,      0,      'E',  2,      2,      '[',      'U',   '',       '2/3/[U' ],
    [  3,        0,      0,      'E',  2,      3,      '[',      'U',   'T',      '3/3/[V1' ],
    [  3,        0,      0,      'E',  2,      4,      '[',      'U',   'T',      '4/3/[V2' ],
    [  3,        0,      0,      'E',  4,      4,      '[',      'W',   '',       '4/3/[W' ],
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
    [ 3,        0,      0,       'E',   0,      0,      '',       'F',   '',       '0/3/F' ],
    [ 3,        0,      0,       'E',   1,      1,      '',       'F',   '',       '1/3/F' ],
    [ 3,        0,      0,       'E',   2,      2,      '',       'U',   '',       '2/3/U' ],
    [ 3,        0,      0,       'E',   2,      3,      '',       'U',   'T',      '3/3/V1' ],
    [ 3,        0,      0,       'E',   2,      4,      '',       'U',   'T',      '4/3/V2' ],
    [ 3,        0,      0,       'E',   4,      4,      '',       'W',   '',       '4/3/W' ],
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
    [  3,        2,      5,     'E',    5,      5,      '{',       'J',   'B',     '5/3/{J3!B' ],
    // [  3,        2,      5,     'E',    6,      7,      '{',       'L',   'U',     '5/3/{K3!U' ],

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

test('explain', function (t) {
  t.table_assert([
    [ 'src',         'lim',    'psargs',                                                   'exp'  ],
    //                      [ vcount, koff, klim, tok, voff, vlim, stack, pos, ecode  ]
    [ '[ ',         null,  [ 0, 1, 2, 'E', 2, 2, '[', 'F', '' ],     'at limit before first value, src[2] [ -><-' ],
    [ '{"',         null,  [ 0, 1, 2, 'E', 2, 2, '{', 'F', '' ],     'at limit before first key, src[2] {"-><-' ],
    [ '{"a',        null,  [ 0, 1, 2, 'E', 2, 2, '{', 'F', '' ],     'before first key, src[2] {"-><-a' ],
    [ '{ q',        null,  [ 0, 2, 2, 'E', 2, 3, '{', 'F', 'B' ],    'bad value, src[2..3] { ->q<-' ],
    [ '{ tq',       null,  [ 0, 2, 2, 'E', 2, 4, '{', 'F', 'B' ],    'bad value, src[2..4] { ->tq<-' ],
    [ '{ true',     null,  [ 0, 2, 2, 'E', 2, 6, '{', 'F', 'U' ],    'unexpected value, src[2..6] { ->true<-' ],
    [ '{"a',        null,  [ 0, 1, 3, 'E', 3, 3, '{', 'J', '' ],     'at limit before key, src[3] {"a-><-' ],
    [ '{"ab',       null,  [ 0, 1, 4, 'E', 4, 4, '{', 'J', 'T' ],    'truncated key, src[1..4] {->"ab<-' ],
    [ '{"a": trq',  null,  [ 0, 1, 4, 'E', 6, 9, '{', 'V', 'B' ],    'bad value, src[6..9] ..."a": ->trq<-' ],
    [ '{"a": "ab',  null,  [ 0, 1, 4, 'E', 6, 9, '{', 'U', 'T' ],    'truncated object value, src[6..9] ..."a": ->"ab<-' ],
    [ '{"a": "b"}', null,  [ 0, 1, 4, 'E', 4, 4, '{', 'L', '' ],     'after key, src[4] {"a"-><-: "b"...' ],
    [ '{"a"',       null,  [ 0, 1, 4, 'E', 4, 4, '{', 'L', '' ],     'at limit after key, src[4] {"a"-><-' ],
    [ '{"a": "b"}', null,  [ 0, 1, 4, 'E', 6, 6, '{', 'U', '' ],     'before object value, src[6] ..."a": -><-"b"}' ],
    [ '{"a": "b"}', null,  [ 0, 1, 4, 'E', 6, 9, '{', 'W', '' ],     'after object value, src[6..9] ..."a": ->"b"<-}' ],
    [ '{"a": "b",', null,  [ 0, 10, 10, 'E', 10, 10, '{', 'J', '' ], 'at limit before key, src[10] ... "b",-><-' ],
  ], function (src, lim, psargs) {
    var ps = args2ps(psargs)
    ps.src = utf8.buffer(src)
    ps.lim = lim == null ? ps.src.length : lim
    return jstate.explain(ps)
  })
})

test('explain errors', function (t) {
  t.table_assert([
    [ 'src',          'lim',  'psargs',                                               'exp'  ],
    //                      [ vcount, koff, klim, tok, voff, vlim, stack, pos, ecode  ]
    [  '{"ab',        null, [ 3,    0,    0,    'E',   2,    2,    '[',  'F', 'Q' ],       /unknown ecode/ ],
  ], function (src, lim, psargs) {
    var ps = args2ps(psargs)
    jstate.explain(src && utf8.buffer(src), lim, ps)
  }, {assert: 'throws'})
})

test('args2str', function (t) {
  t.table_assert([
    ['vcount',    'koff', 'klim',  'tok', 'voff', 'vlim', 'stack', 'pos', 'ecode', 'exp' ],
    [ null,       5,      5,        'B',   5,      5,      '[',    'F',   '',     'B@5' ],
    [ null,       5,      5,        'E',   5,      5,      '[',    'U',   '',     'E@5' ],
    [ null,       5,      5,        's',   5,      9,      '[',    'V',   '',     's4@5' ],
    [ null,       2,      5,        's',   5,      9,      '[',    'W',   '',     'k3@2:s4@5' ],
    [ null,       2,      5,        's',   5,      9,      '[',    'W',   'B',    'k3@2:s4@5!B' ],
  ], function () {
    var ps = args2ps(arguments)
    return jstate.tokstr(ps)
  })
})
