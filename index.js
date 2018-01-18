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

var qbsrc = require('qb-src')

// codes - same as in qb-json-next
var POS = {
  ARR_BFV: 0x080,
  ARR_B_V: 0x100,
  ARR_A_V: 0x180,
  OBJ_BFK: 0x200,
  OBJ_B_K: 0x280,
  OBJ_A_K: 0x300,
  OBJ_B_V: 0x380,
  OBJ_A_V: 0x400,
}

// ascii tokens as well as special codes for number, error, begin and end.
var TOK = {
  // ascii codes - for all but decimal, token is represented by the first ascii byte encountered
  ARR:      91,   // '['
  ARR_END:  93,   // ']'
  DEC:      100,  // 'd'  - a decimal value starting with: -, 0, 1, ..., 9
  FAL:      102,  // 'f'
  NUL:      110,  // 'n'
  STR:      115,  // 's'  - a string value starting with "
  TRU:      116,  // 't'
  OBJ:      123,  // '{'
  OBJ_END:  125,  // '}'

  // CAPITAL asciii is used for special start/end codes

  // tokenize() special codes
  BEG: 66,          // 'B'  (B)egin src.  about to tokenize a new src.
  END: 69,          // 'E'  (E)nd src. finished parsing a src.  check ps.ecode for more information.
}

var ECODE = {
  // when a tokenize() finishes a src, a non-zero ps.ecode indicates an abnormal/special end state:
  BAD_VALUE: 66,    // 'B'  encountered invalid byte or series of bytes
  TRUNC_DEC: 68,    // 'D'  end of buffer was value was a decimal ending with a digit (0-9). it is *possibly* unfinished
  TRUNCATED: 84,    // 'T'  key or value was unfinished at end of buffer
  UNEXPECTED: 85,   // 'U'  encountered a recognized token in wrong place/context
}

function err (msg) { throw Error(msg) }

// convert position into public ascii code (with accurate position state instead of obj/arr context)
// F - before first value or first key-value
// J - before key, K - within key, L - after key
// U - before val, V - within val, W - after val
function pos2char (pos, ecode) {
  if (ecode === ECODE.TRUNCATED || ecode === ECODE.TRUNC_DEC) {
    switch (pos) {
      case POS.OBJ_BFK: case POS.OBJ_B_K: return 'K'
      case POS.ARR_BFV: case POS.ARR_B_V: case POS.OBJ_B_V: return 'V'
      default: err('position not compatible with truncated or bad value: ' + pos.toString(16))
    }
  }
  switch (pos) {
    case POS.ARR_BFV: case POS.OBJ_BFK: return 'F'
    case POS.OBJ_B_K: return 'J'
    case POS.OBJ_A_K: return 'L'
    case POS.ARR_B_V: case POS.OBJ_B_V: return 'U'
    case POS.ARR_A_V: case POS.OBJ_A_V: return 'W'
  }
}

// convert public ascii code back to position
function char2pos (char, stack) {
  if (char == null) {
    return POS.ARR_BFV
  }
  if (stack[stack.length - 1] === 123) {
    switch (char) {
      case 'F': return POS.OBJ_BFK
      case 'J': case 'K': return POS.OBJ_B_K
      case 'L': return POS.OBJ_A_K
      case 'U': case 'V': return POS.OBJ_B_V
      case 'W': return POS.OBJ_A_V
      default: err('cannot restore object position "' + char + '"')
    }
  } else {
    switch (char) {
      case 'F': return POS.ARR_BFV
      case 'U': case 'V': return POS.ARR_B_V
      case 'W': return POS.ARR_A_V
      default: err('cannot restore array position "' + char + '"')
    }
  }
}

function encode (ps) {
  var ret = ps.vlim + '/' +  ps.vcount + '/'
  ret += ps.stack.map(function (b) { return String.fromCharCode(b) }).join('')
  var pcode = pos2char(ps.pos, ps.ecode)
  ret += pcode

  var klen = ps.klim - ps.koff
  var vlen = ps.vlim - ps.voff
  if (klen) {
    ret += klen
    var gap = ps.voff - ps.klim
    if (gap !== (pcode < 'U' ? 0 : 1)) {
      ret += '.' + gap      // report key/value gaps other than no-space expected gaps
    }
    if (vlen) {
      ret += ':' + vlen
    }
  } else if (vlen) {
    ret += vlen
  }

  if (ps.ecode === ECODE.BAD_VALUE || ps.ecode === ECODE.UNEXPECTED) {
    ret += '!' + String.fromCharCode(ps.ecode)
  }
  return ret
}

function map_ascii (s, code) {
  return s.split('').reduce(function (m,c) { m[c] = code; return m }, {})
}

//                    stack     pos_char  kvlen       .gap        : vlen         token-error-code
var PARSE_POS_RE = /^([{\[]+)?([FJKLUVW])(?:(?:(\d+)(?:\.(\d+))?)(?::(\d))?)?(?:!([BTU]))?$/

function decode (s) {
  var parts = s.split('/')
  var vlim = parseInt(parts[0])
  var vcount = parseInt(parts[1])
  var m = parts[2] && parts[2].match(PARSE_POS_RE) || err('could not decode: ' + s)

  var stack = m[1] && m[1].split('').map(function (b) { return b.charCodeAt(0) }) || []
  var pcode = m[2]
  var pos = char2pos(pcode, stack)
  var kvlen = m[3] && parseInt(m[3]) || 0
  var gap = m[4] ? parseInt(m[4]) : (pcode < 'U' ? 0 : 1)
  var vlen = m[5] && parseInt(m[5]) || 0
  var ecode = m[6] && m[6].charCodeAt(0) || ((pcode === 'K' || pcode === 'V') ? ECODE.TRUNCATED : 0)

  var ps = {
    src: null,
    next_src: null,
    lim: vlim,
    vcount: vcount,
    koff: 0,
    klim: 0,
    tok: TOK.END,     // todo: encode or restore from src
    voff: 0,
    vlim: vlim,
    stack: stack,
    pos: pos,
    ecode: ecode,
  }
  if (in_obj(ps.stack)) {
    ps.voff = vlim - vlen
    ps.klim = ps.voff - gap
    if (kvlen) {
      ps.koff = ps.klim - kvlen
    } else {
      ps.koff = ps.klim = 0
    }
  } else {
    // in array or root
    ps.voff = vlim - kvlen
  }
  return ps
}

var NO_LEN_TOKENS = map_ascii('tfn[]{}()', 1)
// a convenience function for summarizing/logging/debugging callback arguments as compact strings
// converts the 'arguments' array from cb into a terse string code.
// only show value lengths for string, decimal, end and error tokens.
function tokstr (ps) {
  var tchar = String.fromCharCode(ps.tok)
  var keystr = ps.koff === ps.klim ? '' : 'k' + (ps.klim - ps.koff) + '@' + ps.koff + ':'
  var vlen = (NO_LEN_TOKENS[tchar] || ps.vlim === ps.voff) ? '' : ps.vlim - ps.voff

  var ret = keystr + tchar + vlen + '@' + ps.voff
  if (ps.ecode) {
    ret += '!' + String.fromCharCode(ps.ecode)
  }
  return ret
}

function in_obj (stack) {
  return stack[stack.length - 1] === 123
}

// just handles required cases from explain()
function pos_str (ps) {
  if (ps.ecode === ECODE.TRUNCATED) {
    switch (ps.pos) {
      case POS.OBJ_BFK: case POS.OBJ_B_K: return 'in key'
      case POS.OBJ_B_V: return 'in object value'
      case POS.ARR_B_V: case POS.ARR_BFV: return 'in value'
      default: err('ambiguous position')
    }
  } else {
    switch (ps.pos) {
      case POS.OBJ_BFK: return 'before first key'
      case POS.OBJ_B_K: return 'before key'
      case POS.OBJ_A_K: return 'after key'
      case POS.OBJ_B_V: return 'before object value'
      case POS.ARR_B_V: return 'before value'
      case POS.OBJ_A_V: return 'after object value'
      case POS.ARR_A_V: return 'after value'
      case POS.ARR_BFV: return 'before first value'
      default: err('unknown position ' + ps.pos)
    }
  }
}

// explain ps as a human-readable string (error state, relative position and offset location(s))
function explain (ps) {
  var off = ps.voff
  var lim = ps.vlim
  var ret
  switch (ps.ecode) {
    case ECODE.UNEXPECTED:
      ret = 'unexpected value'
      break
    case ECODE.BAD_VALUE:
      ret = 'bad value'
      break
    case ECODE.TRUNC_DEC:
      switch (ps.pos) {
        case POS.OBJ_B_V:
          ret = 'truncated object decimal'
          break
        case POS.ARR_BFV: case POS.ARR_B_V:
          ret = 'truncated decimal'
      }
      break
    case ECODE.TRUNCATED:
      switch (ps.pos) {
        case POS.OBJ_BFK: case POS.OBJ_B_K:
          ret = 'truncated key'
          off = ps.koff
          lim = ps.klim
          break
        case POS.OBJ_B_V:
          ret = 'truncated object value'
          break
        case POS.ARR_BFV: case POS.ARR_B_V:
          ret = 'truncated value'
          break
        default:
          err('ambiguous position')
      }
      break
    case 0:
      ret = (ps.vlim < ps.lim ? '' : 'at limit ') + pos_str(ps)
      break
    default:
      err('unknown ecode: ' + ps.ecode)
  }
  return ret + ', ' + qbsrc.context_str(ps.src, off, lim, 5, 5, 20)
}

// convert human-readable object into ps object
function obj2ps (obj) {
  var stack = obj.stack != null && obj.stack.split('').map(function (c) { return c.charCodeAt(0) }) || []
  return {
    src: obj.src && obj.src.split('').map(function (c) {return c.charCodeAt(0)}) || null,
    next_src: obj.next_src && obj.next_src.split('').map(function (c) {return c.charCodeAt(0)}) || null,
    lim: obj.lim,
    vcount: obj.vcount,
    koff: obj.koff,
    klim: obj.klim,
    tok: obj.tok && obj.tok.charCodeAt(0) || 0,
    voff: obj.voff,
    vlim: obj.vlim,
    stack: obj.stack && obj.stack.split('').map(function (c) { return c.charCodeAt(0) }) || [],
    pos: char2pos(obj.pos, stack),
    ecode: obj.ecode && obj.ecode.charCodeAt(0) || 0,
  }
}

// convert ps into a more human-readable object
function ps2obj (ps) {
  return {
    src: ps.src && ps.src.map(function (c) { return String.fromCharCode(c) }).join(''),
    next_src: ps.next_src && ps.next_src.map(function (c) { return String.fromCharCode(c) }).join(''),
    vcount: ps.vcount,
    koff: ps.koff,
    klim: ps.klim,
    tok: String.fromCharCode(ps.tok),
    voff: ps.voff,
    vlim: ps.vlim,
    stack: ps.stack.map(function (c) { return String.fromCharCode(c) }).join(''),
    pos: pos2char(ps.pos, ps.ecode),
    ecode: String.fromCharCode(ps.ecode),
  }
}

module.exports = {
  encode: encode,
  decode: decode,
  ps2obj: ps2obj,
  obj2ps: obj2ps,
  explain: explain,
  tokstr: tokstr,
  char2pos: char2pos,
  pos2char: pos2char,
  TOK: TOK,
  ECODE: ECODE,
  POS: POS,
}
